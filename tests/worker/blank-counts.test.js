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

// Real SQLite migrations with D1's batch shape.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of [owner, printer, former, reseller]) {
            this.sqlite.prepare('INSERT INTO members(id,email,role,active) VALUES (?,?,?,?)')
                .run(member.id, member.email, member.role, member === former ? 0 : 1);
        }
        this.sqlite.prepare("INSERT INTO member_profiles(member_id,profile) VALUES ('printer',?)").run(JSON.stringify({ full_name: 'Sam' }));
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
async function production(db, member, body) {
    const response = await handleProductionRequest(new Request('https://app.example.invalid/api/production/blanks', {
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), env(db), member);
    assert.equal(response.status, 200);
    return response.json();
}
async function business(db, member, path, method, body) {
    const response = await handleBusinessRequest(new Request(`https://app.example.invalid${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env(db), member);
    assert.equal(response.status, 200);
    return response.json();
}
const rejects = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.deepEqual([error.status, error.code], [status, code]);
    return true;
};
const sizes = (patch = {}) => ({ XS: 0, S: 6, M: 8, L: 15, XL: 6, '2XL': 9, ...patch });
const black = (patch = {}) => ({ color: 'Black', hex: '#000000', sizes: sizes(patch) });
const save = (db, member, board, requestId = crypto.randomUUID()) => production(db, member, { ...board, requestId });
const read = (db, member) => production(db, member);
const countRows = db => db.sqlite.prepare("SELECT id,type,category,amount,date,description,details FROM transactions WHERE type='blank_count' ORDER BY rowid")
    .all().map(row => ({ ...row, details: JSON.parse(row.details) }));

test('the owner and the print staff save counts through one endpoint, each named as who counted', async t => {
    const db = new LocalD1(t);
    assert.equal((await read(db, printer)).blanks, null);
    const first = await save(db, printer, { rows: [black(), { color: 'Kiwi', sizes: sizes({ M: 0 }) }], note: ' After the print run ', basedOn: null });
    assert.deepEqual(countRows(db), [{
        id: first.id, type: 'blank_count', category: 'stock', amount: '0', date: first.countedAt, description: 'Blank shirt count',
        details: { countedBy: 'Sam', createdBy: printer.email, note: 'After the print run', userRole: 'print_operator',
            rows: [black(), { color: 'Kiwi', hex: null, sizes: sizes({ M: 0 }) }] }
    }]);
    const staffView = (await read(db, printer)).blanks;
    assert.deepEqual(staffView, { rows: [black(), { color: 'Kiwi', hex: null, sizes: sizes({ M: 0 }) }], note: 'After the print run',
        id: first.id, countedAt: first.countedAt, countedBy: 'Sam', byYou: true });
    assert.equal((await read(db, owner)).blanks.byYou, false);

    const second = await save(db, owner, { rows: [black({ M: 20 })], basedOn: first.id });
    const latest = await read(db, printer);
    assert.deepEqual([latest.blanks.id, latest.blanks.countedBy, latest.blanks.byYou, latest.blanks.note, latest.blanks.rows[0].sizes.M],
        [second.id, 'Owner', false, '', 20]);
    assert.doesNotMatch(JSON.stringify(latest), /@/, 'staff never see an email');
    assert.equal(countRows(db).at(-1).details.createdBy, owner.email);
});

test('a save from an older count is refused and writes nothing, so nobody’s newer count is lost', async t => {
    const db = new LocalD1(t);
    const a = await save(db, printer, { rows: [black()], basedOn: null });
    const b = await save(db, owner, { rows: [black({ M: 30 })], basedOn: a.id });
    // The printer still had A open. The dialog keeps one request ID; a refused save leaves no receipt behind.
    await assert.rejects(save(db, printer, { rows: [black({ M: 2 })], basedOn: a.id }, 'printer-dialog'), rejects(409, 'production_conflict'));
    await assert.rejects(save(db, printer, { rows: [black({ M: 2 })], basedOn: null }, 'printer-dialog'), rejects(409, 'production_conflict'));
    assert.equal(countRows(db).length, 2);
    assert.equal((await read(db, printer)).blanks.id, b.id);
    // Having seen B, the printer replaces it from the same open dialog.
    const c = await save(db, printer, { rows: [black({ M: 2 })], basedOn: b.id.toUpperCase() }, 'printer-dialog');
    assert.deepEqual([(await read(db, owner)).blanks.id, countRows(db).length], [c.id, 3]);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM _production_guards').get().n, 0);
});

test('a new count lists first even when the clock has not moved past the one it replaces', async t => {
    const db = new LocalD1(t);
    // The highest id wins a same-time tie, so without the later stamp the older count would stay current.
    const last = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details)
        VALUES (?,'blank_count','stock','0','2099-01-01T00:00:00.000Z','Blank shirt count',?)`)
        .run(last, JSON.stringify({ rows: [black()], countedBy: 'Owner', createdBy: owner.email, userRole: 'owner' }));
    const saved = await save(db, printer, { rows: [black({ M: 1 })], basedOn: last });
    assert.equal(saved.countedAt, '2099-01-01T00:00:00.001Z');
    assert.equal((await read(db, owner)).blanks.id, saved.id);
});

test('a retried save is recorded once; the same request with other numbers is refused', async t => {
    const db = new LocalD1(t);
    const body = { rows: [black()], basedOn: null };
    const first = await save(db, printer, body, 'retry-1');
    assert.deepEqual(await save(db, printer, body, 'retry-1'), first);
    assert.equal(countRows(db).length, 1);
    await assert.rejects(save(db, printer, { ...body, rows: [black({ M: 1 })] }, 'retry-1'), rejects(409, 'production_receipt_conflict'));
    assert.equal(countRows(db).length, 1);
});

test('only active owner or print staff save a whole board, and only through this endpoint', async t => {
    const db = new LocalD1(t);
    for (const [label, body] of [
        ['no colors', { rows: [], basedOn: null }],
        ['a color twice', { rows: [black(), { color: 'BLACK', sizes: sizes() }], basedOn: null }],
        ['a missing size', { rows: [{ color: 'Black', sizes: { S: 1 } }], basedOn: null }],
        ['a fraction', { rows: [black({ M: 0.5 })], basedOn: null }],
        ['an extra row field', { rows: [{ ...black(), cost: 70 }], basedOn: null }],
        ['a long note', { rows: [black()], note: 'x'.repeat(201), basedOn: null }],
        ['an extra field', { rows: [black()], basedOn: null, countedBy: 'Boss' }],
        ['no starting count', { rows: [black()] }],
        ['a made-up starting count', { rows: [black()], basedOn: 'yesterday' }]
    ]) {
        await assert.rejects(save(db, printer, body), rejects(400, 'production_invalid'), label);
    }
    for (const member of [reseller, former]) {
        await assert.rejects(save(db, member, { rows: [black()], basedOn: null }), rejects(403, 'production_forbidden'));
        await assert.rejects(read(db, member), rejects(403, 'production_forbidden'));
    }
    await assert.rejects(business(db, owner, '/api/transactions', 'POST', { requestId: 'old-path', rows: [{
        id: crypto.randomUUID(), type: 'blank_count', category: 'stock', amount: 0, date: '2026-11-13T01:00:00Z', details: { rows: [black()] }
    }] }), rejects(400, 'validation_error'));
    assert.equal(countRows(db).length, 0);

    // A count is never edited; deleting the newest brings back the one before.
    const older = await save(db, owner, { rows: [{ color: 'White', sizes: sizes() }], basedOn: null });
    const newest = await save(db, printer, { rows: [black()], basedOn: older.id });
    const [, stored] = countRows(db);
    await assert.rejects(business(db, owner, `/api/transactions/${newest.id}`, 'PATCH', {
        expected: stored, updates: { details: { ...stored.details, note: 'Changed' } }, requestId: 'edit'
    }), rejects(400, 'validation_error'));
    await business(db, owner, `/api/transactions/${newest.id}`, 'DELETE', { expected: stored, requestId: 'undo' });
    assert.deepEqual((await read(db, printer)).blanks.rows.map(row => row.color), ['White']);
});

test('print staff get the shop’s colors, and the shirt colors to start a first count with', async t => {
    const db = new LocalD1(t);
    let second = 0;
    const seed = (type, details) => db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details)
        VALUES (?,?,'catalog','0',?,?)`).run(crypto.randomUUID(), type, `2026-10-01T00:00:${String(second++).padStart(2, '0')}Z`, JSON.stringify(details));
    seed('define_color', { name: 'Peach', hex: '#CA6949' });
    seed('delete_color', { name: 'Baby Blue' });
    seed('define_product', { name: 'Court Tee Black', linkedColor: 'Black', category: 'shirts', price: 550, imageUrl: '/private.jpg' });
    seed('define_product', { name: 'Rally Tee Black', linkedColor: 'Black', price: 550 });
    seed('define_product', { name: 'Court Tee Peach', linkedColor: 'Peach', category: 'shirts' });
    seed('define_product', { name: 'Old Tee Kiwi', linkedColor: 'Kiwi', category: 'shirts' });
    seed('delete_product', { name: 'Old Tee Kiwi' });
    seed('define_product', { name: 'Practice Ball', linkedColor: 'Black', category: 'accessories' });
    const { colors, suggested } = await read(db, printer);
    assert.deepEqual(colors, [
        { name: 'White', hex: '#ffffff' }, { name: 'Black', hex: '#000000' }, { name: 'Kiwi', hex: '#bef264' },
        { name: 'Cream', hex: '#fef3c7' }, { name: 'Peach', hex: '#ca6949' }
    ]);
    assert.deepEqual(suggested, [{ color: 'Black', hex: '#000000' }, { color: 'Peach', hex: '#ca6949' }]);
});
