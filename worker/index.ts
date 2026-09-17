import { findMember, verifyAccessIdentity } from './auth.ts';
import { HttpError } from './errors.ts';
import type { AppEnv } from './env.ts';
import { json, sameOriginMutation } from './http.ts';
import { OrderStoreError } from './order-store.ts';
import { handleBusinessRequest } from './business-api.ts';
import { handlePublicRequest } from './public-api.ts';
import { handleProductionRequest } from './production-api.ts';
import { handleMediaRequest, handleSmsRequest } from './media-api.ts';

export type Env = AppEnv;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const requestId = crypto.randomUUID();
        try {
            if (!['staging', 'production'].includes(env.ENVIRONMENT)) {
                throw new HttpError(503, 'environment_not_ready', 'This deployment is not configured.');
            }
            const path = new URL(request.url).pathname;
            sameOriginMutation(request);
            const readOnlyPost = request.method === 'POST' && path === '/api/public/track';
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !readOnlyPost && env.MUTATIONS_ENABLED !== 'true') {
                throw new HttpError(503, 'maintenance_read_only', 'This environment is temporarily read-only. Your changes have not been saved.');
            }
            if (path === '/health' && request.method === 'GET') {
                return json({ service: `sportstech-${env.ENVIRONMENT}`, status: 'ok', version: env.VERSION?.id || null });
            }
            if (path.startsWith('/api/public/') || path.startsWith('/api/media/receipts')) {
                const response = await handlePublicRequest(request, env);
                if (response) return response;
                throw new HttpError(404, 'not_found', 'Endpoint not found.');
            }
            if (path.startsWith('/api/media/objects/') && request.method === 'GET') {
                const response = await handleMediaRequest(request, env);
                if (response) return response;
                throw new HttpError(404, 'not_found', 'File not found.');
            }
            const privatePage = /^\/(?:admin|print)(?:\/|$)/.test(path);
            if (path.startsWith('/api/') || privatePage) {
                const member = await findMember(env.DB, await verifyAccessIdentity(request, env));
                if (privatePage) {
                    if (member.role === 'print_operator' && path.startsWith('/admin')) {
                        return Response.redirect(new URL('/print', request.url).href, 302);
                    }
                    if (path.startsWith('/print') && env.PRINT_QUEUE_ENABLED !== 'true') {
                        throw new HttpError(404, 'not_found', 'The print queue is not enabled.');
                    }
                } else {
                    if (path === '/api/session' && request.method === 'GET') {
                        const row = await env.DB.prepare('SELECT profile FROM member_profiles WHERE member_id=?')
                            .bind(member.id).first<{ profile: string }>();
                        return json({ member, profile: row ? JSON.parse(row.profile) : {},
                            environment: env.ENVIRONMENT, mutationsEnabled: env.MUTATIONS_ENABLED === 'true' });
                    }
                    const response = await handleMediaRequest(request, env, member)
                        || await handleSmsRequest(request, env, member)
                        || await handleProductionRequest(request, env, member)
                        || await handleBusinessRequest(request, env, member);
                    if (response) return response;
                    throw new HttpError(404, 'not_found', 'Endpoint not found.');
                }
            }
            if (!['GET', 'HEAD'].includes(request.method)) {
                throw new HttpError(405, 'method_not_allowed', 'This endpoint does not accept that method.');
            }
            if (!env.ASSETS) throw new HttpError(503, 'app_not_ready', 'Application assets are not configured.');
            const response = await env.ASSETS.fetch(request);
            if (privatePage) {
                const headers = new Headers(response.headers);
                headers.set('Cache-Control', 'private, no-store');
                return new Response(response.body, { status: response.status, headers });
            }
            return response;
        } catch (error) {
            const expected = error instanceof HttpError || error instanceof OrderStoreError;
            const status = expected ? error.status : 500;
            const code = expected ? error.code : 'internal_error';
            if (status >= 500) {
                // Never log request headers, tokens, full URLs or database/customer payloads.
                console.error(JSON.stringify({ requestId, code, errorType: error instanceof Error ? error.name : 'UnknownError' }));
            }
            return json({
                error: {
                    code,
                    message: expected ? error.message : 'The request could not be completed.',
                    requestId
                }
            }, status);
        }
    }
} satisfies ExportedHandler<Env>;
