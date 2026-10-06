import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
    handleProductionRequest, manilaWeekStart, PRINT_RATE_CENTAVOS, PRINT_RATE_SHIRTS
} from '../../worker/production-api.ts';
import { HttpError } from '../../worker/errors.ts';
import worker from '../../worker/index.ts';

const directory = new URL('../../worker/migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
const migrations = names.map(name => readFileSync(new URL(name, directory), 'utf8'));
const walletMigration = readFileSync(new URL('0007_print_wallet.sql', directory), 'utf8');
const SOURCE = '00000000-0000-4000-8000-000000000001';
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const printer = { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' };
const other = { id: 'other', email: 'other@example.invalid', role: 'print_operator' };
const former = { id: 'former', email: 'former@example.invalid', role: 'print_operator' };
const reseller = { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' };
const K = PRINT_RATE_CENTAVOS;
let sequence = 0;
const requestId = () => `wallet-test-${++sequence}`;

// Same harness as production.test.js: real SQLite migrations and atomic batch rollback.
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
function fixture(t, quantity = 100) {
    const db = new LocalD1(t);
    for (const member of [owner, printer, other, former, reseller]) {
        db.sqlite.prepare('INSERT INTO members(id,email,role,active) VALUES (?,?,?,?)')
            .run(member.id, member.email, member.role, member === former ? 0 : 1);
    }
    db.sqlite.prepare("INSERT INTO member_profiles(member_id,profile) VALUES ('printer',?)")
        .run(JSON.stringify({ full_name: 'Sam', privateProfileField: 'PRIVATE PROFILE' }));
    db.sqlite.prepare("INSERT INTO member_profiles(member_id,profile) VALUES ('other',?)")
        .run(JSON.stringify({ full_name: 'Alex', phone: 'PRIVATE OTHER PHONE' }));
    db.sqlite.exec("INSERT INTO orders(id) VALUES ('ST-PRINT');");
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id)
        VALUES (?,'sale','Shirts','95000','2026-09-17T00:00:00Z',?,'ST-PRINT')`).run(SOURCE, JSON.stringify({
        orderId: 'ST-PRINT', itemName: 'Court shirt', quantity, brand: 'Sypik', size: 'M', color: 'Black', status: 'paid',
        price: 950, total: 95000, customerName: 'PRIVATE CUSTOMER', contactNumber: 'PRIVATE CONTACT',
        customerAddress: 'PRIVATE ADDRESS', receiptUrl: 'PRIVATE RECEIPT', inventoryCost: 'PRIVATE COST'
    }));
    return { db, env: { DB: db, PRINT_QUEUE_ENABLED: 'true' } };
}
async function call(f, path, body, member = owner, method = body === undefined ? 'GET' : 'POST') {
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
async function job(f, assignee = printer) {
    const { sources } = await call(f, '/sources');
    const prepared = (await call(f, '/jobs', { sourceId: SOURCE, assigneeId: assignee.id,
        expectedSourceToken: sources.find(source => source.sourceId === SOURCE).sourceToken, requestId: requestId() })).job;
    return (await call(f, `/jobs/${prepared.id}/release`, { expectedVersion: prepared.version,
        requestId: requestId(), artworkReady: true, blanksReady: true })).job;
}
const printed = async (f, current, quantity, member = printer) => (await call(f, `/jobs/${current.id}/progress`,
    { expectedVersion: current.version, requestId: requestId(), action: 'printed', quantity }, member)).job;
const qa = async (f, current, accepted, rejected = 0) => (await call(f, `/jobs/${current.id}/qa`, {
    expectedVersion: current.version, requestId: requestId(), accepted, rejected, ...(rejected ? { note: 'Reprint.' } : {})
})).job;
async function accept(f, current, quantity, member = printer) {
    return qa(f, await printed(f, current, quantity, member), quantity);
}
const wallet = async (f, member = printer, query = '') => (await call(f, `/wallet${query}`, undefined, member)).wallet;
const payout = (f, operatorId, amountCentavos, extra = {}) =>
    call(f, '/payouts', { operatorId, amountCentavos, requestId: requestId(), ...extra });
const payoutRows = f => f.db.sqlite.prepare('SELECT operator_id,amount_centavos,note,created_by FROM print_payouts ORDER BY rowid').all()
    .map(row => ({ ...row }));
const qaOperators = f => f.db.sqlite.prepare("SELECT operator_id FROM production_events WHERE action='qa' ORDER BY id").all()
    .map(row => row.operator_id);

test('pay rule constants are centavo-exact: PHP 1,000 per complete 30 accepted shirts', () => {
    assert.equal(PRINT_RATE_SHIRTS, 30);
    assert.equal(PRINT_RATE_CENTAVOS, 100000);
    assert.ok(Number.isSafeInteger(PRINT_RATE_CENTAVOS));
});

test('only owner-accepted QA counts: printed, rejected and rework shirts never double count', async t => {
    const f = fixture(t, 10);
    let current = await job(f);
    current = await printed(f, current, 6);
    let mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.awaitingQA, mine.earnedCentavos], [0, 6, 0]);
    current = await qa(f, current, 4, 2);
    mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.awaitingQA], [4, 0]);
    current = await printed(f, current, 2);
    current = await qa(f, current, 0, 2);
    assert.equal((await wallet(f)).acceptedShirts, 4);
    current = await accept(f, current, 6);
    mine = await wallet(f);
    assert.equal(current.status, 'completed');
    assert.deepEqual([mine.acceptedShirts, mine.awaitingQA, mine.progress, mine.nextPayoutIn], [10, 0, 10, 20]);
    assert.deepEqual(mine.recent.map(entry => entry.shirts), [6, 4]);
    assert.ok(mine.recent.every(entry => entry.type === 'credit' && entry.jobCode === current.jobCode));
});

test('earned is floor(accepted / 30) x PHP 1,000 at 29, 30 and 61 shirts', async t => {
    const f = fixture(t);
    let current = await accept(f, await job(f), 29);
    let mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.progress, mine.nextPayoutIn, mine.earnedCentavos, mine.balanceCentavos], [29, 29, 1, 0, 0]);
    current = await accept(f, current, 1);
    mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.progress, mine.nextPayoutIn, mine.earnedCentavos, mine.balanceCentavos], [30, 0, 30, K, K]);
    await accept(f, current, 31);
    mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.progress, mine.nextPayoutIn, mine.earnedCentavos], [61, 1, 29, 2 * K]);
    assert.deepEqual([mine.rateShirts, mine.rateCentavos], [30, 100000]);
});

test('credit goes to the certain printer, not the assignee; mixed printers stay unattributed', async t => {
    const f = fixture(t);
    let current = await job(f);
    current = await accept(f, current, 5);
    // Pending returned to zero, so the next batch is judged on its own.
    await call(f, '/api/members/printer', { active: false, requestId: requestId() }, owner, 'PATCH');
    current = (await call(f, `/jobs/${current.id}/release`, { expectedVersion: (await call(f, '/jobs')).jobs[0].version,
        requestId: requestId(), artworkReady: true, blanksReady: true, assigneeId: other.id })).job;
    current = await accept(f, current, 7, other);
    assert.deepEqual(qaOperators(f), ['printer', 'other']);
    const all = await call(f, '/wallet');
    const byId = Object.fromEntries(all.wallets.map(entry => [entry.memberId, entry]));
    assert.equal(byId.printer.acceptedShirts, 5);
    assert.equal(byId.other.acceptedShirts, 7);
    assert.equal(all.unattributed.shirts, 0);

    // Mixed: both printed shirts are pending together, so the acceptance cannot be split with certainty.
    current = await printed(f, current, 2, other);
    await call(f, '/api/members/printer', { active: true, requestId: requestId() }, owner, 'PATCH');
    await call(f, '/api/members/other', { active: false, requestId: requestId() }, owner, 'PATCH');
    current = (await call(f, `/jobs/${current.id}/release`, { expectedVersion: (await call(f, '/jobs')).jobs[0].version,
        requestId: requestId(), artworkReady: true, blanksReady: true, assigneeId: printer.id })).job;
    current = await printed(f, current, 3, printer);
    current = await qa(f, current, 5);
    assert.equal(qaOperators(f).at(-1), null);
    // Shirts the owner records as printed are not credited to any print operator.
    current = await accept(f, current, 4, owner);
    const after = await call(f, '/wallet');
    const next = Object.fromEntries(after.wallets.map(entry => [entry.memberId, entry]));
    assert.equal(next.printer.acceptedShirts, 5);
    assert.equal(next.other.acceptedShirts, 7);
    assert.equal(after.unattributed.shirts, 9);
    assert.deepEqual(after.unattributed.recent.map(entry => entry.shirts), [4, 5]);
    assert.deepEqual(Object.keys(after.unattributed.recent[0]).sort(), ['at', 'jobCode', 'shirts']);
});

test('QA events written before 0007 are judged by the same certainty rule, never by assignee', async t => {
    const f = fixture(t);
    const current = await job(f);
    const insert = f.db.sqlite.prepare(`INSERT INTO production_events(job_id,actor_id,actor_name,action,quantity,accepted,rejected,version)
        VALUES (?,?,?,?,?,?,?,1)`);
    // Certain historical batch by printer, then a mixed historical batch, both with NULL operator_id.
    insert.run(current.id, 'printer', 'Sam', 'printed', 4, 0, 0);
    insert.run(current.id, 'owner', 'Owner', 'qa', 4, 3, 1);
    insert.run(current.id, 'printer', 'Sam', 'printed', 2, 0, 0);
    insert.run(current.id, 'other', 'Alex', 'printed', 2, 0, 0);
    insert.run(current.id, 'owner', 'Owner', 'qa', 4, 4, 0);
    const credits = f.db.sqlite.prepare('SELECT shirts,operator_id FROM print_wallet_credits ORDER BY event_id').all().map(row => ({ ...row }));
    assert.deepEqual(credits, [{ shirts: 3, operator_id: 'printer' }, { shirts: 4, operator_id: null }]);
    assert.equal((await wallet(f)).acceptedShirts, 3);
    assert.equal((await call(f, '/wallet')).unattributed.shirts, 4);
});

test('the stored printer always matches the migration view rule', async t => {
    const f = fixture(t);
    let current = await job(f);
    current = await accept(f, current, 3);
    current = await printed(f, current, 4);
    current = await qa(f, current, 2, 2);
    current = await printed(f, current, 2);
    current = await printed(f, current, 2, owner);
    current = await qa(f, current, 3, 1);
    await accept(f, current, 2, owner);
    const viewSql = /CREATE VIEW print_wallet_credits AS([\s\S]*?);\r?\n/.exec(walletMigration)[1];
    assert.ok(viewSql.includes('coalesce(q.operator_id,'));
    f.db.sqlite.exec(`CREATE TEMP VIEW rule_only AS ${viewSql.replace('coalesce(q.operator_id,', 'coalesce(NULL,')}`);
    const stored = f.db.sqlite.prepare("SELECT id,operator_id FROM production_events WHERE action='qa' AND accepted>0 ORDER BY id").all();
    const rule = f.db.sqlite.prepare('SELECT event_id AS id,operator_id FROM rule_only ORDER BY event_id').all();
    assert.equal(stored.length, 4);
    assert.deepEqual(rule.map(row => ({ ...row })), stored.map(row => ({ ...row })));
    assert.deepEqual(stored.map(row => row.operator_id), ['printer', 'printer', null, 'owner']);
});

test('payouts are whole PHP 1,000 steps within the balance, immutable and recorded once', async t => {
    const f = fixture(t);
    await accept(f, await job(f), 95);
    assert.equal((await wallet(f)).balanceCentavos, 3 * K);
    for (const amount of [0, -K, K / 2, K + 1, 1.5, '100000', null, 100000001]) {
        await assert.rejects(payout(f, printer.id, amount), failure(400));
    }
    await assert.rejects(payout(f, printer.id, 4 * K), failure(409, 'production_conflict'));
    await assert.rejects(call(f, '/payouts', { operatorId: printer.id, amountCentavos: K, requestId: requestId(), extra: 1 }), failure(400));
    assert.deepEqual(payoutRows(f), []);
    const body = { operatorId: printer.id, amountCentavos: 2 * K, note: 'GCash, 6 Oct', requestId: requestId() };
    const first = await call(f, '/payouts', body);
    assert.deepEqual([first.payout.amountCentavos, first.payout.operatorId, first.payout.note], [2 * K, 'printer', 'GCash, 6 Oct']);
    assert.deepEqual([first.wallet.paidCentavos, first.wallet.balanceCentavos], [2 * K, K]);
    const replay = await call(f, '/payouts', body);
    assert.deepEqual(replay.payout, first.payout);
    await assert.rejects(call(f, '/payouts', { ...body, amountCentavos: K }), failure(409, 'production_receipt_conflict'));
    assert.equal(payoutRows(f).length, 1);
    await assert.rejects(payout(f, printer.id, 2 * K), failure(409));
    const rest = await payout(f, printer.id, K);
    assert.equal(rest.wallet.balanceCentavos, 0);
    assert.deepEqual(rest.wallet.recent.slice(0, 2).map(entry => entry.type), ['payout', 'payout']);
    assert.deepEqual(payoutRows(f), [
        { operator_id: 'printer', amount_centavos: 2 * K, note: 'GCash, 6 Oct', created_by: 'owner' },
        { operator_id: 'printer', amount_centavos: K, note: '', created_by: 'owner' }
    ]);
    assert.throws(() => f.db.sqlite.prepare('UPDATE print_payouts SET amount_centavos=?').run(5 * K), /immutable/);
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM print_payouts').run(), /immutable/);
    assert.throws(() => f.db.sqlite.prepare(`INSERT INTO print_payouts(id,operator_id,amount_centavos,created_by)
        VALUES ('x','printer',50000,'owner')`).run(), /CHECK/);
    assert.throws(() => f.db.sqlite.prepare(`INSERT INTO print_payouts(id,operator_id,amount_centavos,created_by)
        VALUES ('y','printer',150000.5,'owner')`).run(), /CHECK/);
});

test('concurrent payouts cannot overdraw and a duplicate request ID pays once', async t => {
    const f = fixture(t, 200);
    await accept(f, await job(f), 60);
    const body = { operatorId: printer.id, amountCentavos: 2 * K, requestId: requestId() };
    const same = await Promise.all([call(f, '/payouts', body), call(f, '/payouts', body)]);
    assert.deepEqual(same[0].payout, same[1].payout);
    assert.equal(payoutRows(f).length, 1);

    await accept(f, (await call(f, '/jobs')).jobs[0], 30);
    const race = await Promise.allSettled([payout(f, printer.id, K), payout(f, printer.id, K)]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(race.find(result => result.status === 'rejected').reason.status, 409);
    // The balance is enforced inside the batch, even when it changes after the request is read.
    await accept(f, (await call(f, '/jobs')).jobs[0], 30);
    f.db.beforeBatch = () => f.db.sqlite.prepare(`INSERT INTO print_payouts(id,operator_id,amount_centavos,created_by)
        VALUES ('late','printer',100000,'owner')`).run();
    await assert.rejects(payout(f, printer.id, K), failure(409));
    assert.deepEqual(payoutRows(f).map(row => row.amount_centavos), [2 * K, K, K]);
    assert.equal((await wallet(f)).balanceCentavos, 0);
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM _production_guards').get().n, 0);
});

test('payouts are owner-only and only to print-operator accounts; offboarded operators can still be paid', async t => {
    const f = fixture(t);
    await accept(f, await job(f), 30);
    await assert.rejects(payout(f, owner.id, K), failure(400));
    await assert.rejects(payout(f, reseller.id, K), failure(400));
    await assert.rejects(payout(f, 'missing', K), failure(400));
    await assert.rejects(call(f, '/payouts', { operatorId: printer.id, amountCentavos: K, requestId: requestId() }, printer), failure(403));
    await assert.rejects(call(f, '/payouts', { operatorId: other.id, amountCentavos: K, requestId: requestId() }, other), failure(403));
    assert.deepEqual(payoutRows(f), []);
    await call(f, '/api/members/printer', { active: false, requestId: requestId() }, owner, 'PATCH');
    const paid = await payout(f, printer.id, K, { note: 'Final pay' });
    assert.equal(paid.wallet.balanceCentavos, 0);
    // A role change after the request is read is caught inside the batch.
    f.db.sqlite.prepare(`INSERT INTO production_events(job_id,actor_id,actor_name,action,quantity,accepted,rejected,version,operator_id)
        SELECT id,'owner','Owner','qa',0,30,0,version,'other' FROM production_jobs`).run();
    f.db.beforeBatch = () => f.db.sqlite.prepare("UPDATE members SET role='reseller' WHERE id='other'").run();
    await assert.rejects(payout(f, other.id, K), failure(403));
    assert.equal(payoutRows(f).length, 1);
});

test('an operator sees only their own wallet; other, inactive and owner-only access is refused', async t => {
    const f = fixture(t);
    await accept(f, await job(f), 31);
    assert.equal((await wallet(f)).memberId, 'printer');
    assert.equal((await wallet(f, printer, '?memberId=printer')).acceptedShirts, 31);
    await assert.rejects(call(f, '/wallet?memberId=other', undefined, printer), failure(403));
    await assert.rejects(call(f, '/wallet?memberId=', undefined, printer), failure(403));
    const theirs = await wallet(f, other);
    assert.deepEqual([theirs.memberId, theirs.acceptedShirts, theirs.awaitingQA, theirs.recent], ['other', 0, 0, []]);
    await assert.rejects(call(f, '/wallet', undefined, former), failure(403));
    await assert.rejects(call(f, '/wallet', undefined, reseller), failure(403));
    await assert.rejects(call(f, '/wallet', undefined, { ...printer, role: 'owner' }), failure(403));
    await call(f, '/api/members/printer', { active: false, requestId: requestId() }, owner, 'PATCH');
    await assert.rejects(call(f, '/wallet', undefined, printer), failure(403));
    f.env.PRINT_QUEUE_ENABLED = 'false';
    await assert.rejects(call(f, '/wallet', undefined, owner), failure(404));
});

test('the operator wallet response is an allowlist with no customer, order, price or other-employee data', async t => {
    const f = fixture(t);
    let current = await accept(f, await job(f), 30);
    current = await printed(f, current, 2);
    await payout(f, printer.id, K, { note: 'Cash' });
    const jobCode = f.db.sqlite.prepare('SELECT job_code FROM production_jobs').get().job_code;
    const response = await call(f, '/wallet', undefined, printer);
    assert.deepEqual(Object.keys(response), ['wallet']);
    assert.deepEqual(Object.keys(response.wallet).sort(), [
        'acceptedShirts', 'awaitingQA', 'balanceCentavos', 'earnedCentavos', 'memberId', 'name', 'nextPayoutIn',
        'paidCentavos', 'progress', 'rateCentavos', 'rateShirts', 'recent', 'shirtsThisWeek'
    ].sort());
    const types = response.wallet.recent.map(entry => [entry.type, Object.keys(entry).sort()]);
    assert.deepEqual(types, [['payout', ['amountCentavos', 'at', 'note', 'type']], ['credit', ['at', 'jobCode', 'shirts', 'type']]]);
    assert.equal(response.wallet.recent[1].jobCode, jobCode);
    assert.deepEqual([response.wallet.name, response.wallet.awaitingQA], ['Sam', 2]);
    const encoded = JSON.stringify(response).toLowerCase();
    for (const forbidden of ['private', 'email', 'orderid', 'st-print', 'sourceid', 'customer', 'contact', 'address',
        'receipt', 'cost', 'price', 'total', 'revenue', 'shipping', '95000', 'alex', 'other', 'owner', 'created_by']) {
        assert.ok(!encoded.includes(forbidden), forbidden);
    }
});

test('owner sees every print operator, one by memberId, and unattributed shirts', async t => {
    const f = fixture(t);
    await accept(f, await job(f), 45);
    const all = await call(f, '/wallet');
    assert.deepEqual(Object.keys(all).sort(), ['unattributed', 'wallets']);
    assert.deepEqual(all.wallets.map(entry => [entry.memberId, entry.name]), [['other', 'Alex'], ['printer', 'Sam'], ['former', 'Print operator']]);
    assert.deepEqual(all.unattributed, { shirts: 0, recent: [] });
    const one = await wallet(f, owner, '?memberId=printer');
    assert.deepEqual([one.acceptedShirts, one.earnedCentavos, one.progress], [45, K, 15]);
    assert.equal((await wallet(f, owner, '?memberId=former')).acceptedShirts, 0);
    await assert.rejects(call(f, '/wallet?memberId=owner'), failure(404));
    await assert.rejects(call(f, '/wallet?memberId=reseller'), failure(404));
    await assert.rejects(call(f, '/wallet?memberId=missing'), failure(404));
});

test('shirts this week use the Monday-Sunday week in Asia/Manila', async t => {
    assert.equal(manilaWeekStart(new Date('2026-10-06T04:22:41.887Z')), '2026-10-04T16:00:00.000Z');
    assert.equal(manilaWeekStart(new Date('2026-10-04T15:59:59.999Z')), '2026-09-27T16:00:00.000Z');
    assert.equal(manilaWeekStart(new Date('2026-10-11T15:59:59.999Z')), '2026-10-04T16:00:00.000Z');
    assert.equal(manilaWeekStart(new Date('2026-10-11T16:00:00.000Z')), '2026-10-11T16:00:00.000Z');
    const f = fixture(t);
    const current = await accept(f, await job(f), 12);
    f.db.sqlite.prepare(`INSERT INTO production_events(job_id,actor_id,actor_name,action,quantity,accepted,rejected,version,operator_id,created_at)
        VALUES (?,'owner','Owner','qa',0,5,0,1,'printer','2020-01-06T00:00:00.000Z')`).run(current.id);
    const mine = await wallet(f);
    assert.deepEqual([mine.acceptedShirts, mine.shirtsThisWeek], [17, 12]);
});

test('read-only environments refuse payouts before authentication or database access', async () => {
    const env = { ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'a'.repeat(64),
        ENVIRONMENT: 'staging', MUTATIONS_ENABLED: 'false', PRINT_QUEUE_ENABLED: 'true', DB: {} };
    const response = await worker.fetch(new Request('https://staging.example.test/api/production/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId: 'printer', amountCentavos: K, requestId: 'read-only' })
    }), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'maintenance_read_only');
});

test('migration 0007 is additive and leaves earlier migrations untouched', () => {
    assert.deepEqual(names.slice(0, 7), ['0001_business.sql', '0002_transaction_date_pattern.sql', '0003_business_api.sql',
        '0004_public_api.sql', '0005_production.sql', '0006_media_sms.sql', '0007_print_wallet.sql']);
    const code = walletMigration.replace(/--.*$/gm, '');
    assert.doesNotMatch(code, /\bDROP\b|\bRENAME\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(code, /\bREAL\b|\bFLOAT\b|\bNUMERIC\b/i);
});
