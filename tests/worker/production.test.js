import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleProductionRequest, MAX_BATCH_JOBS, productionReadyGuard } from '../../worker/production-api.ts';
import { HttpError } from '../../worker/errors.ts';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const SOURCE = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const printer = { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' };
const other = { id: 'other', email: 'other@example.invalid', role: 'print_operator' };
let sequence = 0;
const requestId = () => `production-test-${++sequence}`;

// Actual SQLite migrations and atomic rollback, not a SQL-string mock. Remote
// D1 limits/network behavior remain deployment checks owned by the coordinator.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        this.beforeBatch = null;
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) {
                assert.ok(values.length <= 100);
                assert.ok(values.every(value => value !== undefined));
                this.values = values;
                return this;
            },
            async all() { return db.execute(this); }
        };
    }
    execute(statement) {
        return { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values), meta: {} };
    }
    async batch(statements) {
        const hook = this.beforeBatch;
        this.beforeBatch = null;
        if (hook) await hook();
        this.sqlite.exec('BEGIN');
        try {
            const result = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
            return result;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error('D1_ERROR: atomic batch failed: SQLITE_CONSTRAINT_CHECK', {
                cause: new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`)
            });
        }
    }
}
function fixture(t, details = {}) {
    const db = new LocalD1(t);
    for (const member of [owner, printer, other, { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' }]) {
        db.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
    }
    db.sqlite.prepare("INSERT INTO member_profiles(member_id,profile) VALUES ('printer',?)")
        .run(JSON.stringify({ full_name: 'Sam', privateProfileField: 'PRIVATE PROFILE' }));
    db.sqlite.exec("INSERT INTO orders(id) VALUES ('ST-PRINT');");
    const base = {
        orderId: 'ST-PRINT', itemName: 'Court shirt', quantity: 10, brand: 'Sypik', size: 'M', color: 'Black',
        status: 'paid', customerName: 'PRIVATE CUSTOMER', contactNumber: 'PRIVATE CONTACT',
        customerAddress: 'PRIVATE ADDRESS', receiptUrl: 'PRIVATE RECEIPT', comments: ['PRIVATE COMMENT'],
        inventoryCost: 'PRIVATE COST', ...details
    };
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id)
        VALUES (?,'sale','Shirts','500','2026-09-17T00:00:00Z',?,'ST-PRINT')`).run(SOURCE, JSON.stringify(base));
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id)
        VALUES (?,'sale','Balls','25','2026-09-17T00:00:00Z',?,'ST-PRINT')`).run(SECOND,
        JSON.stringify({ orderId: 'ST-PRINT', itemName: 'Ball', quantity: 1, status: 'paid' }));
    return { db, env: { DB: db, PRINT_QUEUE_ENABLED: 'true' } };
}
async function call(f, path = '/jobs', body, member = owner, method = body === undefined ? 'GET' : 'POST') {
    const response = await handleProductionRequest(new Request(`https://example.invalid${path.startsWith('/api/') ? path : `/api/production${path}`}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), f.env, member);
    return response ? response.json() : null;
}
const failure = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return true;
};
async function prepare(f, extra = {}) {
    const { sources } = await call(f, '/sources');
    const source = sources.find(source => source.sourceId === (extra.sourceId || SOURCE)
        && (extra.itemIndex === undefined || source.itemIndex === extra.itemIndex));
    return (await call(f, '/jobs', { sourceId: SOURCE, assigneeId: printer.id,
        expectedSourceToken: source?.sourceToken, requestId: requestId(), instructions: 'Use the separately supplied artwork.', ...extra })).job;
}
async function release(f, job, extra = {}) {
    return (await call(f, `/jobs/${job.id}/release`, { expectedVersion: job.version,
        requestId: requestId(), artworkReady: true, blanksReady: true, ...extra })).job;
}
async function progress(f, job, action, extra = {}, member = printer) {
    return (await call(f, `/jobs/${job.id}/progress`, { expectedVersion: job.version,
        requestId: requestId(), action, ...extra }, member)).job;
}
async function qa(f, job, accepted, rejected, extra = {}) {
    return (await call(f, `/jobs/${job.id}/qa`, { expectedVersion: job.version,
        requestId: requestId(), accepted, rejected, ...(rejected ? { note: 'Align the print again.' } : {}), ...extra })).job;
}
function changeSource(f, change, id = SOURCE) {
    const details = JSON.parse(f.db.sqlite.prepare('SELECT details FROM transactions WHERE id=?').get(id).details);
    f.db.sqlite.prepare('UPDATE transactions SET details=? WHERE id=?').run(JSON.stringify({ ...details, ...change }), id);
}
function snapshot(f) {
    return Object.fromEntries(['transactions', 'orders', 'production_jobs', 'production_events', 'production_request_receipts', '_production_guards']
        .map(table => [table, f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test('flag defaults disabled and gates employee preparation as well as queue', async t => {
    const f = fixture(t);
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
        f.env.PRINT_QUEUE_ENABLED = flag;
        await assert.rejects(call(f), failure(404));
        await assert.rejects(call(f, '/api/members', { email: 'worker@example.invalid', role: 'print_operator', requestId: requestId() }), failure(404));
    }
    assert.equal(await call(f, '/api/members'), null);
});

test('employees see only their released jobs, safe explicit fields and safe actor names', async t => {
    const f = fixture(t);
    let job = await prepare(f);
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, []);
    job = await release(f, job);
    assert.deepEqual((await call(f, '/jobs', undefined, other)).jobs, []);
    const response = await call(f, '/jobs?orderId=ST-PRINT', undefined, printer);
    assert.equal(response.jobs.length, 1);
    assert.equal(response.jobs[0].assignee.name, 'Sam');
    assert.equal(response.jobs[0].jobCode, job.jobCode);
    // Owner decision 2026-10-13: the customer's name is shown for package labels; nothing else.
    assert.equal(response.jobs[0].customerName, 'PRIVATE CUSTOMER');
    const encoded = JSON.stringify(response);
    for (const forbidden of ['PRIVATE CONTACT', 'PRIVATE ADDRESS', 'PRIVATE RECEIPT', 'PRIVATE COMMENT', 'PRIVATE COST', 'PRIVATE PROFILE', 'ST-PRINT']) {
        assert.ok(!encoded.includes(forbidden), forbidden);
    }
    const { customerName, ...rest } = response.jobs[0];
    const others = JSON.stringify({ ...response, jobs: [rest] });
    for (const forbidden of ['PRIVATE', 'email', 'sourceId', 'orderId', 'amount', 'customer', 'receipt', 'cost', 'contact', 'shipping']) {
        assert.ok(!others.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
    }
    assert.deepEqual(Object.keys(response.jobs[0]).sort(), [
        'accepted', 'assignee', 'awaitingQA', 'brand', 'color', 'customerName', 'designImageUrl', 'designName', 'events', 'id', 'instructions',
        'jobCode', 'rejected', 'releasedAt', 'remainingToPrint', 'required', 'reworkRemaining', 'size', 'status', 'bookingNumber', 'updatedAt', 'version'
    ].sort());
    // No LBC booking number on this order yet.
    assert.equal(response.jobs[0].bookingNumber, null);
});

test('release requires explicit readiness and atomically moves every order row out of pending', async t => {
    const f = fixture(t);
    const job = await prepare(f);
    const before = snapshot(f);
    await assert.rejects(release(f, job, { blanksReady: false }), failure(400));
    assert.deepEqual(snapshot(f), before);
    const released = await release(f, job);
    assert.equal(released.status, 'released');
    assert.equal(f.db.sqlite.prepare("SELECT version FROM orders WHERE id='ST-PRINT'").get().version, 1);
    assert.deepEqual(f.db.sqlite.prepare("SELECT json_extract(details,'$.fulfillmentStatus') AS status FROM transactions").all()
        .map(row => row.status), ['in_progress', 'in_progress']);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action='source_changed'").get().n, 0);
});

test('partial printing remains awaiting QA; rejection creates rework without duplicate acceptance', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'start');
    assert.equal(job.status, 'printing');
    job = await progress(f, job, 'printed', { quantity: 6 });
    assert.deepEqual([job.awaitingQA, job.accepted, job.remainingToPrint], [6, 0, 4]);
    job = await qa(f, job, 4, 2);
    assert.deepEqual([job.awaitingQA, job.accepted, job.rejected, job.reworkRemaining, job.remainingToPrint], [0, 4, 2, 2, 6]);
    job = await progress(f, job, 'printed', { quantity: 3 });
    assert.deepEqual([job.awaitingQA, job.accepted, job.reworkRemaining, job.remainingToPrint], [3, 4, 0, 3]);
    job = await qa(f, job, 3, 0);
    job = await progress(f, job, 'printed', { quantity: 3 });
    job = await qa(f, job, 3, 0);
    assert.deepEqual([job.status, job.required, job.accepted, job.awaitingQA, job.remainingToPrint], ['completed', 10, 10, 0, 0]);
    assert.equal(job.events.filter(event => event.action === 'qa').length, 3);
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs[0].status, 'completed');
    await assert.rejects(progress(f, job, 'printed', { quantity: 1 }), failure(409));
    await assert.rejects(qa(f, job, 1, 0), failure(409));
});

