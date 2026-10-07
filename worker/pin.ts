import type { AccessIdentity, Member } from './auth.ts';
import { findMember, verifyAccessIdentity } from './auth.ts';
import type { AppEnv } from './env.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readJson } from './http.ts';

// Cloudflare Access (an emailed code) proves who the member is, about once a month per
// device. This PIN proves the person holding that signed-in device is still the member.
// Every private API requires both; the PIN is checked on the server, not just hidden in UI.

export const PIN_PATHS = ['/api/pin/setup', '/api/pin/unlock', '/api/pin/change', '/api/pin/reset', '/api/pin/lock'];
export const PIN_COOKIE = 'st_pin';
export const UNLOCK_SECONDS = 12 * 60 * 60;
export const PIN_ITERATIONS = 100_000;
export const SHORT_LOCK_AFTER = 5;
export const LONG_LOCK_AFTER = 10;
const SHORT_LOCK_MS = 15 * 60 * 1000;
const LONG_LOCK_MS = 24 * 60 * 60 * 1000;
// Forgotten PINs are reset only right after a new Access sign-in (a new emailed code).
export const RESET_WINDOW_SECONDS = 10 * 60;

interface PinRow {
    member_id: string;
    pin_hash: string;
    salt: string;
    iterations: number;
    version: number;
    failed_attempts: number;
    locked_until: string | null;
}

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text = '';
    for (const byte of view) text += String.fromCharCode(byte);
    return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unb64url(value: string): Uint8Array {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}

export function validatePin(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4,6}$/.test(value)) {
        throw new HttpError(400, 'invalid_pin', 'Use a PIN of 4 to 6 digits.');
    }
    const digits = [...value].map(Number);
    const steps = new Set(digits.slice(1).map((digit, index) => (digit - digits[index]! + 10) % 10));
    const [step] = steps;
    if (steps.size === 1 && (step === 0 || step === 1 || step === 9)) {
        throw new HttpError(400, 'weak_pin', 'Avoid repeated or sequential digits such as 1111 or 1234.');
    }
    return value;
}

async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    let difference = left.length ^ right.length;
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
    }
    return difference === 0;
}

async function pinMatches(pin: string, row: PinRow): Promise<boolean> {
    if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) return false;
    return sameBytes(await hashPin(pin, unb64url(row.salt), row.iterations), unb64url(row.pin_hash));
}

