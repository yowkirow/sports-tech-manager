import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest } from '../../worker/business-api.ts';
import { HttpError } from '../../worker/errors.ts';
import { chargeId, recordDueCharges } from '../../worker/recurring-expenses.ts';
import worker from '../../worker/index.ts';
import { addMonths, manilaToday } from '../../src/lib/recurringExpenses.js';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const reseller = { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' };
const id = number => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

// Real SQLite migrations with D1's batch and run() result shapes.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of [owner, reseller]) {
            this.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
        }
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) {
                assert.ok(values.length <= 100);
                this.values = values;
                return this;
            },
            async all() { return db.execute(this); },
            async run() { return db.execute(this); },
            async first(column) {
                const row = db.execute(this).results[0];
                return column ? row?.[column] ?? null : row ?? null;
            }
        };
    }
    execute(statement) {
        const results = this.sqlite.prepare(statement.sql).all(...statement.values);
        return { success: true, results, meta: { changes: this.sqlite.prepare('SELECT changes() AS n').get().n } };
    }
    async batch(statements) {
        this.sqlite.exec('BEGIN');
        try {
            const results = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
    }
}

async function call(db, member, path, method, body) {
    const response = await handleBusinessRequest(new Request(`https://app.example.invalid${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), { DB: db, ENVIRONMENT: 'production', PRINT_QUEUE_ENABLED: 'false' }, member);
    assert.equal(response.status, 200);
    return response.json();
}
const rejects = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.deepEqual([error.status, error.code], [status, code]);
    return true;
};
const details = patch => ({ name: 'Design app', amount: 499, subCategory: 'Software/Subscriptions', frequency: 'monthly', startsOn: manilaToday(), ...patch });
const definition = (number, patch, row = {}) => ({
    id: id(number), type: 'recurring_expense', category: 'subscription', amount: 0, date: '2026-11-01T02:00:00Z',
    description: 'Design app', details: details(patch), ...row
});
const add = (db, rows, member = owner) => call(db, member, '/api/transactions', 'POST', { rows, requestId: crypto.randomUUID() });
// Stored as the API stores it, without the first-charge window that is relative to today.
function seed(db, number, patch) {
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details)
        VALUES (?,'recurring_expense','subscription','0','2026-01-01T00:00:00Z',?,?)`)
        .run(id(number), 'Design app', JSON.stringify({ ...details(patch), createdBy: owner.email, userRole: 'owner' }));
}
const charges = db => db.sqlite.prepare(`SELECT id,category,amount,date,description,details FROM transactions
    WHERE type='expense' ORDER BY date,id`).all().map(row => ({ ...row, details: JSON.parse(row.details) }));
const stored = (db, number) => {
    const row = db.sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(id(number));
    return { ...row, details: JSON.parse(row.details) };
};

test('a subscription is a checked record: a full schedule from within a year, no amount of its own, owner-only', async t => {
    const db = new LocalD1(t);
    const today = manilaToday();
    await add(db, [definition(1), definition(2, { frequency: 'yearly', startsOn: addMonths(today, -12), club: 'downtown-dinks' })]);
    assert.equal(stored(db, 1).details.createdBy, owner.email);
    for (const [number, patch, row] of [
        [3, { amount: 0 }], [4, { amount: 12.345 }], [5, { frequency: 'weekly' }], [6, { startsOn: '2026-02-30' }],
        [7, { startsOn: addMonths(today, -13) }], [8, { startsOn: addMonths(today, 13) }], [9, { endsOn: today }], [10, {}, { amount: 499 }]
    ]) {
        await assert.rejects(add(db, [definition(number, patch, row)]), rejects(400, 'validation_error'), JSON.stringify([patch, row]));
    }
    await assert.rejects(add(db, [definition(11)], reseller), rejects(403, 'forbidden'));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM transactions WHERE type='recurring_expense'").get().n, 2);
});

test('a subscription’s schedule never changes; its name, amount, category and assignment do', async t => {
    const db = new LocalD1(t);
    const [saved] = (await add(db, [definition(1)])).rows;
    const change = (updates, requestId) => call(db, owner, `/api/transactions/${id(1)}`, 'PATCH', { expected: saved, updates, requestId });
    for (const [updates, label] of [
        [{ details: { ...saved.details, startsOn: addMonths(manilaToday(), 1) } }, 'first charge'],
        [{ details: { ...saved.details, frequency: 'yearly' } }, 'frequency'],
        [{ amount: 499, details: saved.details }, 'record amount'],
        [{ details: { ...saved.details, amount: -5 } }, 'charge amount']
    ]) {
        await assert.rejects(change(updates, label), rejects(400, 'validation_error'), label);
    }
    const edited = await change({ description: 'Design app Pro', details: { ...saved.details, name: 'Design app Pro', amount: 599.5,
        subCategory: 'Marketing/Ads', club: 'downtown-dinks', updatedBy: owner.email, updatedAt: '2026-11-11T02:00:00.000Z' } }, 'edit');
    assert.deepEqual([edited.row.description, edited.row.details.amount, edited.row.details.startsOn, edited.row.amountExact],
        ['Design app Pro', 599.5, saved.details.startsOn, '0']);
    await call(db, owner, `/api/transactions/${id(1)}`, 'DELETE', { expected: edited.row, requestId: 'stop' });
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
});

test('each charge is recorded once on its day, missed days catch up, and a deleted charge stays deleted', async t => {
    const db = new LocalD1(t);
    seed(db, 1, { startsOn: '2026-01-31' });
    seed(db, 2, { name: 'Page boost', amount: 1200.5, subCategory: 'Marketing/Ads', frequency: 'yearly', startsOn: '2026-03-15', club: 'downtown-dinks' });
    seed(db, 3, { amount: 'broken' });
    assert.equal(await recordDueCharges(db, '2026-01-30'), 0);
    assert.equal(await recordDueCharges(db, '2026-04-30'), 5);
    assert.equal(await recordDueCharges(db, '2026-04-30'), 0, 'a second run records nothing');
    const recorded = charges(db);
    assert.deepEqual(recorded.map(row => [row.date, row.amount, row.category, row.description]), [
        ['2026-01-31T01:00:00Z', '499', 'general', 'Design app'],
        ['2026-02-28T01:00:00Z', '499', 'general', 'Design app'],
        ['2026-03-15T01:00:00Z', '1200.5', 'ads', 'Page boost'],
        ['2026-03-31T01:00:00Z', '499', 'general', 'Design app'],
        ['2026-04-30T01:00:00Z', '499', 'general', 'Design app']
    ]);
    assert.deepEqual(recorded[2], {
        id: await chargeId(id(2), '2026-03-15'), category: 'ads', amount: '1200.5', date: '2026-03-15T01:00:00Z', description: 'Page boost',
        details: { club: 'downtown-dinks', createdBy: owner.email, isGeneral: true, recurringDate: '2026-03-15', recurringId: id(2),
            reimbursed: false, reimbursedAmount: 0, subCategory: 'Marketing/Ads', userRole: 'owner' }
    });

    // The owner deletes February's charge and stops the yearly one; neither comes back.
    const february = db.sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(recorded[1].id);
    await call(db, owner, `/api/transactions/${february.id}`, 'DELETE', {
        expected: { ...february, details: JSON.parse(february.details) }, requestId: 'skip-february'
    });
    db.sqlite.prepare('DELETE FROM transactions WHERE id=?').run(id(2));
    assert.equal(await recordDueCharges(db, '2027-04-01'), 11, 'May 2026 to March 2027, nothing for the stopped one');
    assert.equal(charges(db).some(row => row.id === recorded[1].id), false);
    assert.equal(charges(db).filter(row => row.details.recurringId === id(2)).length, 1);
});

test('only the Worker records charges, and a charge keeps its subscription and day', async t => {
    const db = new LocalD1(t);
    seed(db, 1, { startsOn: '2026-01-15' });
    await recordDueCharges(db, '2026-01-15');
    const [charge] = charges(db);
    const claim = { recurringId: id(1), recurringDate: '2026-02-15' };
    await assert.rejects(add(db, [{ id: id(9), type: 'expense', category: 'general', amount: 499, date: '2026-02-15T01:00:00Z',
        description: 'Design app', details: { subCategory: 'Software/Subscriptions', ...claim } }]), rejects(400, 'validation_error'));
    const expected = { ...charge, type: 'expense' };
    const change = (details, requestId) => call(db, owner, `/api/transactions/${charge.id}`, 'PATCH', { expected, updates: { details }, requestId });
    await assert.rejects(change({ ...charge.details, recurringDate: '2026-02-15' }, 'move'), rejects(400, 'validation_error'));
    const reimbursed = await change({ ...charge.details, reimbursed: true, reimbursedAmount: 499 }, 'reimburse');
    assert.equal(reimbursed.row.details.recurringId, id(1));
});

test('owners record due charges at once; the nightly run records them in writable environments only', async t => {
    const db = new LocalD1(t);
    const today = manilaToday();
    seed(db, 1, { startsOn: addMonths(today, -2) });
    const charge = (member = owner) => call(db, member, '/api/recurring-expenses/charge', 'POST', {});
    assert.deepEqual(await charge(), { inserted: 3 });
    assert.deepEqual(await charge(), { inserted: 0 });
    await assert.rejects(charge(reseller), rejects(403, 'forbidden'));

    const later = new LocalD1(t);
    seed(later, 1, { startsOn: '2026-06-01' });
    // 16:05 UTC on 30 June is 00:05 on 1 July in Manila, so July's charge is due.
    const nightly = { cron: '5 16 * * *', scheduledTime: Date.UTC(2026, 5, 30, 16, 5) };
    await worker.scheduled(nightly, { DB: later, ENVIRONMENT: 'staging', MUTATIONS_ENABLED: 'false' });
    assert.equal(charges(later).length, 0);
    await worker.scheduled(nightly, { DB: later, ENVIRONMENT: 'production', MUTATIONS_ENABLED: 'true' });
    assert.deepEqual(charges(later).map(row => row.date), ['2026-06-01T01:00:00Z', '2026-07-01T01:00:00Z']);
});
