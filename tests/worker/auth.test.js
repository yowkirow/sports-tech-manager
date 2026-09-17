import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { findMember, verifyAccessIdentity } from '../../worker/auth.ts';
import worker from '../../worker/index.ts';

const config = {
    ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
    ACCESS_AUDIENCE: 'a'.repeat(64)
};
let privateKey;
let localKeys;
before(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    localKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test' }] });
});

async function token(overrides = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
        iss: `https://${config.ACCESS_TEAM_DOMAIN}`,
        aud: config.ACCESS_AUDIENCE,
        sub: 'verified-human-id',
        email: 'owner@example.test',
        type: 'app',
        iat: now,
        exp: now + 3600,
        ...overrides
    }).setProtectedHeader({ alg: 'RS256', kid: 'test', ...header }).sign(privateKey);
}

function request(jwt) {
    return new Request('https://staging.example.test/api/session', {
        headers: { 'Cf-Access-Jwt-Assertion': jwt }
    });
}

test('Access verifies the expected audience, issuer, signature and human identity', async () => {
    const identity = await verifyAccessIdentity(request(await token({ email: 'Owner@Example.test' })), config, localKeys);
    assert.deepEqual(identity, { subject: 'verified-human-id', email: 'owner@example.test' });
});

test('missing configuration and missing authentication cannot produce an owner', async () => {
    const req = new Request('https://staging.example.test/api/session', {
        headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.test' }
    });
    await assert.rejects(verifyAccessIdentity(req, { ...config, ACCESS_AUDIENCE: '' }, localKeys),
        { status: 503, code: 'access_not_configured' });
    await assert.rejects(verifyAccessIdentity(req, config, localKeys), { status: 401, code: 'sign_in_required' });
    await assert.rejects(verifyAccessIdentity(req, { ...config, ACCESS_TEAM_DOMAIN: 'untrusted.example' }, localKeys),
        { status: 503, code: 'access_not_configured' });
});

test('expired, wrong-audience, wrong-issuer and nonhuman tokens are rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const overrides of [
        { exp: now - 1 },
        { exp: undefined },
        { aud: 'b'.repeat(64) },
        { iss: 'https://other-team.cloudflareaccess.com' },
        { sub: '' },
        { email: undefined },
        { email: 'not-an-email' },
        { type: 'service' },
        { type: undefined },
        { iat: now + 300 }
    ]) {
        await assert.rejects(verifyAccessIdentity(request(await token(overrides)), config, localKeys),
            error => error.status === 401);
    }
});

test('forged signatures are rejected and key service failures are not disguised as invalid users', async () => {
    const valid = await token();
    const parts = valid.split('.');
    parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
    await assert.rejects(verifyAccessIdentity(request(parts.join('.')), config, localKeys), { status: 401 });
    await assert.rejects(verifyAccessIdentity(request(valid), config, async () => {
        throw new TypeError('network unavailable');
    }), { status: 503, code: 'identity_service_unavailable' });
});

function members(t) {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    sqlite.exec(`CREATE TABLE members (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, access_subject TEXT UNIQUE,
        role TEXT NOT NULL, active INTEGER NOT NULL
    )`);
    return {
        sqlite,
        prepare(sql) {
            return {
                bind(...args) {
                    return { async first() { return sqlite.prepare(sql).get(...args) ?? null; } };
                }
            };
        }
    };
}

test('only a pre-provisioned exact email can bind a verified subject, without granting new roles', async t => {
    const db = members(t);
    const identity = { subject: 'human-1', email: 'owner@example.test' };
    await assert.rejects(findMember(db, identity), { status: 403 });
    db.sqlite.prepare('INSERT INTO members VALUES (?, ?, NULL, ?, 1)').run('owner-1', identity.email, 'owner');
    assert.deepEqual(await findMember(db, identity), { id: 'owner-1', email: identity.email, role: 'owner' });
    assert.equal(db.sqlite.prepare('SELECT access_subject FROM members').get().access_subject, identity.subject);
    assert.deepEqual(await findMember(db, identity), { id: 'owner-1', email: identity.email, role: 'owner' });
    await assert.rejects(findMember(db, { ...identity, subject: 'replacement-id' }),
        { status: 403, code: 'identity_changed' });
    await assert.rejects(findMember(db, { ...identity, email: 'uninvited@example.test' }), { status: 403 });
    db.sqlite.prepare('UPDATE members SET active=0').run();
    await assert.rejects(findMember(db, identity), { status: 403 });
});

test('an authenticated printing identity retains its restricted role', async t => {
    const db = members(t);
    db.sqlite.prepare('INSERT INTO members VALUES (?, ?, NULL, ?, 1)').run('printer-1', 'printer@example.test', 'print_operator');
    const member = await findMember(db, { subject: 'printer-sub', email: 'printer@example.test' });
    assert.equal(member.role, 'print_operator');
});

test('the staging router returns explicit errors instead of exposing data or SPA fallbacks', async () => {
    const env = { ...config, ENVIRONMENT: 'staging', DB: {} };
    const health = await worker.fetch(new Request('https://staging.example.test/health'), env);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'sportstech-staging');
    const denied = await worker.fetch(new Request('https://staging.example.test/api/session'), env);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.equal(denied.headers.has('access-control-allow-origin'), false);
    assert.equal((await denied.json()).error.code, 'sign_in_required');
    const mutation = await worker.fetch(new Request('https://staging.example.test/api/orders', { method: 'POST' }), env);
    assert.equal(mutation.status, 405);
    const unavailable = await worker.fetch(new Request('https://staging.example.test/api/session'), { ...env, ACCESS_AUDIENCE: '' });
    assert.equal(unavailable.status, 503);
});
