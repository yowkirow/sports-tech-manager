import type { AppEnv } from './env.ts';
import type { Member } from './auth.ts';
import { findMember, verifyAccessIdentity } from './auth.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readBytes, readJson } from './http.ts';

interface MediaRow {
    id: string;
    object_key: string;
    visibility: 'public' | 'private';
    content_type: string;
}

interface SmsSettings {
    apiKey: string;
    deviceId: string;
    enableSmsNotifications: boolean;
    enableTrackingSms: boolean;
    trackingSmsTemplate: string;
}

const encoder = new TextEncoder();
const emptySettings: SmsSettings = {
    apiKey: '', deviceId: '', enableSmsNotifications: false,
    enableTrackingSms: false, trackingSmsTemplate: 'Hi {customerName}, your SportsTech order is on its way! Track here: {trackingLink}'
};

function b64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unb64(value: string): Uint8Array {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}

async function settingsKey(secret: string): Promise<CryptoKey> {
    if (!secret || secret.length < 32) throw new HttpError(503, 'settings_unavailable', 'Protected settings are not configured.');
    const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('sportstech-settings-v1'),
        info: encoder.encode('sms-settings')
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptSettings(settings: SmsSettings, secret: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await settingsKey(secret), encoder.encode(JSON.stringify(settings)));
    return JSON.stringify({ v: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(encrypted)) });
}

export async function loadSmsSettings(env: AppEnv): Promise<SmsSettings> {
    const row = await env.DB.prepare("SELECT encrypted_value FROM private_settings WHERE name = 'sms'").first<{ encrypted_value: string }>();
    if (!row) return { ...emptySettings, apiKey: env.SMS_API_KEY || '', deviceId: env.SMS_DEVICE_ID || '' };
    const envelope: unknown = JSON.parse(row.encrypted_value);
    if (!isObject(envelope) || envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
        throw new HttpError(503, 'settings_unavailable', 'Stored SMS settings could not be verified.');
    }
    const decrypted = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: unb64(envelope.iv)
    }, await settingsKey(env.GUEST_TOKEN_SECRET), unb64(envelope.ciphertext));
    const settings: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    if (!isObject(settings) || typeof settings.apiKey !== 'string' || typeof settings.deviceId !== 'string'
        || typeof settings.enableSmsNotifications !== 'boolean' || typeof settings.enableTrackingSms !== 'boolean'
        || typeof settings.trackingSmsTemplate !== 'string') {
        throw new HttpError(503, 'settings_unavailable', 'Stored SMS settings could not be verified.');
    }
    return {
        apiKey: settings.apiKey, deviceId: settings.deviceId,
        enableSmsNotifications: settings.enableSmsNotifications,
        enableTrackingSms: settings.enableTrackingSms, trackingSmsTemplate: settings.trackingSmsTemplate
    };
}

function safeSettings(settings: SmsSettings) {
    return {
        configured: Boolean(settings.apiKey && settings.deviceId),
        deviceId: settings.deviceId, enableSmsNotifications: settings.enableSmsNotifications,
        enableTrackingSms: settings.enableTrackingSms, trackingSmsTemplate: settings.trackingSmsTemplate
    };
}

async function owner(env: AppEnv, member: Member | null): Promise<Member> {
    if (!member || member.role !== 'owner') throw new HttpError(403, 'access_denied', 'Owner access is required.');
    const active = await env.DB.prepare("SELECT id FROM members WHERE id = ? AND role = 'owner' AND active = 1").bind(member.id).first();
    if (!active) throw new HttpError(403, 'access_denied', 'Owner access is required.');
    return member;
}

