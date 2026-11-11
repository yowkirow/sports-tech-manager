import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest } from '../../worker/business-api.ts';
import { handleProductionRequest } from '../../worker/production-api.ts';
import { HttpError } from '../../worker/errors.ts';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const printer = { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' };
const former = { id: 'former', email: 'former@example.invalid', role: 'print_operator' };
const reseller = { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' };
const id = number => `30000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

// Real SQLite migrations with D1's batch shape.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of [owner, printer, former, reseller]) {
            this.sqlite.prepare('INSERT INTO members(id,email,role,active) VALUES (?,?,?,?)')
                .run(member.id, member.email, member.role, member === former ? 0 : 1);
        }
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { this.values = values; return this; },
            async all() { return db.execute(this); },
            async run() { return db.execute(this); },
            async first(column) {
                const row = db.execute(this).results[0];
                return column ? row?.[column] ?? null : row ?? null;
            }
        };
    }
    execute(statement) {
        return { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values), meta: {} };
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

const env = db => ({ DB: db, ENVIRONMENT: 'production', PRINT_QUEUE_ENABLED: 'true' });
async function business(db, member, path, method, body) {
    const response = await handleBusinessRequest(new Request(`https://app.example.invalid${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env(db), member);
    assert.equal(response.status, 200);
    return response.json();
}
async function blanks(db, member) {
    const response = await handleProductionRequest(new Request('https://app.example.invalid/api/production/blanks'), env(db), member);
    assert.equal(response.status, 200);
    return (await response.json()).blanks;
}
const rejects = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.deepEqual([error.status, error.code], [status, code]);
    return true;
};
const sizes = (patch = {}) => ({ XS: 0, S: 6, M: 8, L: 15, XL: 6, '2XL': 9, ...patch });
const count = (number, details, row = {}) => ({
    id: id(number), type: 'blank_count', category: 'stock', amount: 0, date: `2026-11-${String(number).padStart(2, '0')}T15:00:00.000Z`,
    description: 'Blank shirt count', details: { rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }], ...details }, ...row
});
const save = (db, rows, member = owner) => business(db, member, '/api/transactions', 'POST', { rows, requestId: crypto.randomUUID() });

test('only the owner saves a count, and only a whole board with no amount', async t => {
    const db = new LocalD1(t);
    const [saved] = (await save(db, [count(1, { note: 'After restock' })])).rows;
    assert.deepEqual(saved.details, { rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }], note: 'After restock',
        createdBy: owner.email, userRole: 'owner' });
    for (const [label, row] of [
        ['no colors', count(2, { rows: [] })],
        ['a color twice', count(3, { rows: [{ color: 'Black', sizes: sizes() }, { color: 'BLACK', sizes: sizes() }] })],
        ['a missing size', count(4, { rows: [{ color: 'Black', sizes: { S: 1 } }] })],
        ['a fraction', count(5, { rows: [{ color: 'Black', sizes: sizes({ M: 0.5 }) }] })],
        ['an extra field', count(6, { counted: 'Sam' })],
        ['an amount', count(7, {}, { amount: 70 })]
    ]) {
        await assert.rejects(save(db, [row]), rejects(400, 'validation_error'), label);
    }
    await assert.rejects(save(db, [count(8)], reseller), rejects(403, 'forbidden'));
    await assert.rejects(save(db, [count(9)], printer), rejects(403, 'forbidden'));
    // A count is never edited: the owner enters a new one.
    await assert.rejects(business(db, owner, `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved, updates: { details: { ...saved.details, note: 'Changed' } }, requestId: 'edit'
    }), rejects(400, 'validation_error'));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM transactions WHERE type='blank_count'").get().n, 1);
});

test('print staff read the newest count: the board, its note and when, never who saved it', async t => {
    const db = new LocalD1(t);
    assert.equal(await blanks(db, printer), null);
    await save(db, [count(1, { rows: [{ color: 'White', sizes: sizes() }] })]);
    await save(db, [count(10, { note: 'After restock', rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }, { color: 'Kiwi', sizes: sizes({ M: 0 }) }] })]);
    const expected = {
        rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }, { color: 'Kiwi', hex: null, sizes: sizes({ M: 0 }) }],
        note: 'After restock', countedAt: '2026-11-10T15:00:00Z'
    };
    assert.deepEqual(await blanks(db, printer), expected);
    assert.deepEqual(await blanks(db, owner), expected);
    for (const member of [reseller, former]) {
        await assert.rejects(handleProductionRequest(new Request('https://app.example.invalid/api/production/blanks'), env(db), member),
            rejects(403, 'production_forbidden'));
    }
    // Deleting the newest count brings back the one before it.
    const newest = db.sqlite.prepare('SELECT * FROM transactions WHERE id=?').get(id(10));
    await business(db, owner, `/api/transactions/${id(10)}`, 'DELETE', { expected: { ...newest, details: JSON.parse(newest.details) }, requestId: 'undo' });
    assert.deepEqual((await blanks(db, printer)).rows.map(row => row.color), ['White']);
});