test('reviewed replacement preserves old production counts and creates a fresh releasable draft', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'printed', { quantity: 5 });
    job = await qa(f, job, 4, 1);
    changeSource(f, { size: 'XL', quantity: 8 });
    const held = (await call(f)).jobs.find(item => item.id === job.id);
    assert.equal(held.status, 'held');
    const { sources } = await call(f, '/sources');
    const source = sources.find(item => item.sourceId === SOURCE);
    const input = { expectedVersion: held.version, requestId: requestId(), confirmed: true, note: 'Owner approved corrected XL quantity.',
        itemIndex: null, expectedSourceToken: source.sourceToken, assigneeId: printer.id };
    await assert.rejects(call(f, `/jobs/${job.id}/revise`, input, printer), failure(403));
    const revised = (await call(f, `/jobs/${job.id}/revise`, input)).job;
    assert.notEqual(revised.id, job.id);
    assert.deepEqual([revised.status, revised.size, revised.required, revised.accepted, revised.awaitingQA], ['draft', 'XL', 8, 0, 0]);
    const old = f.db.sqlite.prepare('SELECT status,accepted,rejected,pending,superseded_by FROM production_jobs WHERE id=?').get(job.id);
    assert.deepEqual({ ...old }, { status: 'superseded', accepted: 4, rejected: 1, pending: 0, superseded_by: revised.id });
    assert.equal((await call(f, `/jobs/${job.id}/revise`, input)).job.id, revised.id);
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs.length, 0);
    const released = await release(f, revised);
    assert.equal(released.status, 'released');
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs[0].id, revised.id);
});

test('physical edits of accepted work revoke Ready while unrelated financial metadata does not', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'printed', { quantity: 10 });
    job = await qa(f, job, 10, 0);
    changeSource(f, { fulfillmentStatus: 'ready', status: 'ready', packingConfirmed: true });
    changeSource(f, { paymentStatus: 'paid' });
    assert.equal(JSON.parse(f.db.sqlite.prepare('SELECT details FROM transactions WHERE id=?').get(SOURCE).details).fulfillmentStatus, 'ready');
    changeSource(f, { size: 'L' });
    assert.equal(JSON.parse(f.db.sqlite.prepare('SELECT details FROM transactions WHERE id=?').get(SOURCE).details).fulfillmentStatus, 'in_progress');
    const original = f.db.sqlite.prepare('SELECT status,accepted,source_changed FROM production_jobs WHERE id=?').get(job.id);
    assert.deepEqual({ ...original }, { status: 'held', accepted: 10, source_changed: 1 });
});

