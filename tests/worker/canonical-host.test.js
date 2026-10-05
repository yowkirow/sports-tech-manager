import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import worker from '../../worker/index.ts';
import { canonicalRedirect } from '../../worker/http.ts';

const env = {
    ENVIRONMENT: 'production', CANONICAL_HOST: 'www.sportstechph.store', REDIRECT_HOSTS: 'sportstechph.store',
    ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'a'.repeat(64), MUTATIONS_ENABLED: 'false'
};

test('the bare domain permanently redirects to the canonical storefront, preserving path and query', async () => {
    const response = await worker.fetch(new Request('https://sportstechph.store/track/ST-1?code=abc'), env);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), 'https://www.sportstechph.store/track/ST-1?code=abc');
    const post = await worker.fetch(new Request('https://SportsTechPH.store/api/public/checkout', { method: 'POST', body: '{}' }), env);
    assert.equal(post.status, 308, 'Non-GET requests keep their method and body across the redirect.');
});

test('the canonical host and unlisted hosts are served normally', async () => {
    const health = await worker.fetch(new Request('https://www.sportstechph.store/health'), env);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'sportstech-production');
    assert.equal(canonicalRedirect(new Request('https://sportstech-staging.example.workers.dev/'), env.CANONICAL_HOST, env.REDIRECT_HOSTS), null);
    assert.equal(canonicalRedirect(new Request('https://sportstechph.store/'), undefined, env.REDIRECT_HOSTS), null);
    assert.equal(canonicalRedirect(new Request('https://sportstechph.store/'), 'evil.example/path', env.REDIRECT_HOSTS), null);
    assert.equal(canonicalRedirect(new Request('https://www.sportstechph.store/'), 'www.sportstechph.store', 'www.sportstechph.store'), null);
});

test('the retired Vercel hostname redirects without affecting previews or the live domain before cutover', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.deepEqual(config.redirects, [{
        source: '/:path*', has: [{ type: 'host', value: 'sports-tech-manager.vercel.app' }],
        destination: 'https://www.sportstechph.store/:path*', permanent: true
    }]);
    assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
});