export function imageType(bytes: Uint8Array): string | null {
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    const start = new TextDecoder().decode(bytes.slice(0, 12));
    if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
    if (start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP') return 'image/webp';
    return null;
}

export async function handleMediaRequest(request: Request, env: AppEnv, member: Member | null = null): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    const match = /^\/api\/media\/objects\/([0-9a-f-]{36})$/i.exec(path);
    if (match && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT id,object_key,visibility,content_type FROM media_objects WHERE id = ?')
            .bind(match[1]).first<MediaRow>();
        if (!row) throw new HttpError(404, 'not_found', 'File not found.');
        if (row.visibility === 'private') {
            const requester = member || await findMember(env.DB, await verifyAccessIdentity(request, env));
            await owner(env, requester);
        }
        const object = await env.MEDIA.get(row.object_key);
        if (!object) throw new HttpError(404, 'not_found', 'File not found.');
        const isImage = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(row.content_type);
        return new Response(object.body, { headers: {
            'Content-Type': isImage ? row.content_type : 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename="${row.id}"`,
            'Cache-Control': row.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
            'Referrer-Policy': 'no-referrer'
        } });
    }
    if (path !== '/api/media/products' || request.method !== 'POST') return null;
    const actor = await owner(env, member);
    const bytes = await readBytes(request, 5 * 1024 * 1024);
    const type = imageType(bytes);
    if (!type) throw new HttpError(415, 'invalid_image', 'Upload a PNG, JPEG, GIF or WebP image.');
    const id = crypto.randomUUID();
    const key = `products/${id}`;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
        await env.DB.batch([
            env.DB.prepare(`INSERT INTO _settings_write_guards(ok)
                VALUES (CASE WHEN EXISTS (SELECT 1 FROM members WHERE id=? AND role='owner' AND active=1) THEN 1 ELSE 0 END)`).bind(actor.id),
            env.DB.prepare(`INSERT INTO media_objects(id,object_key,visibility,content_type,byte_size,sha256,owner_id)
                VALUES (?,?,'public',?,?,?,?)`).bind(id, key, type, bytes.length, hash, actor.id),
            env.DB.prepare('DELETE FROM _settings_write_guards')
        ]);
    } catch (error) {
        try { await env.MEDIA.delete(key); }
        catch { console.error(JSON.stringify({ code: 'orphaned_product_upload', objectId: id })); }
        throw error;
    }
    return json({ id, url: `/api/media/objects/${id}` }, 201);
}

export async function handleSmsRequest(request: Request, env: AppEnv, member: Member): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!['/api/settings/sms', '/api/sms'].includes(path)) return null;
    await owner(env, member);
    const settings = await loadSmsSettings(env);
    if (path === '/api/settings/sms') {
        if (request.method === 'GET') return json(safeSettings(settings));
        if (request.method !== 'PATCH') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        const body = await readJson(request, 8192);
        const fields = ['apiKey', 'deviceId', 'enableSmsNotifications', 'enableTrackingSms', 'trackingSmsTemplate'];
        if (!isObject(body) || Object.keys(body).some(key => !fields.includes(key))
            || (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 1024))
            || typeof body.deviceId !== 'string' || !/^[a-zA-Z0-9_-]{0,200}$/.test(body.deviceId)
            || typeof body.enableSmsNotifications !== 'boolean' || typeof body.enableTrackingSms !== 'boolean'
            || typeof body.trackingSmsTemplate !== 'string' || body.trackingSmsTemplate.length > 2000) {
            throw new HttpError(400, 'invalid_settings', 'Enter valid SMS settings.');
        }
        const next: SmsSettings = {
            apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : settings.apiKey,
            deviceId: body.deviceId, enableSmsNotifications: body.enableSmsNotifications,
            enableTrackingSms: body.enableTrackingSms, trackingSmsTemplate: body.trackingSmsTemplate
        };
        const encrypted = await encryptSettings(next, env.GUEST_TOKEN_SECRET);
        await env.DB.batch([
            env.DB.prepare(`INSERT INTO _settings_write_guards(ok)
                VALUES (CASE WHEN EXISTS (SELECT 1 FROM members WHERE id=? AND role='owner' AND active=1) THEN 1 ELSE 0 END)`).bind(member.id),
            env.DB.prepare(`INSERT INTO private_settings(name,encrypted_value) VALUES ('sms',?)
                ON CONFLICT(name) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(encrypted),
            env.DB.prepare('DELETE FROM _settings_write_guards')
        ]);
        return json(safeSettings(next));
    }
    if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    const body = await readJson(request, 8192);
    if (!isObject(body) || typeof body.recipient !== 'string' || typeof body.message !== 'string'
        || typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)
        || !body.message.trim() || body.message.length > 2000) {
        throw new HttpError(400, 'invalid_sms', 'Enter a recipient and SMS message.');
    }
    const clean = body.recipient.replace(/[\s()-]/g, '');
    const recipient = clean.startsWith('09') ? `+63${clean.slice(1)}` : clean.startsWith('9') ? `+63${clean}`
        : clean.startsWith('639') ? `+${clean}` : clean;
    if (!/^\+[1-9]\d{7,14}$/.test(recipient)) throw new HttpError(400, 'invalid_recipient', 'Enter a valid international phone number.');
    if (!settings.apiKey || !settings.deviceId) throw new HttpError(409, 'sms_not_configured', 'Configure the SMS gateway before sending.');
    if (env.ENVIRONMENT !== 'production') throw new HttpError(409, 'sms_staging_disabled', 'SMS delivery is disabled in staging to prevent real messages during testing.');
    const payloadHash = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([recipient, body.message])))));
    const reservation = await env.DB.batch([
        env.DB.prepare(`INSERT INTO _settings_write_guards(ok)
            VALUES (CASE WHEN EXISTS (SELECT 1 FROM members WHERE id=? AND role='owner' AND active=1) THEN 1 ELSE 0 END)`).bind(member.id),
        env.DB.prepare(`INSERT INTO sms_requests(actor_id,request_id,payload_hash,status) VALUES (?,?,?,'sending')
            ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`).bind(member.id, body.requestId, payloadHash),
        env.DB.prepare('DELETE FROM _settings_write_guards'),
        env.DB.prepare('SELECT payload_hash,status FROM sms_requests WHERE actor_id=? AND request_id=?').bind(member.id, body.requestId)
    ]);
    const saved = reservation[3]?.results[0];
    if (!isObject(saved) || saved.payload_hash !== payloadHash) throw new HttpError(409, 'sms_request_conflict', 'This SMS request ID was already used for a different message.');
    if (!reservation[1]?.results.length) {
        if (saved.status === 'sent') return json({ sent: true });
        throw new HttpError(409, 'sms_result_unknown', 'This message was already attempted. Check the gateway delivery log before sending again.');
    }
    let response: Response;
    try {
        response = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(settings.deviceId)}/send-sms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey },
            body: JSON.stringify({ recipients: [recipient], message: body.message }),
            signal: AbortSignal.timeout(15000)
        });
    } catch {
        throw new HttpError(502, 'sms_result_unknown', 'The SMS delivery result is unknown. Check the gateway delivery log before sending again.');
    }
    if (!response.ok) {
        await env.DB.prepare("UPDATE sms_requests SET status='failed' WHERE actor_id=? AND request_id=?").bind(member.id, body.requestId).run();
        throw new HttpError(502, 'sms_delivery_failed', 'The SMS gateway did not confirm delivery. Check its delivery log before retrying.');
    }
    await env.DB.prepare("UPDATE sms_requests SET status='sent' WHERE actor_id=? AND request_id=?").bind(member.id, body.requestId).run();
    return json({ sent: true });
}