test('owner may retire a held deleted-source job without erasing its event history', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    f.db.sqlite.prepare('DELETE FROM transactions WHERE id=?').run(SOURCE);
    const held = (await call(f)).jobs.find(item => item.id === job.id);
    const result = await call(f, `/jobs/${job.id}/revise`, {
        expectedVersion: held.version, requestId: requestId(), confirmed: true,
        note: 'Cancelled shirt line reviewed by owner.', retireOnly: true
    });
    assert.equal(result.job.status, 'superseded');
    assert.ok(result.job.events.some(event => event.action === 'source_deleted'));
    await f.db.batch([productionReadyGuard(f.db, 'ST-PRINT'), f.db.prepare('DELETE FROM _production_guards')]);
});

test('quantity validation, overprinting and excess QA rollback all writes', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    for (const quantity of [-1, 0, 1.5, '2', null, 100001]) {
        const before = snapshot(f);
        await assert.rejects(progress(f, job, 'printed', { quantity }), failure(400));
        assert.deepEqual(snapshot(f), before);
    }
    const before = snapshot(f);
    await assert.rejects(progress(f, job, 'printed', { quantity: 11 }), failure(409));
    await assert.rejects(qa(f, job, 1, 0), failure(409));
    assert.deepEqual(snapshot(f), before);
});

test('idempotency survives retry and rejects changed payloads and concurrent stale versions', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    const body = { expectedVersion: job.version, requestId: requestId(), action: 'printed', quantity: 3 };
    const first = await call(f, `/jobs/${job.id}/progress`, body, printer);
    const replay = await call(f, `/jobs/${job.id}/progress`, body, printer);
    assert.deepEqual(replay, first);
    await assert.rejects(call(f, `/jobs/${job.id}/progress`, { ...body, quantity: 4 }, printer), failure(409, 'production_receipt_conflict'));
    job = first.job;
    const result = await Promise.allSettled([progress(f, job, 'printed', { quantity: 2 }), progress(f, job, 'printed', { quantity: 2 })]);
    assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(result.find(item => item.status === 'rejected').reason.status, 409);
    assert.equal((await call(f, '/jobs')).jobs[0].awaitingQA, 5);
});

test('late receipt failure rolls back quantities, audit, revisions and transient guards', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    f.db.sqlite.exec(`CREATE TRIGGER fail_production_receipt BEFORE INSERT ON production_request_receipts
        BEGIN SELECT RAISE(ABORT,'production_write'); END;`);
    const before = snapshot(f);
    await assert.rejects(progress(f, job, 'printed', { quantity: 2 }), failure(409));
    assert.deepEqual(snapshot(f), before);
});

test('active role and exact assignment are rechecked inside the atomic batch', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    await assert.rejects(progress(f, job, 'start', {}, other), failure(403));
    await assert.rejects(call(f, '/jobs', undefined, { ...printer, role: 'owner' }), failure(403));
    await assert.rejects(call(f, '/sources', undefined, printer), failure(403));
    f.db.beforeBatch = () => f.db.sqlite.prepare('UPDATE production_jobs SET assignee_id=? WHERE id=?').run(other.id, job.id);
    await assert.rejects(progress(f, job, 'printed', { quantity: 2 }), failure(403));
    assert.equal(f.db.sqlite.prepare('SELECT pending FROM production_jobs WHERE id=?').get(job.id).pending, 0);
    job = (await call(f, '/jobs')).jobs[0];
    f.db.beforeBatch = () => f.db.sqlite.prepare("UPDATE members SET active=0 WHERE id='other'").run();
    await assert.rejects(progress(f, job, 'printed', { quantity: 2 }, other), failure(403));
});

test('hold withdraws visibility and even a previously successful receipt cannot bypass withdrawal', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    const body = { expectedVersion: job.version, requestId: requestId(), action: 'printed', quantity: 2 };
    job = (await call(f, `/jobs/${job.id}/progress`, body, printer)).job;
    job = (await call(f, `/jobs/${job.id}/hold`, { expectedVersion: job.version, requestId: requestId(), note: 'Wait for owner.' })).job;
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, []);
    await assert.rejects(call(f, `/jobs/${job.id}/progress`, body, printer), failure(403));
    await assert.rejects(progress(f, job, 'printed', { quantity: 1 }), failure(403));
    job = await release(f, job);
    assert.equal(job.awaitingQA, 2);
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs.length, 1);
});

test('physical source edits hold jobs atomically; financial metadata and returned tags do not', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    const original = snapshot(f);
    changeSource(f, { paymentStatus: 'paid', comments: ['PRIVATE NEW COMMENT'], returned: true, returnStatus: 'returned' });
    f.db.sqlite.prepare("UPDATE transactions SET amount='499' WHERE id=?").run(SOURCE);
    job = (await call(f, '/jobs')).jobs[0];
    assert.equal(job.status, 'released');
    assert.equal(job.version, 1);
    assert.deepEqual(snapshot(f).production_events, original.production_events);
    changeSource(f, { quantity: 9 });
    job = (await call(f, '/jobs')).jobs[0];
    assert.equal(job.status, 'held');
    assert.equal(job.sourceChanged, true);
    assert.equal(job.required, 10);
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, []);
    await assert.rejects(release(f, job), failure(409));
    const heldVersion = job.version;
    const heldEvents = job.events.length;
    changeSource(f, { comments: ['Held financial edit'], paymentStatus: 'unpaid' });
    job = (await call(f, '/jobs')).jobs[0];
    assert.equal(job.version, heldVersion);
    assert.equal(job.events.length, heldEvents);
    changeSource(f, { quantity: 10 });
    await assert.rejects(release(f, job), failure(409));
    job = (await call(f, '/jobs')).jobs[0];
    assert.equal(job.version, heldVersion + 1);
    job = await release(f, job);
    assert.equal(job.sourceChanged, false);
    assert.equal(job.status, 'released');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
});

