import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest } from '../../worker/business-api.ts';
import { findMember } from '../../worker/auth.ts';
import { HttpError } from '../../worker/errors.ts';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const members = {
    owner: { id: 'owner', email: 'owner@example.invalid', role: 'owner' },
    partner: { id: 'partner', email: 'partner@example.invalid', role: 'owner' },
    reseller: { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' },
    printer: { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' }
};

class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of Object.values(members)) {
            this.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
        }
        this.beforeMutation = null;
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { assert.ok(values.length <= 100); this.values = values; return this; },
            async all() { return { success: true, results: db.sqlite.prepare(sql).all(...this.values) }; },
            async first() { return db.sqlite.prepare(sql).get(...this.values) ?? null; }
        };
    }
    async batch(statements) {
        assert.ok(statements.length <= 50);
        if (this.beforeMutation && statements.some(statement => statement.sql.startsWith('INSERT INTO _business_guards'))) {
            const hook = this.beforeMutation;
            this.beforeMutation = null;
            await hook();
        }
        this.sqlite.exec('BEGIN');
        try {
            const results = statements.map(statement => ({ success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values) }));
            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
    }
}

let sequence = 0;
const requestId = () => `team-${++sequence}`;
async function call(db, path, method = 'GET', body, actor = members.owner) {
    const response = await handleBusinessRequest(new Request(`https://www.example.test${path}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), { DB: db, ENVIRONMENT: 'production', PRINT_QUEUE_ENABLED: 'false' }, actor);
    assert.ok(response, `${method} ${path} was not handled`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
}
const failure = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.equal(error.status, status, error.message);
    if (code) assert.equal(error.code, code);
    return true;
};
const row = (db, id) => ({ ...db.sqlite.prepare('SELECT role, active, access_subject FROM members WHERE id=?').get(id) });

test('the owner sees the team with sign-in and PIN status but never Access identifiers', async t => {
    const db = new LocalD1(t);
    db.sqlite.prepare("UPDATE members SET access_subject='private-subject' WHERE id='reseller'").run();
    db.sqlite.prepare("INSERT INTO member_pins(member_id,pin_hash,salt,iterations) VALUES ('reseller','h','s',100000)").run();
    const { members: list } = await call(db, '/api/team');
    assert.equal(list.length, 4);
    const reseller = list.find(member => member.id === 'reseller');
    assert.deepEqual({ ...reseller, createdAt: undefined }, {
        id: 'reseller', email: members.reseller.email, role: 'reseller', active: true,
        signedIn: true, hasPin: true, name: '', createdAt: undefined
    });
    assert.equal(list.find(member => member.id === 'printer').signedIn, false);
    assert.doesNotMatch(JSON.stringify(list), /private-subject|access_subject|pin_hash/);
    for (const actor of [members.reseller, members.printer]) {
        await assert.rejects(call(db, '/api/team', 'GET', undefined, actor), failure(403, 'forbidden'));
    }
});

test('inviting adds an individual email with a role, is idempotent and lets that email sign in', async t => {
    const db = new LocalD1(t);
    const body = { email: '  New.Staff@Example.invalid ', name: 'New staff', role: 'reseller', requestId: requestId() };
    const invited = await call(db, '/api/team', 'POST', body);
    assert.deepEqual({ ...invited.member, id: undefined, createdAt: undefined }, {
        id: undefined, email: 'new.staff@example.invalid', role: 'reseller', active: true,
        signedIn: false, hasPin: false, name: 'New staff', createdAt: undefined
    });
    assert.deepEqual(await call(db, '/api/team', 'POST', body), invited, 'replaying the same request returns the same result');
    await assert.rejects(call(db, '/api/team', 'POST', { ...body, requestId: requestId() }), failure(409, 'member_exists'));
    await assert.rejects(call(db, '/api/team', 'POST', { ...body, email: 'OWNER@example.invalid', requestId: requestId() }), failure(409, 'member_exists'));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM business_events WHERE action='team.invite'").get().n, 1);

    const signedIn = await findMember(db, { subject: 'new-staff-subject', email: 'new.staff@example.invalid', issuedAt: 0 });
    assert.deepEqual(signedIn, { id: invited.member.id, email: 'new.staff@example.invalid', role: 'reseller' });
    assert.equal((await call(db, '/api/team')).members.find(member => member.id === invited.member.id).signedIn, true);
});

test('invitations reject bad input, unknown roles and non-owners', async t => {
    const db = new LocalD1(t);
    const valid = { email: 'staff@example.invalid', role: 'print_operator', requestId: requestId() };
    for (const email of ['not-an-email', 'a@example.invalid,b@example.invalid', 'a..b@example.invalid', '']) {
        await assert.rejects(call(db, '/api/team', 'POST', { ...valid, email, requestId: requestId() }), failure(400));
    }
    for (const role of ['admin', 'staff', 'OWNER', null]) {
        await assert.rejects(call(db, '/api/team', 'POST', { ...valid, role, requestId: requestId() }), failure(400));
    }
    await assert.rejects(call(db, '/api/team', 'POST', { ...valid, active: false }), failure(400));
    await assert.rejects(call(db, '/api/team', 'POST', valid, members.reseller), failure(403, 'forbidden'));
    await assert.rejects(call(db, '/api/team', 'POST', valid, members.printer), failure(403, 'forbidden'));
    db.sqlite.prepare("UPDATE members SET active=0 WHERE id='owner'").run();
    await assert.rejects(call(db, '/api/team', 'POST', valid), failure(403, 'forbidden'));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM members WHERE email='staff@example.invalid'").get().n, 0);
});

test('owners change roles and access immediately, but never their own', async t => {
    const db = new LocalD1(t);
    await call(db, '/api/team/partner', 'PATCH', { role: 'reseller', requestId: requestId() });
    assert.equal(row(db, 'partner').role, 'reseller');
    await call(db, '/api/team/partner', 'PATCH', { role: 'owner', requestId: requestId() });
    assert.equal(row(db, 'partner').role, 'owner');

    const off = await call(db, '/api/team/reseller', 'PATCH', { active: false, requestId: requestId() });
    assert.equal(off.member.active, false);
    await assert.rejects(findMember(db, { subject: 'reseller-subject', email: members.reseller.email, issuedAt: 0 }), failure(403, 'access_denied'));
    await call(db, '/api/team/reseller', 'PATCH', { active: true, requestId: requestId() });
    assert.equal((await findMember(db, { subject: 'reseller-subject', email: members.reseller.email, issuedAt: 0 })).role, 'reseller');

    for (const change of [{ active: false }, { role: 'reseller' }]) {
        await assert.rejects(call(db, '/api/team/owner', 'PATCH', { ...change, requestId: requestId() }), failure(400));
    }
    assert.deepEqual(row(db, 'owner'), { role: 'owner', active: 1, access_subject: null });
    await assert.rejects(call(db, '/api/team/missing', 'PATCH', { active: false, requestId: requestId() }), failure(404, 'member_not_found'));
    await assert.rejects(call(db, '/api/team/partner', 'PATCH', { requestId: requestId() }), failure(400));
    await assert.rejects(call(db, '/api/team/partner', 'PATCH', { active: 'no', requestId: requestId() }), failure(400));
    await assert.rejects(call(db, '/api/team/partner', 'PATCH', { active: false, requestId: requestId() }, members.reseller), failure(403));
    await assert.rejects(call(db, '/api/team/partner', 'PATCH', { active: false, requestId: requestId() }, members.printer), failure(403));
    // Another owner can manage this owner, so the business is never left without one.
    await call(db, '/api/team/owner', 'PATCH', { role: 'reseller', requestId: requestId() }, members.partner);
    assert.equal(row(db, 'owner').role, 'reseller');
});

test('print staff keep their role so pay and job history stay attributed, but can be deactivated', async t => {
    const db = new LocalD1(t);
    await assert.rejects(call(db, '/api/team/printer', 'PATCH', { role: 'reseller', requestId: requestId() }), failure(400));
    await assert.rejects(call(db, '/api/team/reseller', 'PATCH', { role: 'print_operator', requestId: requestId() }), failure(400));
    await call(db, '/api/team/printer', 'PATCH', { active: false, requestId: requestId() });
    assert.deepEqual(row(db, 'printer'), { role: 'print_operator', active: 0, access_subject: null });
});

test('a concurrent change makes a stale update fail instead of overwriting it', async t => {
    const db = new LocalD1(t);
    db.beforeMutation = () => db.sqlite.prepare("UPDATE members SET active=0 WHERE id='reseller'").run();
    await assert.rejects(call(db, '/api/team/reseller', 'PATCH', { role: 'owner', requestId: requestId() }), failure(409));
    assert.deepEqual(row(db, 'reseller'), { role: 'reseller', active: 0, access_subject: null });
});

test('the owner can reset another member PIN so they choose a new one, not their own', async t => {
    const db = new LocalD1(t);
    db.sqlite.prepare("INSERT INTO member_pins(member_id,pin_hash,salt,iterations) VALUES ('partner','h','s',100000)").run();
    const reset = await call(db, '/api/team/partner/reset-pin', 'POST', { requestId: requestId() });
    assert.equal(reset.member.hasPin, false);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM member_pins WHERE member_id='partner'").get().n, 0);
    await assert.rejects(call(db, '/api/team/owner/reset-pin', 'POST', { requestId: requestId() }), failure(400));
    await assert.rejects(call(db, '/api/team/partner/reset-pin', 'POST', { requestId: requestId() }, members.reseller), failure(403));
    await assert.rejects(call(db, '/api/team/missing/reset-pin', 'POST', { requestId: requestId() }), failure(404));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM business_events WHERE action='team.reset_pin'").get().n, 1);
});
