import type { AppEnv } from './env.ts';
import type { Member } from './auth.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readJson } from './http.ts';
import { owner } from './media-api.ts';

// DTF sheet builder (owner request 2026-11-09): the owner's gallery of print-ready SVG designs.
// The app cleans each SVG before upload (src/lib/svgDesign.js); this API checks it again and
// stores it as a private media object. /api/media/objects/:id serves it only to the owner and
// only as a download (application/octet-stream, attachment), so an SVG never opens as a page on
// the shop's domain. The app reads it with fetch and shows it in an img element, where SVG can't run
// scripts or load files.

const BASE = '/api/dtf/designs';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SVG_BYTES = 5 * 1024 * 1024;
const OWNER_GUARD = `INSERT INTO _settings_write_guards(ok)
    VALUES (CASE WHEN EXISTS (SELECT 1 FROM members WHERE id=? AND role='owner' AND active=1) THEN 1 ELSE 0 END)`;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const SELECT = `SELECT d.id,d.name,d.media_id,d.width_mils,d.height_mils,d.created_at,d.updated_at,d.archived_at,m.sha256
    FROM dtf_designs d JOIN media_objects m ON m.id = d.media_id`;

interface DesignRow {
    id: string;
    name: string;
    media_id: string;
    width_mils: number;
    height_mils: number;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    sha256: string;
}

const RASTER = 'data:image\\/(?:png|jpeg|gif|webp)[;,]';
// What a cleaned SVG never contains. Anything here means the file skipped the app's cleaning step.
const UNSAFE: [RegExp, string][] = [
    [/<!DOCTYPE|<!ENTITY/i, 'a DOCTYPE'],
    [/<(?:[a-z][\w.-]*:)?(?:script|foreignObject|iframe|embed|object|audio|video|canvas|style)[\s/>]/i, 'embedded code or styles'],
    [/<[a-z][^>]*?\son[a-z]+\s*=/i, 'an event handler'],
    [/javascript:/i, 'a javascript: link'],
    [new RegExp(`(?<![\\w-])(?:xlink:)?href\\s*=\\s*["']\\s*(?!#|${RASTER})`, 'i'), 'a link to another file'],
    // The optional quote sits inside the lookahead, so a link inside the file passes however it is quoted: the app
    // keeps a link it couldn't rename as url("#a"), which arrives here as url(&quot;#a&quot;).
    [new RegExp(`url\\((?!\\s*(?:['"]|&quot;|&apos;)?\\s*(?:#|${RASTER}))`, 'i'), 'a link to another file'],
    [/@import/i, 'a style import']
];

function invalid(message: string): never {
    throw new HttpError(400, 'invalid_design', message);
}

function fields(body: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    if (!isObject(body)) invalid('Send the design as a JSON object.');
    const allowed = new Set([...required, ...optional]);
    if (Object.keys(body).some(key => !allowed.has(key))) invalid('The request has a field this endpoint does not accept.');
    for (const key of required) if (!Object.hasOwn(body, key)) invalid(`The request is missing ${key}.`);
    return body;
}

function designName(value: unknown): string {
    if (typeof value !== 'string') invalid('Give the design a name.');
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) invalid('Use a name of 1 to 120 characters.');
    return name;
}

function mils(value: unknown, label: string, maxInches: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`Enter the ${label} in inches.`);
    const result = Math.round(value * 1000);
    if (result < 100 || result > maxInches * 1000) invalid(`The ${label} must be between 0.1 and ${maxInches} inches.`);
    return result;
}

export function checkSvg(value: unknown): Uint8Array {
    if (typeof value !== 'string') throw new HttpError(415, 'invalid_svg', 'Upload an SVG file.');
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > MAX_SVG_BYTES) throw new HttpError(413, 'payload_too_large', 'The SVG file is larger than 5 MB.');
    for (const [pattern, what] of UNSAFE) {
        if (pattern.test(value)) throw new HttpError(422, 'unsafe_svg', `The SVG still contains ${what}. Upload it again from the DTF sheets screen.`);
    }
    if (value.includes('\u0000')
        || !/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(value)
        || !/<\/svg>\s*$/.test(value)) {
        throw new HttpError(415, 'invalid_svg', 'Upload an SVG file.');
    }
    return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function design(row: DesignRow) {
    return {
        id: row.id, name: row.name, widthIn: row.width_mils / 1000, heightIn: row.height_mils / 1000,
        svgUrl: `/api/media/objects/${row.media_id}`, createdAt: row.created_at, updatedAt: row.updated_at
    };
}

async function stored(env: AppEnv, id: string): Promise<DesignRow | null> {
    return env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(id).first<DesignRow>();
}

// The app picks the design's ID, so a retried upload returns the design it already saved.
function replay(row: DesignRow, hash: string): Response {
    if (row.archived_at !== null || row.sha256 !== hash) {
        throw new HttpError(409, 'design_conflict', 'This design ID is already used. Reload and upload the file again.');
    }
    return json({ design: design(row) });
}

async function list(env: AppEnv): Promise<Response> {
    const result = await env.DB.prepare(`${SELECT} WHERE d.archived_at IS NULL ORDER BY lower(d.name), d.created_at`).all<DesignRow>();
    return json({ designs: result.results.map(design) });
}