test('source edits between source selection and creation cannot silently shift a legacy line', async t => {
    const f = fixture(t, { items: [
        { details: { itemName: 'First shirt', quantity: 3, color: 'Black', size: 'M' } },
        { details: { itemName: 'Second shirt', quantity: 7, color: 'White', size: 'L' } }
    ] });
    const { sources } = await call(f, '/sources');
    assert.equal(sources.length, 2);
    const job = await prepare(f, { itemIndex: 0 });
    assert.equal(job.designName, 'First shirt');
    assert.equal(job.required, 3);
    await release(f, job);
    changeSource(f, { items: [{ details: { itemName: 'Second shirt', quantity: 7, color: 'White', size: 'L' } }] });
    const held = (await call(f, '/jobs')).jobs[0];
    assert.equal(held.status, 'held');
    assert.equal(held.designName, 'First shirt');
    await assert.rejects(call(f, '/jobs', { sourceId: SOURCE, itemIndex: 1, expectedSourceToken: sources[1].sourceToken,
        assigneeId: printer.id, requestId: requestId() }), failure(409));
    await assert.rejects(release(f, held), failure(409));
});

test('deleting or removing a source preserves immutable jobs and events and withdraws printing', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    f.db.sqlite.prepare('DELETE FROM transactions WHERE id=?').run(SOURCE);
    const held = (await call(f, '/jobs')).jobs[0];
    assert.equal(held.status, 'held');
    assert.equal(held.events[0].action, 'source_deleted');
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, []);
    await assert.rejects(release(f, held), failure(409));
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM production_jobs WHERE id=?').run(job.id), /immutable/);
    assert.throws(() => f.db.sqlite.prepare("UPDATE production_events SET note='changed'").run(), /immutable/);
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM production_events').run(), /immutable/);
});

test('one source variant gets one full-quantity job, never a ball or removed sale', async t => {
    const f = fixture(t);
    await assert.rejects(prepare(f, { quantity: 3 }), failure(400));
    await prepare(f);
    await assert.rejects(prepare(f), failure(409));
    await assert.rejects(prepare(f, { sourceId: SECOND, expectedSourceToken: 'unused' }), failure(400));
    changeSource(f, { removedFromOrder: true });
    assert.equal((await call(f, '/sources')).sources.length, 0);
    await assert.rejects(prepare(f, { expectedSourceToken: 'unused' }), failure(400));
});

test('source race at job creation uses atomic snapshot guard rather than earlier read', async t => {
    const f = fixture(t);
    f.db.beforeBatch = () => changeSource(f, { quantity: 8 });
    await assert.rejects(prepare(f), failure(409));
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_jobs').get().n, 0);
});

test('employee invitation is owner-only, idempotent, not a Cloudflare grant and cannot escalate roles', async t => {
    const f = fixture(t);
    const body = { email: 'New.Employee@example.invalid', name: 'New employee', role: 'print_operator', requestId: requestId() };
    const response = await call(f, '/api/members', body);
    assert.equal(response.member.role, 'print_operator');
    assert.equal(response.member.email, 'new.employee@example.invalid');
    assert.equal(response.member.name, 'New employee');
    assert.deepEqual(JSON.parse(f.db.sqlite.prepare('SELECT profile FROM member_profiles WHERE member_id=?')
        .get(response.member.id).profile), { full_name: 'New employee' });
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='production_operator_profiles'").get().n, 0);
    assert.match(response.accessNotice, /code sent to this email/);
    assert.deepEqual(await call(f, '/api/members', body), response);
    await assert.rejects(call(f, '/api/members', { ...body, requestId: requestId() }), failure(409));
    await assert.rejects(call(f, '/api/members', { ...body, role: 'owner', requestId: requestId() }), failure(400));
    await assert.rejects(call(f, '/api/members', { ...body, email: owner.email, requestId: requestId() }), failure(400));
    await assert.rejects(call(f, '/api/members', { ...body, email: 'a@example.invalid,b@example.invalid', requestId: requestId() }), failure(400));
    await assert.rejects(call(f, '/api/members', body, printer), failure(403));
    await assert.rejects(call(f, '/api/members/owner', { active: false, requestId: requestId() }, owner, 'PATCH'), failure(400));
    await assert.rejects(call(f, '/api/members/reseller', { active: false, requestId: requestId() }, owner, 'PATCH'), failure(403));
});

test('offboarding holds active jobs in the membership batch and prevents reads and writes', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    await call(f, '/api/members/printer', { active: false, requestId: requestId() }, owner, 'PATCH');
    const held = (await call(f, '/jobs')).jobs[0];
    assert.equal(held.status, 'held');
    assert.equal(held.events[0].action, 'operator_revoked');
    await assert.rejects(call(f, '/jobs', undefined, printer), failure(403));
    await assert.rejects(progress(f, job, 'printed', { quantity: 1 }), failure(403));
    await assert.rejects(release(f, held), failure(403));
    const reassigned = await release(f, held, { assigneeId: other.id });
    assert.equal(reassigned.assignee.id, other.id);
    assert.equal((await call(f, '/jobs', undefined, other)).jobs.length, 1);
});

test('problem status requires a note and does not consume quantity or inventory', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    const before = snapshot(f).transactions;
    await assert.rejects(progress(f, job, 'problem'), failure(400));
    job = await progress(f, job, 'problem', { note: 'Blank has a mark.' });
    assert.deepEqual([job.status, job.awaitingQA, job.accepted, job.remainingToPrint], ['problem', 0, 0, 10]);
    assert.deepEqual(snapshot(f).transactions, before);
    assert.equal(job.events[0].actorName, 'Sam');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM _production_guards').get().n, 0);
});

test('QA receipt replay never accepts twice and employee cannot perform owner actions', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'printed', { quantity: 4 });
    const body = { expectedVersion: job.version, requestId: requestId(), accepted: 2, rejected: 1, note: 'Recheck alignment.' };
    await assert.rejects(call(f, `/jobs/${job.id}/qa`, body, printer), failure(403));
    await assert.rejects(call(f, `/jobs/${job.id}/hold`, {
        expectedVersion: job.version, requestId: requestId(), note: 'Hold.'
    }, printer), failure(403));
    const first = await call(f, `/jobs/${job.id}/qa`, body);
    const before = snapshot(f);
    assert.deepEqual(await call(f, `/jobs/${job.id}/qa`, body), first);
    assert.deepEqual(snapshot(f), before);
    assert.deepEqual([first.job.accepted, first.job.awaitingQA, first.job.reworkRemaining], [2, 1, 1]);
});

