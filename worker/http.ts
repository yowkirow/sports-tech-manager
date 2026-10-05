import { HttpError } from './errors.ts';

export function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer'
        }
    });
}

export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
        throw new HttpError(415, 'unsupported_content_type', 'Send this request as JSON.');
    }
    const bytes = await readBytes(request, maxBytes);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new HttpError(400, 'invalid_json', 'The request contains invalid JSON.'); }
}

export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
    if (Number(request.headers.get('content-length')) > maxBytes) {
        throw new HttpError(413, 'payload_too_large', 'This request is too large.');
    }
    if (!request.body) throw new HttpError(400, 'missing_body', 'A request body is required.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new HttpError(413, 'payload_too_large', 'This request is too large.');
            }
            chunks.push(result.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export function sameOriginMutation(request: Request): void {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.get('Origin');
    const site = request.headers.get('Sec-Fetch-Site');
    if ((origin && origin !== new URL(request.url).origin) || site === 'cross-site') {
        throw new HttpError(403, 'origin_denied', 'This request origin is not allowed.');
    }
}

// Alternate hostnames (for example the bare domain) permanently move to the one
// canonical storefront host, keeping the path and query. Unlisted hosts are untouched.
export function canonicalRedirect(request: Request, canonicalHost?: string, redirectHosts?: string): Response | null {
    if (!canonicalHost || !redirectHosts) return null;
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(canonicalHost)) return null;
    const url = new URL(request.url);
    const hosts = redirectHosts.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
    if (!hosts.includes(url.hostname.toLowerCase()) || url.hostname.toLowerCase() === canonicalHost) return null;
    const location = new URL(`${url.pathname}${url.search}`, `https://${canonicalHost}`).href;
    return new Response(null, {
        status: ['GET', 'HEAD'].includes(request.method) ? 301 : 308,
        headers: { Location: location, 'Cache-Control': 'public, max-age=3600' }
    });
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
