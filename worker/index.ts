import { findMember, verifyAccessIdentity } from './auth.ts';
import type { AccessConfiguration } from './auth.ts';
import { HttpError } from './errors.ts';

export interface Env extends AccessConfiguration {
    ENVIRONMENT: string;
    DB: D1Database;
    VERSION?: { id: string };
}

const responseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const requestId = crypto.randomUUID();
        try {
            if (env.ENVIRONMENT !== 'staging') {
                throw new HttpError(503, 'environment_not_ready', 'This deployment is not configured.');
            }
            const path = new URL(request.url).pathname;
            if (request.method !== 'GET') {
                throw new HttpError(405, 'method_not_allowed', 'This endpoint does not accept that method.');
            }
            if (path === '/health') {
                return json({ service: 'sportstech-staging', status: 'ok', version: env.VERSION?.id || null });
            }
            const identity = await verifyAccessIdentity(request, env);
            const member = await findMember(env.DB, identity);
            if (path === '/api/session') {
                return json({ member });
            }
            if (path === '/' && member.role === 'owner') {
                return json({
                    status: 'staging-foundation',
                    message: 'Owner sign-in is configured. Application migration is not complete.',
                    productionChanged: false
                });
            }
            throw new HttpError(404, 'not_found', 'Endpoint not found.');
        } catch (error) {
            const status = error instanceof HttpError ? error.status : 500;
            const code = error instanceof HttpError ? error.code : 'internal_error';
            if (status >= 500) {
                // Never log request headers, tokens, full URLs or database/customer payloads.
                console.error(JSON.stringify({ requestId, code, errorType: error instanceof Error ? error.name : 'UnknownError' }));
            }
            return json({
                error: {
                    code,
                    message: error instanceof HttpError ? error.message : 'The request could not be completed.',
                    requestId
                }
            }, status);
        }
    }
} satisfies ExportedHandler<Env>;