test('late offboarding failure rolls back membership, withdrawal and audit together', async t => {
    const f = fixture(t);
    const job = await release(f, await prepare(f));
    f.db.sqlite.exec(`CREATE TRIGGER fail_offboarding_receipt BEFORE INSERT ON production_request_receipts
        BEGIN SELECT RAISE(ABORT,'production_write'); END;`);
    const before = snapshot(f);
    await assert.rejects(call(f, '/api/members/printer', { active: false, requestId: requestId() }, owner, 'PATCH'), failure(409));
    assert.deepEqual(snapshot(f), before);
    assert.equal(f.db.sqlite.prepare("SELECT active FROM members WHERE id='printer'").get().active, 1);
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs[0].id, job.id);
});

test('changing product identity holds a released job even if its display labels match', async t => {
    const f = fixture(t, { productId: 'original-product' });
    await release(f, await prepare(f));
    changeSource(f, { productId: 'replacement-product' });
    const job = (await call(f, '/jobs')).jobs[0];
    assert.equal(job.status, 'held');
    assert.equal(job.sourceChanged, true);
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, []);
    await assert.rejects(release(f, job), failure(409));
});

const readyBatch = f => f.db.batch([
    f.db.prepare(`UPDATE transactions SET details=json_set(details,'$.fulfillmentStatus','ready')
        WHERE json_extract(details,'$.orderId')='ST-PRINT'`),
    productionReadyGuard(f.db, 'ST-PRINT'),
    f.db.prepare('DELETE FROM _production_guards')
]);

test('Ready guard blocks missing or unaccepted shirt jobs and allows fully accepted mixed orders', async t => {
    const f = fixture(t);
    const before = snapshot(f);
    await assert.rejects(readyBatch(f), /atomic batch failed/);
    assert.deepEqual(snapshot(f), before);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'printed', { quantity: 10 });
    await assert.rejects(readyBatch(f), /atomic batch failed/);
    job = await qa(f, job, 10, 0);
    await readyBatch(f);
    assert.equal(job.status, 'completed');
    assert.equal(f.db.sqlite.prepare("SELECT json_extract(details,'$.fulfillmentStatus') AS status FROM transactions WHERE id=?").get(SOURCE).status, 'ready');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM _production_guards').get().n, 0);
});

test('Ready guard runs after source writes and rolls back a same-batch variant edit', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'printed', { quantity: 10 });
    await qa(f, job, 10, 0);
    const before = snapshot(f);
    await assert.rejects(f.db.batch([
        f.db.prepare("UPDATE transactions SET details=json_set(details,'$.color','White','$.fulfillmentStatus','ready') WHERE id=?").bind(SOURCE),
        productionReadyGuard(f.db, 'ST-PRINT'),
        f.db.prepare('DELETE FROM _production_guards')
    ]), /atomic batch failed/);
    assert.deepEqual(snapshot(f), before);
});

test('Ready guard requires coverage for every nested shirt, including blanks and inferred sizes', async t => {
    const f = fixture(t, { items: [
        { details: { itemName: 'First', quantity: 2, size: 'M', category: 'blanks' } },
        { itemName: 'Second', quantity: 3, size: 'L', category: 'general' },
        { itemName: 'Ball', quantity: 1, category: 'Balls' }
    ] });
    let first = await release(f, await prepare(f, { itemIndex: 0 }));
    first = await progress(f, first, 'printed', { quantity: 2 });
    await qa(f, first, 2, 0);
    await assert.rejects(readyBatch(f), /atomic batch failed/);
    let second = await release(f, await prepare(f, { itemIndex: 1 }));
    second = await progress(f, second, 'printed', { quantity: 3 });
    await qa(f, second, 3, 0);
    await readyBatch(f);
});

test('shared member profiles supply queue names without exposing other fields or rewriting audit history', async t => {
    const f = fixture(t);
    let job = await release(f, await prepare(f));
    job = await progress(f, job, 'start');
    assert.equal(job.events[0].actorName, 'Sam');
    f.db.sqlite.prepare("UPDATE member_profiles SET profile=json_set(profile,'$.full_name','Sam Updated') WHERE member_id='printer'").run();
    const current = (await call(f, '/jobs', undefined, printer)).jobs[0];
    assert.equal(current.assignee.name, 'Sam Updated');
    assert.equal(current.events[0].actorName, 'Sam');
    assert.ok(!JSON.stringify(current).includes('PRIVATE PROFILE'));
});