async function newHash(pin: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: b64url(salt), hash: b64url(await hashPin(pin, salt, PIN_ITERATIONS)), iterations: PIN_ITERATIONS };
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function unlockKey(secret: string | undefined): Promise<CryptoKey> {
    if (!secret || secret.length < 32) throw new HttpError(503, 'pin_unavailable', 'PIN sign-in is not configured.');
    let key = keyCache.get(secret);
    if (!key) {
        key = crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']).then(material =>
            crypto.subtle.deriveKey({
                name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('sportstech-pin-v1'), info: encoder.encode('pin-unlock')
            }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']));
        keyCache.set(secret, key);
    }
    return key;
}

async function subjectTag(subject: string): Promise<string> {
    return b64url(await crypto.subtle.digest('SHA-256', encoder.encode(subject))).slice(0, 22);
}

export async function issueUnlock(env: AppEnv, member: Member, identity: AccessIdentity, version: number, now = Date.now()) {
    const payload = b64url(encoder.encode(JSON.stringify({
        m: member.id, v: version, s: await subjectTag(identity.subject), e: Math.floor(now / 1000) + UNLOCK_SECONDS
    })));
    const signature = await crypto.subtle.sign('HMAC', await unlockKey(env.GUEST_TOKEN_SECRET), encoder.encode(payload));
    return `${payload}.${b64url(signature)}`;
}

function readCookie(request: Request, name: string): string | null {
    const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
        .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
    return values.length === 1 && values[0] ? values[0] : null;
}

async function validUnlock(request: Request, env: AppEnv, member: Member, identity: AccessIdentity, row: PinRow) {
    const token = readCookie(request, PIN_COOKIE);
    if (!token || token.length > 512) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return false;
    try {
        const valid = await crypto.subtle.verify('HMAC', await unlockKey(env.GUEST_TOKEN_SECRET),
            unb64url(signature), encoder.encode(payload));
        if (!valid) return false;
        const claims: unknown = JSON.parse(new TextDecoder().decode(unb64url(payload)));
        if (!isObject(claims)) return false;
        const now = Math.floor(Date.now() / 1000);
        return claims.m === member.id && claims.v === row.version && claims.s === await subjectTag(identity.subject)
            && typeof claims.e === 'number' && claims.e > now && claims.e <= now + UNLOCK_SECONDS + 60;
    } catch (error) {
        if (error instanceof HttpError) throw error;
        return false;
    }
}

const unlockCookie = (token: string) =>
    `${PIN_COOKIE}=${token}; Path=/; Max-Age=${UNLOCK_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
const clearCookie = `${PIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function readPin(db: D1Database, memberId: string) {
    return db.prepare(`SELECT member_id,pin_hash,salt,iterations,version,failed_attempts,locked_until
        FROM member_pins WHERE member_id = ?`).bind(memberId).first<PinRow>();
}

const lockedUntil = (row: PinRow, now = Date.now()) =>
    row.locked_until && Date.parse(row.locked_until) > now ? row.locked_until : null;
export const freshSignIn = (identity: AccessIdentity, now = Date.now()) =>
    identity.issuedAt >= Math.floor(now / 1000) - RESET_WINDOW_SECONDS;

export async function pinStatus(request: Request, env: AppEnv, member: Member, identity: AccessIdentity) {
    const row = await readPin(env.DB, member.id);
    return {
        configured: Boolean(row),
        unlocked: row ? await validUnlock(request, env, member, identity, row) : false,
        lockedUntil: row ? lockedUntil(row) : null,
        resetAvailable: freshSignIn(identity)
    };
}

export async function requirePinUnlocked(request: Request, env: AppEnv, member: Member, identity: AccessIdentity) {
    const row = await readPin(env.DB, member.id);
    if (!row) throw new HttpError(428, 'pin_setup_required', 'Create your PIN to continue.');
    if (!await validUnlock(request, env, member, identity, row)) {
        throw new HttpError(423, 'pin_required', 'Enter your PIN to continue.');
    }
}

/** Access identity, active membership and a current PIN unlock, for private routes outside the main router. */
export async function authorizedMember(request: Request, env: AppEnv): Promise<Member> {
    const identity = await verifyAccessIdentity(request, env);
    const member = await findMember(env.DB, identity);
    await requirePinUnlocked(request, env, member, identity);
    return member;
}

function locked(until: string) {
    return json({ error: { code: 'pin_locked', message: 'Too many incorrect PINs. Try again later.', lockedUntil: until } }, 423);
}

async function recordFailure(db: D1Database, memberId: string, now = Date.now()) {
    const row = await db.prepare(`UPDATE member_pins SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE member_id = ? RETURNING failed_attempts, locked_until`)
        .bind(LONG_LOCK_AFTER, new Date(now + LONG_LOCK_MS).toISOString(),
            SHORT_LOCK_AFTER, new Date(now + SHORT_LOCK_MS).toISOString(), memberId)
        .first<{ failed_attempts: number; locked_until: string | null }>();
    if (row?.locked_until && Date.parse(row.locked_until) > now) return locked(row.locked_until);
    return json({ error: {
        code: 'pin_incorrect', message: 'That PIN is incorrect.',
        remaining: Math.max(SHORT_LOCK_AFTER - (row?.failed_attempts ?? 0), 0)
    } }, 401);
}

function unlocked(body: Record<string, unknown>, token: string) {
    const response = json(body);
    response.headers.append('Set-Cookie', unlockCookie(token));
    return response;
}

async function verifyOrFail(env: AppEnv, row: PinRow, pin: unknown): Promise<Response | null> {
    const until = lockedUntil(row);
    if (until) return locked(until);
    if (await pinMatches(pin as string, row)) {
        if (row.failed_attempts || row.locked_until) {
            await env.DB.prepare('UPDATE member_pins SET failed_attempts = 0, locked_until = NULL WHERE member_id = ?')
                .bind(row.member_id).run();
        }
        return null;
    }
    return recordFailure(env.DB, row.member_id);
}

export async function handlePinRequest(request: Request, env: AppEnv, member: Member, identity: AccessIdentity): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!PIN_PATHS.includes(path) || request.method !== 'POST') return null;
    if (path === '/api/pin/lock') {
        const response = json({ locked: true });
        response.headers.append('Set-Cookie', clearCookie);
        return response;
    }
    const body = await readJson(request, 1024);
    if (!isObject(body)) throw new HttpError(400, 'invalid_request', 'Send the PIN as JSON.');
    const row = await readPin(env.DB, member.id);

    if (path === '/api/pin/setup') {
        const pin = validatePin(body.pin);
        if (row) throw new HttpError(409, 'pin_exists', 'A PIN is already set. Use your PIN or change it in Settings.');
        const { salt, hash, iterations } = await newHash(pin);
        const created = await env.DB.prepare(`INSERT INTO member_pins(member_id,pin_hash,salt,iterations)
            VALUES (?,?,?,?) ON CONFLICT(member_id) DO NOTHING RETURNING version`)
            .bind(member.id, hash, salt, iterations).first<{ version: number }>();
        if (!created) throw new HttpError(409, 'pin_exists', 'A PIN is already set. Use your PIN or change it in Settings.');
        return unlocked({ unlocked: true }, await issueUnlock(env, member, identity, created.version));
    }

    if (path === '/api/pin/reset') {
        if (!freshSignIn(identity)) {
            throw new HttpError(403, 'fresh_sign_in_required', 'Sign out and sign in again with an emailed code, then set a new PIN.');
        }
        const pin = validatePin(body.pin);
        const { salt, hash, iterations } = await newHash(pin);
        const saved = await env.DB.prepare(`INSERT INTO member_pins(member_id,pin_hash,salt,iterations) VALUES (?,?,?,?)
            ON CONFLICT(member_id) DO UPDATE SET pin_hash = excluded.pin_hash, salt = excluded.salt,
                iterations = excluded.iterations, version = member_pins.version + 1, failed_attempts = 0,
                locked_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            RETURNING version`).bind(member.id, hash, salt, iterations).first<{ version: number }>();
        return unlocked({ unlocked: true }, await issueUnlock(env, member, identity, saved!.version));
    }

    if (!row) throw new HttpError(428, 'pin_setup_required', 'Create your PIN to continue.');

    if (path === '/api/pin/unlock') {
        const failure = await verifyOrFail(env, row, body.pin);
        if (failure) return failure;
        return unlocked({ unlocked: true }, await issueUnlock(env, member, identity, row.version));
    }

    // /api/pin/change: the current PIN is required, and wrong guesses count toward the lockout.
    const failure = await verifyOrFail(env, row, body.currentPin);
    if (failure) return failure;
    const pin = validatePin(body.pin);
    const { salt, hash, iterations } = await newHash(pin);
    const changed = await env.DB.prepare(`UPDATE member_pins SET pin_hash = ?, salt = ?, iterations = ?,
            version = version + 1, failed_attempts = 0, locked_until = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE member_id = ? AND version = ? RETURNING version`)
        .bind(hash, salt, iterations, member.id, row.version).first<{ version: number }>();
    if (!changed) throw new HttpError(409, 'pin_changed', 'Your PIN was changed on another device. Unlock again.');
    return unlocked({ unlocked: true }, await issueUnlock(env, member, identity, changed.version));
}