async function create(request: Request, env: AppEnv, actor: Member): Promise<Response> {
    // JSON escaping can grow an SVG's quotes and newlines, so the body may be larger than the file.
    const body = fields(await readJson(request, 3 * MAX_SVG_BYTES), ['id', 'name', 'widthIn', 'heightIn', 'svg']);
    if (typeof body.id !== 'string' || !ID.test(body.id)) invalid('The design needs a valid ID.');
    const id = body.id;
    const name = designName(body.name);
    const width = mils(body.widthIn, 'print width', 60);
    const height = mils(body.heightIn, 'print height', 120);
    const bytes = checkSvg(body.svg);
    const hash = await sha256(bytes);
    const existing = await stored(env, id);
    if (existing) return replay(existing, hash);

    const mediaId = crypto.randomUUID();
    const key = `dtf-designs/${mediaId}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/svg+xml', cacheControl: 'private, no-store' } });
    try {
        await env.DB.batch([
            env.DB.prepare(OWNER_GUARD).bind(actor.id),
            env.DB.prepare(`INSERT INTO media_objects(id,object_key,visibility,content_type,byte_size,sha256,owner_id)
                VALUES (?,?,'private','image/svg+xml',?,?,?)`).bind(mediaId, key, bytes.length, hash, actor.id),
            env.DB.prepare('INSERT INTO dtf_designs(id,name,media_id,width_mils,height_mils,created_by) VALUES (?,?,?,?,?,?)')
                .bind(id, name, mediaId, width, height, actor.id),
            env.DB.prepare('DELETE FROM _settings_write_guards')
        ]);
    } catch (error) {
        // D1 can report an error for a batch that did commit (a connection lost after the write, say), so look
        // before deleting the file. When D1 can't be asked, keep it: a stray file is harmless, but a saved design
        // without its file would stay broken.
        let row: DesignRow | null;
        try { row = await stored(env, id); }
        catch {
            console.error(JSON.stringify({ code: 'unconfirmed_dtf_design_upload', objectId: mediaId }));
            throw error;
        }
        if (row?.media_id === mediaId) return json({ design: design(row) }, 201);
        try { await env.MEDIA.delete(key); }
        catch { console.error(JSON.stringify({ code: 'orphaned_dtf_design_upload', objectId: mediaId })); }
        if (row) return replay(row, hash);
        throw error;
    }
    const saved = await stored(env, id);
    if (!saved) throw new Error('The saved design could not be confirmed.');
    return json({ design: design(saved) }, 201);
}

async function update(request: Request, env: AppEnv, actor: Member, id: string): Promise<Response> {
    const body = fields(await readJson(request, 4096), [], ['name', 'widthIn', 'heightIn']);
    if (!Object.keys(body).length) invalid('Send a new name or print size.');
    // The height follows the design's shape, which only the app knows, so a size change sends both.
    if (Object.hasOwn(body, 'widthIn') !== Object.hasOwn(body, 'heightIn')) invalid('Send the print width and height together.');
    const name = Object.hasOwn(body, 'name') ? designName(body.name) : null;
    const width = Object.hasOwn(body, 'widthIn') ? mils(body.widthIn, 'print width', 60) : null;
    const height = Object.hasOwn(body, 'heightIn') ? mils(body.heightIn, 'print height', 120) : null;
    const results = await env.DB.batch([
        env.DB.prepare(OWNER_GUARD).bind(actor.id),
        env.DB.prepare(`UPDATE dtf_designs SET name=coalesce(?,name),width_mils=coalesce(?,width_mils),
            height_mils=coalesce(?,height_mils),updated_at=${NOW} WHERE id=? AND archived_at IS NULL RETURNING id`)
            .bind(name, width, height, id),
        env.DB.prepare('DELETE FROM _settings_write_guards')
    ]);
    if (!results[1]?.results.length) throw new HttpError(404, 'not_found', 'This design is no longer in the gallery.');
    const saved = await stored(env, id);
    if (!saved) throw new Error('The saved design could not be confirmed.');
    return json({ design: design(saved) });
}

async function archive(env: AppEnv, actor: Member, id: string): Promise<Response> {
    const results = await env.DB.batch([
        env.DB.prepare(OWNER_GUARD).bind(actor.id),
        env.DB.prepare(`UPDATE dtf_designs SET archived_at=${NOW},updated_at=${NOW} WHERE id=? AND archived_at IS NULL RETURNING id`).bind(id),
        env.DB.prepare('DELETE FROM _settings_write_guards')
    ]);
    if (!results[1]?.results.length) throw new HttpError(404, 'not_found', 'This design is no longer in the gallery.');
    return json({ archived: true, id });
}

export async function handleDtfRequest(request: Request, env: AppEnv, member: Member): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return null;
    const actor = await owner(env, member);
    if (path === BASE) {
        if (request.method === 'GET') return list(env);
        if (request.method === 'POST') return create(request, env, actor);
        throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    }
    const id = path.slice(BASE.length + 1).toLowerCase();
    if (!ID.test(id)) throw new HttpError(404, 'not_found', 'Endpoint not found.');
    if (request.method === 'PATCH') return update(request, env, actor, id);
    if (request.method === 'DELETE') return archive(env, actor, id);
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
}