const PUBLIC_PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIVATE_PHOTO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function media(f) {
    for (const [id, visibility] of [[PUBLIC_PHOTO, 'public'], [PRIVATE_PHOTO, 'private']]) {
        f.db.sqlite.prepare(`INSERT INTO media_objects(id,object_key,visibility,content_type,byte_size,sha256)
            VALUES (?,?,?,'image/png',1,'hash')`).run(id, `${visibility}/${id}`, visibility);
    }
}
function shirtOrder(f, id, orderId, details = {}) {
    f.db.sqlite.prepare('INSERT OR IGNORE INTO orders(id) VALUES (?)').run(orderId);
    f.db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id)
        VALUES (?,'sale','Shirts','500','2026-09-17T00:00:00Z',?,?)`).run(id, JSON.stringify({
        orderId, itemName: 'Club shirt', quantity: 2, brand: 'Sypik', size: 'L', color: 'White', status: 'paid',
        customerName: 'PRIVATE CUSTOMER', ...details }), orderId);
}
const lineOf = source => ({ sourceId: source.sourceId, itemIndex: source.itemIndex, expectedSourceToken: source.sourceToken });

test('jobs snapshot only public product photos, and staff see the photo but never a private file', async t => {
    const f = fixture(t, { imageUrl: `/api/media/objects/${PUBLIC_PHOTO}` });
    media(f);
    const THIRD = '00000000-0000-4000-8000-000000000003';
    shirtOrder(f, THIRD, 'ST-RECEIPT', { imageUrl: `/api/media/objects/${PRIVATE_PHOTO}` });
    const { sources } = await call(f, '/sources');
    assert.equal(sources.find(source => source.sourceId === SOURCE).designImageUrl, `/api/media/objects/${PUBLIC_PHOTO}`);
    assert.equal(sources.find(source => source.sourceId === THIRD).designImageUrl, null);
    const job = await release(f, await prepare(f));
    assert.equal(job.designImageUrl, `/api/media/objects/${PUBLIC_PHOTO}`);
    const staff = (await call(f, '/jobs', undefined, printer)).jobs[0];
    assert.equal(staff.designImageUrl, `/api/media/objects/${PUBLIC_PHOTO}`);
    const privateJob = await prepare(f, { sourceId: THIRD });
    assert.equal(privateJob.designImageUrl, null);
    assert.equal(f.db.sqlite.prepare('SELECT design_image_id FROM production_jobs WHERE id=?').get(privateJob.id).design_image_id, null);
    // A changed photo on the order after preparing does not alter the job's snapshot.
    changeSource(f, { imageUrl: '' });
    assert.equal((await call(f, '/jobs', undefined, printer)).jobs[0].designImageUrl, `/api/media/objects/${PUBLIC_PHOTO}`);
});

test('nested lines use the item photo, never another product photo from the order', async t => {
    const f = fixture(t, { imageUrl: `/api/media/objects/${PUBLIC_PHOTO}`, items: [
        { name: 'Own photo', category: 'shirts', size: 'M', quantity: 1, imageUrl: `/api/media/objects/${PUBLIC_PHOTO}` },
        { details: { name: 'External photo', category: 'shirts', size: 'L', quantity: 1, imageUrl: 'https://example.invalid/x.png' } },
        { name: 'No photo', category: 'shirts', size: 'S', quantity: 1 }
    ] });
    media(f);
    const { sources } = await call(f, '/sources');
    const photos = sources.filter(source => source.sourceId === SOURCE).sort((a, b) => a.itemIndex - b.itemIndex).map(source => source.designImageUrl);
    assert.deepEqual(photos, [`/api/media/objects/${PUBLIC_PHOTO}`, null, `/api/media/objects/${PUBLIC_PHOTO}`]);
});

test('batch prepare creates several jobs for one employee atomically, with order references for the owner', async t => {
    const f = fixture(t);
    media(f);
    const THIRD = '00000000-0000-4000-8000-000000000003';
    shirtOrder(f, THIRD, 'ST-OTHER', { imageUrl: `/api/media/objects/${PUBLIC_PHOTO}` });
    const { sources } = await call(f, '/sources');
    const lines = sources.map(lineOf);
    assert.equal(lines.length, 2);
    const body = { lines, assigneeId: printer.id, instructions: 'Front print only.', requestId: requestId() };
    await assert.rejects(call(f, '/jobs/batch', body, printer), failure(403));
    await assert.rejects(call(f, '/jobs/batch', { ...body, lines: [lines[0], lines[0]] }), failure(400));
    await assert.rejects(call(f, '/jobs/batch', { ...body, lines: [] }), failure(400));
    await assert.rejects(call(f, '/jobs/batch', { ...body, artworkReady: true }), failure(400));
    const result = await call(f, '/jobs/batch', body);
    assert.equal(result.jobs.length, 2);
    assert.deepEqual(result.jobs.map(job => job.status), ['draft', 'draft']);
    assert.deepEqual(new Set(result.jobs.map(job => job.orderId)), new Set(['ST-PRINT', 'ST-OTHER']));
    assert.ok(result.jobs.every(job => job.assignee.id === printer.id && job.instructions === 'Front print only.'));
    assert.equal(result.jobs.find(job => job.orderId === 'ST-OTHER').designImageUrl, `/api/media/objects/${PUBLIC_PHOTO}`);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action='prepared'").get().n, 2);
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs, [], 'drafts stay hidden from staff');
    const before = snapshot(f);
    assert.deepEqual(await call(f, '/jobs/batch', body), result, 'replay returns the saved receipt');
    assert.deepEqual(snapshot(f), before);
    await assert.rejects(call(f, '/jobs/batch', { ...body, requestId: requestId() }), failure(409));
    assert.deepEqual(snapshot(f), before);
});

test('batch prepare rejects the whole batch when any line is stale or the employee is inactive', async t => {
    const f = fixture(t);
    const THIRD = '00000000-0000-4000-8000-000000000003';
    shirtOrder(f, THIRD, 'ST-OTHER');
    const lines = (await call(f, '/sources')).sources.map(lineOf);
    const before = snapshot(f);
    const stale = lines.map((line, index) => index ? { ...line, expectedSourceToken: 'stale' } : line);
    await assert.rejects(call(f, '/jobs/batch', { lines: stale, assigneeId: printer.id, requestId: requestId() }), failure(409));
    f.db.beforeBatch = () => { changeSource(f, { size: 'XL' }, THIRD); };
    await assert.rejects(call(f, '/jobs/batch', { lines, assigneeId: printer.id, requestId: requestId() }), failure(409));
    changeSource(f, { size: 'L' }, THIRD);
    f.db.sqlite.exec("UPDATE members SET active=0 WHERE id='printer'");
    await assert.rejects(call(f, '/jobs/batch', { lines, assigneeId: printer.id, requestId: requestId() }), failure(403));
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_jobs').get().n, 0);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_events').get().n, 0);
    assert.deepEqual(snapshot(f).orders, before.orders);
});

test('batch prepare and release moves every chosen order to in progress in one save', async t => {
    const f = fixture(t);
    const THIRD = '00000000-0000-4000-8000-000000000003';
    shirtOrder(f, THIRD, 'ST-OTHER');
    const lines = (await call(f, '/sources')).sources.map(lineOf);
    await assert.rejects(call(f, '/jobs/batch', { lines, assigneeId: printer.id, release: true, artworkReady: true, requestId: requestId() }), failure(400));
    const result = await call(f, '/jobs/batch', { lines, assigneeId: printer.id, release: true, artworkReady: true, blanksReady: true, requestId: requestId() });
    assert.deepEqual(result.jobs.map(job => job.status), ['released', 'released']);
    assert.ok(result.jobs.every(job => job.releasedAt));
    for (const id of [SOURCE, THIRD]) {
        assert.equal(JSON.parse(f.db.sqlite.prepare('SELECT details FROM transactions WHERE id=?').get(id).details).fulfillmentStatus, 'in_progress');
    }
    assert.equal(JSON.parse(f.db.sqlite.prepare('SELECT details FROM transactions WHERE id=?').get(SECOND).details).fulfillmentStatus, 'in_progress');
    assert.deepEqual(f.db.sqlite.prepare("SELECT id,version FROM orders WHERE id IN ('ST-PRINT','ST-OTHER') ORDER BY id").all().map(row => ({ ...row })),
        [{ id: 'ST-OTHER', version: 1 }, { id: 'ST-PRINT', version: 1 }]);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action='release'").get().n, 2);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_jobs WHERE source_changed=1').get().n, 0, 'release must not self-hold');
    const staff = (await call(f, '/jobs', undefined, printer)).jobs;
    assert.equal(staff.length, 2);
    assert.deepEqual(staff.map(job => job.customerName), ['PRIVATE CUSTOMER', 'PRIVATE CUSTOMER']);
    const encoded = JSON.stringify(staff.map(({ customerName, ...job }) => job)).toLowerCase();
    for (const forbidden of ['private', 'customer', 'orderid', 'sourceid', 'st-print', 'st-other']) assert.ok(!encoded.includes(forbidden), forbidden);
});

test('staff see a plain LBC booking code for the package label, never the tracking number, and saving it never holds the job', async t => {
    const f = fixture(t);
    let job = await prepare(f);
    job = await release(f, job);
    const staffJob = async () => (await call(f, '/jobs', undefined, printer)).jobs[0];
    assert.equal((await staffJob()).bookingNumber, null);
    for (const [value, expected] of [
        ['123456789012', '123456789012'],
        ['  BK 2026-0001  ', 'BK 2026-0001'],
        ['AB12', 'AB12'],
        ['https://www.lbcexpress.com/track/?tracking_no=123456789012', null],
        ['0917 123 4567 / PRIVATE ADDRESS', null],
        ['123', null],
        ['x'.repeat(41), null],
        ['1234\n5678', null],
        [12345678, null],
        ['', null]
    ]) {
        changeSource(f, { bookingNumber: value });
        assert.equal((await staffJob()).bookingNumber, expected, JSON.stringify(value));
    }
    // LBC's later tracking number is the customer's: staff never receive it, in any form.
    changeSource(f, { bookingNumber: 'BK-2026-0001', trackingNumber: '987654321098' });
    const both = await staffJob();
    assert.equal(both.bookingNumber, 'BK-2026-0001');
    assert.ok(!Object.hasOwn(both, 'trackingNumber'));
    assert.ok(!JSON.stringify(both).includes('987654321098'));
    // A booking number is not a physical line change: the job keeps printing, untouched.
    const stored = f.db.sqlite.prepare('SELECT status,source_changed,version FROM production_jobs WHERE id=?').get(job.id);
    assert.deepEqual({ ...stored }, { status: 'released', source_changed: 0, version: job.version });
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action IN ('source_changed','source_deleted')").get().n, 0);
    // Printing continues and the corrected code reaches the printer live.
    await progress(f, job, 'start');
    changeSource(f, { bookingNumber: 'BK-2026-0002' });
    const current = await staffJob();
    assert.equal(current.bookingNumber, 'BK-2026-0002');
    assert.equal(current.status, 'printing');
    // Only the name and the booking code describe the order; nothing else about the buyer or the order.
    const { customerName, bookingNumber, ...rest } = current;
    const encoded = JSON.stringify(rest).toLowerCase();
    for (const forbidden of ['private', 'st-print', 'contact', 'address', 'shipping', 'amount', 'receipt', 'tracking', '987654321098']) {
        assert.ok(!encoded.includes(forbidden), forbidden);
    }
    // Another employee sees nothing.
    assert.deepEqual((await call(f, '/jobs', undefined, other)).jobs, []);
});

test('staff see the current customer name, legacy customer field, or null, and nothing else about the buyer', async t => {
    const f = fixture(t, { customerName: '  Juan Dela Cruz  ' });
    const THIRD = '00000000-0000-4000-8000-000000000003';
    const FOURTH = '00000000-0000-4000-8000-000000000004';
    shirtOrder(f, THIRD, 'ST-LEGACY', { customerName: undefined, customer: 'Maria Santos' });
    shirtOrder(f, FOURTH, 'ST-NONAME', { customerName: '' });
    const lines = (await call(f, '/sources')).sources.map(lineOf);
    await call(f, '/jobs/batch', { lines, assigneeId: printer.id, release: true, artworkReady: true, blanksReady: true, requestId: requestId() });
    const jobs = (await call(f, '/jobs', undefined, printer)).jobs;
    assert.equal(jobs.find(job => job.designName === 'Court shirt').customerName, 'Juan Dela Cruz');
    assert.deepEqual(jobs.filter(job => job.designName === 'Club shirt').map(job => job.customerName ?? '').sort(), ['', 'Maria Santos']);
    // A corrected name on the order reaches the printer without re-preparing the job.
    changeSource(f, { customerName: 'Juan P. Dela Cruz' });
    const updated = (await call(f, '/jobs', undefined, printer)).jobs.find(job => job.designName === 'Court shirt');
    assert.equal(updated.customerName, 'Juan P. Dela Cruz');
});

test('batch prepare keeps only a high per-request safety ceiling, checked before any database read', async t => {
    const f = fixture(t);
    assert.equal(MAX_BATCH_JOBS, 100);
    const lines = Array.from({ length: MAX_BATCH_JOBS + 1 }, (_, index) => ({
        sourceId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, expectedSourceToken: 'x' }));
    const before = snapshot(f);
    await assert.rejects(call(f, '/jobs/batch', { lines, assigneeId: printer.id, requestId: requestId() }), failure(400));
    assert.deepEqual(snapshot(f), before);
});

test('batch prepare and release takes 51 lines in one atomic save (the old 30-line cap is gone)', async t => {
    const f = fixture(t);
    // 50 more shirt orders plus the fixture's own shirt line: the backlog the owner reported.
    const ids = Array.from({ length: 50 }, (_, index) => `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`);
    ids.forEach((id, index) => shirtOrder(f, id, `ST-BULK-${index}`));
    const sources = [];
    let offset = 0;
    do {
        const page = await call(f, `/sources${offset ? `?offset=${offset}` : ''}`);
        sources.push(...page.sources);
        offset = page.nextOffset;
    } while (offset != null);
    const lines = sources.map(lineOf);
    assert.equal(lines.length, 51);
    const result = await call(f, '/jobs/batch', { lines, assigneeId: printer.id, release: true, artworkReady: true, blanksReady: true, requestId: requestId() });
    assert.equal(result.jobs.length, 51);
    assert.ok(result.jobs.every(job => job.status === 'released' && job.releasedAt));
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_jobs').get().n, 51);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action='prepared'").get().n, 51);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM production_events WHERE action='release'").get().n, 51);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM production_request_receipts').get().n, 1);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM transactions WHERE type='sale' AND json_extract(details,'$.fulfillmentStatus')<>'in_progress'").get().n, 0);
    const staff = [];
    offset = 0;
    do {
        const page = await call(f, `/jobs${offset ? `?offset=${offset}` : ''}`, undefined, printer);
        staff.push(...page.jobs);
        offset = page.nextOffset;
    } while (offset != null);
    assert.equal(new Set(staff.map(job => job.id)).size, 51);
});

test('jobs list first in, first out by order date for owner and staff, with accepted jobs last', async t => {
    const f = fixture(t);
    const order = (id, orderId, date) => {
        f.db.sqlite.prepare('INSERT OR IGNORE INTO orders(id) VALUES (?)').run(orderId);
        f.db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id)
            VALUES (?,'sale','Shirts','500',?,?,?)`).run(id, date, JSON.stringify({ orderId, itemName: `Shirt ${orderId}`,
            quantity: 1, size: 'M', status: 'paid', customerName: orderId }), orderId);
    };
    const NEWEST = '00000000-0000-4000-8000-000000000011';
    const OLDEST = '00000000-0000-4000-8000-000000000012';
    const MIDDLE = '00000000-0000-4000-8000-000000000013';
    order(NEWEST, 'ST-NEW', '2026-10-12T00:00:00Z');
    order(OLDEST, 'ST-OLD', '2026-08-01T00:00:00Z');
    order(MIDDLE, 'ST-MID', '2026-10-01T00:00:00Z');
    const sources = (await call(f, '/sources')).sources;
    const prepareFor = async id => (await call(f, '/jobs/batch', { lines: sources.filter(source => source.sourceId === id).map(lineOf),
        assigneeId: printer.id, release: true, artworkReady: true, blanksReady: true, requestId: requestId() })).jobs[0];
    await prepareFor(NEWEST);
    let oldest = await prepareFor(OLDEST);
    await prepareFor(MIDDLE);
    await prepareFor(SOURCE);
    const ownerOrder = (await call(f)).jobs.map(job => job.orderId);
    assert.deepEqual(ownerOrder, ['ST-OLD', 'ST-PRINT', 'ST-MID', 'ST-NEW']);
    assert.deepEqual((await call(f, '/jobs', undefined, printer)).jobs.map(job => job.customerName), ['ST-OLD', 'PRIVATE CUSTOMER', 'ST-MID', 'ST-NEW']);
    oldest = await progress(f, oldest, 'printed', { quantity: 1 });
    await qa(f, oldest, 1, 0);
    assert.deepEqual((await call(f)).jobs.map(job => job.orderId), ['ST-PRINT', 'ST-MID', 'ST-NEW', 'ST-OLD'], 'accepted jobs move below unfinished work');
    const staffJobs = (await call(f, '/jobs', undefined, printer)).jobs;
    assert.ok(staffJobs.every(job => !('date' in job) && !('orderDate' in job)), 'the order date is a sort key only');
});

