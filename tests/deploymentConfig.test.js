import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const staging = read('wrangler.staging.jsonc');
const production = read('wrangler.production.jsonc');
const scripts = read('package.json').scripts;

test('Workers Paid deployments use a bounded CPU budget', () => {
    for (const config of [staging, production]) {
        assert.equal(config.limits.cpu_ms, 1000);
        assert.equal(config.preview_urls, false);
        assert.equal(config.main, 'worker/index.ts');
    }
    // Staging is an owner-protected, read-only review copy of the imported snapshot.
    assert.equal(staging.vars.MUTATIONS_ENABLED, 'false');
    assert.deepEqual(staging.assets.run_worker_first, ['/api/*', '/health', '/admin*', '/print*']);
});

test('production serves the live domain with isolated data and no employee rollout', () => {
    assert.equal(production.name, 'sportstech-production');
    assert.equal(production.vars.ENVIRONMENT, 'production');
    assert.equal(production.workers_dev, false);
    assert.deepEqual(production.routes, [
        { pattern: 'www.sportstechph.store/*', zone_name: 'sportstechph.store' },
        { pattern: 'sportstechph.store/*', zone_name: 'sportstechph.store' }
    ]);
    // Every request, including static pages, must reach the Worker so the bare
    // domain redirects to www instead of serving a storefront whose API calls fail.
    assert.equal(production.assets.run_worker_first, true);
    assert.equal(production.vars.MUTATIONS_ENABLED, 'true');
    assert.equal(production.vars.PRINT_QUEUE_ENABLED, 'false');
    // The production Access application (/admin and /print) has its own audience.
    assert.match(production.vars.ACCESS_AUDIENCE, /^[a-f0-9]{64}$/);
    assert.equal(production.vars.ACCESS_TEAM_DOMAIN, staging.vars.ACCESS_TEAM_DOMAIN);
    assert.notEqual(production.vars.ACCESS_AUDIENCE, staging.vars.ACCESS_AUDIENCE);
    assert.notEqual(production.d1_databases[0].database_id, staging.d1_databases[0].database_id);
    assert.notEqual(production.r2_buckets[0].bucket_name, staging.r2_buckets[0].bucket_name);
    assert.equal(production.d1_databases[0].database_name, 'sportstech-production');
    assert.equal(production.r2_buckets[0].bucket_name, 'sportstech-production-media');
    assert.equal(Object.hasOwn(production.vars, 'GUEST_TOKEN_SECRET'), false);
    assert.equal(production.vars.CANONICAL_HOST, 'www.sportstechph.store');
    assert.equal(production.vars.REDIRECT_HOSTS, 'sportstechph.store');
    assert.equal(Object.hasOwn(staging.vars, 'CANONICAL_HOST'), false);
});

test('production deploy rebuilds non-staging assets and migrations target only production', () => {
    assert.equal(scripts['deploy:production'],
        'npm run check:worker && npm run build && wrangler deploy --config wrangler.production.jsonc');
    assert.equal(scripts['db:production'],
        'wrangler d1 migrations apply sportstech-production --remote --config wrangler.production.jsonc');
});
