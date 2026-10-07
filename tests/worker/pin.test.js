import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
    authorizedMember, handlePinRequest, issueUnlock, LONG_LOCK_AFTER, pinStatus, requirePinUnlocked,
    SHORT_LOCK_AFTER, UNLOCK_SECONDS, validatePin
} from '../../worker/pin.ts';
import worker from '../../worker/index.ts';

const migration = name => readFileSync(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8');
const owner = { id: 'owner-1', email: 'owner@example.test', role: 'owner' };
const other = { id: 'printer-1', email: 'printer@example.test', role: 'print_operator' };
const now = () => Math.floor(Date.now() / 1000);
const identity = (overrides = {}) => ({ subject: 'owner-subject', email: owner.email, issuedAt: now() - 3600, ...overrides });

function fixture(t) {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    sqlite.exec(migration('0001_business.sql'));
    sqlite.exec(migration('0008_member_pins.sql'));
    for (const member of [owner, other]) {
        sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
    }
    const DB = {
        prepare(sql) {
            return {
                values: [],
                bind(...values) { this.values = values; return this; },
                async first() { return sqlite.prepare(sql).get(...this.values) ?? null; },
                async run() { sqlite.prepare(sql).run(...this.values); return { success: true }; }
            };
        }
    };
    return { sqlite, env: { DB, ENVIRONMENT: 'production', GUEST_TOKEN_SECRET: 's'.repeat(64) } };
}

const post = (path, body, cookie) => new Request(`https://www.example.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
});
const get = (path, cookie) => new Request(`https://www.example.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const cookieFrom = response => response.headers.get('Set-Cookie')?.split(';')[0];
async function call(env, path, body, { member = owner, id = identity(), cookie } = {}) {
    const response = await handlePinRequest(post(path, body, cookie), env, member, id);
    return { response, status: response.status, body: await response.clone().json(), cookie: cookieFrom(response) };
}

test('PINs are 4-6 digits and reject repeated or sequential patterns', () => {
    for (const pin of ['2580', '73914', '409182']) assert.equal(validatePin(pin), pin);
    for (const pin of ['123', '1234567', '12a4', 4821, '', null]) assert.throws(() => validatePin(pin), { code: 'invalid_pin' });
    for (const pin of ['0000', '1234', '9876', '7890', '345678', '999999']) assert.throws(() => validatePin(pin), { code: 'weak_pin' });
});

test('first setup stores only a salted hash, unlocks this device and cannot be repeated', async t => {
    const { sqlite, env } = fixture(t);
    await assert.rejects(requirePinUnlocked(get('/api/orders'), env, owner, identity()), { status: 428, code: 'pin_setup_required' });
    const setup = await call(env, '/api/pin/setup', { pin: '2580' });
    assert.equal(setup.status, 200);
    const header = setup.response.headers.get('Set-Cookie');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${UNLOCK_SECONDS}`]) {
        assert.ok(header.includes(attribute), attribute);
    }
    const row = sqlite.prepare('SELECT * FROM member_pins').get();
    assert.ok(!JSON.stringify(row).includes('"2580"'));
    assert.ok(row.iterations >= 100000);
    await requirePinUnlocked(get('/api/orders', setup.cookie), env, owner, identity());
    assert.deepEqual(await pinStatus(get('/api/session', setup.cookie), env, owner, identity()),
        { configured: true, unlocked: true, lockedUntil: null, resetAvailable: false });
    await assert.rejects(call(env, '/api/pin/setup', { pin: '4821' }), { status: 409, code: 'pin_exists' });
    await assert.rejects(call(env, '/api/pin/setup', { pin: '1111' }), { code: 'weak_pin' });
});

test('a signed-in device without the unlock cookie must enter the PIN', async t => {
    const { env } = fixture(t);
    await call(env, '/api/pin/setup', { pin: '2580' });
    await assert.rejects(requirePinUnlocked(get('/api/orders'), env, owner, identity()), { status: 423, code: 'pin_required' });
    const status = await pinStatus(get('/api/session'), env, owner, identity());
    assert.equal(status.unlocked, false);
    const unlock = await call(env, '/api/pin/unlock', { pin: '2580' });
    assert.equal(unlock.status, 200);
    await requirePinUnlocked(get('/api/orders', unlock.cookie), env, owner, identity());
});

test('unlock cookies are bound to the member, Access identity, PIN version, signature and expiry', async t => {
    const { env } = fixture(t);
    const { cookie } = await call(env, '/api/pin/setup', { pin: '2580' });
    await call(env, '/api/pin/setup', { pin: '4821' }, { member: other, id: identity({ subject: 'printer-subject', email: other.email }) })
        .catch(() => {});
    const value = cookie.split('=')[1];
    const [payload, signature] = value.split('.');
    const tampered = `st_pin=${payload}.${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    await assert.rejects(requirePinUnlocked(get('/x', tampered), env, owner, identity()), { code: 'pin_required' });
    await assert.rejects(requirePinUnlocked(get('/x', cookie), env, other, identity({ subject: 'printer-subject' })), { code: 'pin_required' });
    await assert.rejects(requirePinUnlocked(get('/x', cookie), env, owner, identity({ subject: 'someone-else' })), { code: 'pin_required' });
    await assert.rejects(requirePinUnlocked(get('/x', `${cookie}; ${cookie}`), env, owner, identity()), { code: 'pin_required' });
    const expired = await issueUnlock(env, owner, identity(), 1, Date.now() - (UNLOCK_SECONDS + 5) * 1000);
    await assert.rejects(requirePinUnlocked(get('/x', `st_pin=${expired}`), env, owner, identity()), { code: 'pin_required' });
    const otherKey = await issueUnlock({ ...env, GUEST_TOKEN_SECRET: 'z'.repeat(64) }, owner, identity(), 1);
    await assert.rejects(requirePinUnlocked(get('/x', `st_pin=${otherKey}`), env, owner, identity()), { code: 'pin_required' });
    await requirePinUnlocked(get('/x', cookie), env, owner, identity());
});

test('wrong PINs lock the account for 15 minutes after 5 tries and 24 hours after 10', async t => {
    const { sqlite, env } = fixture(t);
    await call(env, '/api/pin/setup', { pin: '2580' });
    for (let attempt = 1; attempt < SHORT_LOCK_AFTER; attempt++) {
        const wrong = await call(env, '/api/pin/unlock', { pin: '1357' });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.body.error.code, 'pin_incorrect');
        assert.equal(wrong.body.error.remaining, SHORT_LOCK_AFTER - attempt);
        assert.equal(wrong.cookie, undefined);
    }
    const lockout = await call(env, '/api/pin/unlock', { pin: '1357' });
    assert.equal(lockout.status, 423);
    const minutes = (Date.parse(lockout.body.error.lockedUntil) - Date.now()) / 60000;
    assert.ok(minutes > 14 && minutes <= 15, `${minutes}`);
    const correctWhileLocked = await call(env, '/api/pin/unlock', { pin: '2580' });
    assert.equal(correctWhileLocked.status, 423, 'the right PIN does not bypass a lockout');
    assert.equal((await pinStatus(get('/api/session'), env, owner, identity())).lockedUntil, lockout.body.error.lockedUntil);

    const expire = () => sqlite.prepare("UPDATE member_pins SET locked_until = '2000-01-01T00:00:00.000Z'").run();
    expire();
    for (let attempt = SHORT_LOCK_AFTER + 1; attempt < LONG_LOCK_AFTER; attempt++) {
        assert.equal((await call(env, '/api/pin/unlock', { pin: '1357' })).status, 423, 'each later miss re-locks');
        expire();
    }
    const longLock = await call(env, '/api/pin/unlock', { pin: '1357' });
    const hours = (Date.parse(longLock.body.error.lockedUntil) - Date.now()) / 3600000;
    assert.ok(hours > 23.9 && hours <= 24, `${hours}`);
    expire();
    const ok = await call(env, '/api/pin/unlock', { pin: '2580' });
    assert.equal(ok.status, 200);
    assert.deepEqual({ ...sqlite.prepare('SELECT failed_attempts, locked_until FROM member_pins').get() },
        { failed_attempts: 0, locked_until: null });
});

test('changing the PIN requires the current PIN and signs out other unlocked devices', async t => {
    const { env } = fixture(t);
    const first = await call(env, '/api/pin/setup', { pin: '2580' });
    const wrong = await call(env, '/api/pin/change', { currentPin: '1357', pin: '4821' }, { cookie: first.cookie });
    assert.equal(wrong.status, 401);
    const changed = await call(env, '/api/pin/change', { currentPin: '2580', pin: '4821' });
    assert.equal(changed.status, 200);
    await assert.rejects(requirePinUnlocked(get('/x', first.cookie), env, owner, identity()), { code: 'pin_required' });
    await requirePinUnlocked(get('/x', changed.cookie), env, owner, identity());
    assert.equal((await call(env, '/api/pin/unlock', { pin: '2580' })).status, 401);
    assert.equal((await call(env, '/api/pin/unlock', { pin: '4821' })).status, 200);
});

test('a forgotten PIN can be reset only right after a new emailed-code sign-in', async t => {
    const { sqlite, env } = fixture(t);
    const first = await call(env, '/api/pin/setup', { pin: '2580' });
    await assert.rejects(call(env, '/api/pin/reset', { pin: '4821' }), { status: 403, code: 'fresh_sign_in_required' });
    const fresh = identity({ issuedAt: now() - 60 });
    assert.equal((await pinStatus(get('/api/session'), env, owner, fresh)).resetAvailable, true);
    sqlite.prepare("UPDATE member_pins SET failed_attempts = 7, locked_until = '2999-01-01T00:00:00.000Z'").run();
    const reset = await call(env, '/api/pin/reset', { pin: '4821' }, { id: fresh });
    assert.equal(reset.status, 200);
    assert.deepEqual({ ...sqlite.prepare('SELECT version, failed_attempts, locked_until FROM member_pins').get() },
        { version: 2, failed_attempts: 0, locked_until: null });
    await assert.rejects(requirePinUnlocked(get('/x', first.cookie), env, owner, fresh), { code: 'pin_required' });
    await requirePinUnlocked(get('/x', reset.cookie), env, owner, fresh);
});

test('locking clears the unlock cookie; unknown or non-POST paths are ignored', async t => {
    const { env } = fixture(t);
    const lock = await call(env, '/api/pin/lock', {});
    assert.match(lock.response.headers.get('Set-Cookie'), /^st_pin=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
    assert.equal(await handlePinRequest(get('/api/pin/unlock'), env, owner, identity()), null);
    assert.equal(await handlePinRequest(post('/api/orders', {}), env, owner, identity()), null);
    await assert.rejects(call(env, '/api/pin/unlock', { pin: '2580' }), { status: 428 });
    await assert.rejects(handlePinRequest(post('/api/pin/setup', { pin: '2580' }), { ...env, GUEST_TOKEN_SECRET: 'short' }, owner, identity()),
        { status: 503, code: 'pin_unavailable' });
});

test('private routes outside the main router also require Access before any PIN check', async t => {
    const { env } = fixture(t);
    await assert.rejects(authorizedMember(get('/api/media/objects/x'), {
        ...env, ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'a'.repeat(64)
    }), { status: 401, code: 'sign_in_required' });
});

test('PIN unlocks stay available during read-only maintenance, unlike business writes', async () => {
    const env = { ENVIRONMENT: 'production', MUTATIONS_ENABLED: 'false', DB: {},
        ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'a'.repeat(64) };
    const pin = await worker.fetch(post('/api/pin/unlock', { pin: '2580' }), env);
    assert.equal((await pin.json()).error.code, 'sign_in_required');
    const write = await worker.fetch(post('/api/orders', {}), env);
    assert.equal((await write.json()).error.code, 'maintenance_read_only');
});