test('the 0011 backfill attaches exactly the photo a newly prepared job gets, and nothing private', async t => {
    const f = fixture(t, { imageUrl: `/api/media/objects/${PUBLIC_PHOTO}`, items: [
        { name: 'Own photo', category: 'shirts', size: 'M', quantity: 1, imageUrl: `https://www.sportstechph.store/api/media/objects/${PUBLIC_PHOTO}` },
        { details: { name: 'External photo', category: 'shirts', size: 'L', quantity: 1, imageUrl: 'https://example.invalid/x.png' } },
        { name: 'Parent photo', category: 'shirts', size: 'S', quantity: 1 },
        { details: { name: 'Nested photo', category: 'shirts', size: 'XL', quantity: 1, imageUrl: `/api/media/objects/${PUBLIC_PHOTO.toUpperCase()}` } }
    ] });
    media(f);
    const RECEIPT = '00000000-0000-4000-8000-000000000003';
    shirtOrder(f, RECEIPT, 'ST-RECEIPT', { imageUrl: `/api/media/objects/${PRIVATE_PHOTO}` });
    const lines = (await call(f, '/sources')).sources.map(lineOf);
    assert.equal(lines.length, 5);
    await call(f, '/jobs/batch', { lines, assigneeId: printer.id, requestId: requestId() });
    const read = () => f.db.sqlite.prepare('SELECT id,design_image_id,version,updated_at FROM production_jobs ORDER BY id').all().map(row => ({ ...row }));
    const prepared = read();
    assert.deepEqual(prepared.map(row => row.design_image_id === null).sort(), [false, false, false, true, true]);
    f.db.sqlite.exec('UPDATE production_jobs SET design_image_id=NULL');
    const backfill = readFileSync(new URL('0011_backfill_design_photos.sql', directory), 'utf8');
    f.db.sqlite.exec(backfill);
    assert.deepEqual(read(), prepared);
    f.db.sqlite.exec(backfill);
    assert.deepEqual(read(), prepared, 'safe to re-run');
});
