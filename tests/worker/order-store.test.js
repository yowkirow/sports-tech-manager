import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { OrderStoreError, saveOrderChanges } from '../../worker/order-store.ts';

const migrationDirectory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'));
const ORDER = 'ST-TEST001';
const OTHER_ORDER = 'ST-TEST002';
const DATE = '2026-09-10T01:02:03.123456Z';
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

// This adapter verifies SQLite SQL/rollback semantics, not remote D1 batch,
// network failure behavior, Worker CPU limits or deployed D1 query accounting.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        this.executed = [];
        this.beforeBatch = null;
        this.hideResponse = false;
        t.after(() => this.sqlite.close());
    }

    prepare(sql) {
        const database = this;
        return {
            sql,
            values: [],
            bind(...values) {
                assert.ok(values.length <= 100, 'D1 allows at most 100 bound parameters');
                for (const value of values) {
                    if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= 2_000_000, 'D1 binding exceeds 2 MB');
                }
                this.values = values;
                return this;
            },
            async all() {
                return database.execute(this);
            }
        };
    }

    execute(statement) {
        this.executed.push({ sql: statement.sql, values: statement.values });
        const results = this.sqlite.prepare(statement.sql).all(...statement.values);
        return {
            success: true,
            results,
            meta: { changes: this.sqlite.prepare('SELECT changes() AS count').get().count }
        };
    }

    async batch(statements) {
        const hook = this.beforeBatch;
        this.beforeBatch = null;
        if (hook) await hook();
        this.sqlite.exec('BEGIN');
        let results;
        try {
            results = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            // Real D1 errors can wrap SQLite's named constraint message.
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
        if (this.hideResponse) results.at(-1).results = [];
        return results;
    }
}

function fixture(t, { count = 2, key = ORDER, nested = false, nullDetails = false } = {}) {
    const db = new LocalD1(t);
    const member = db.sqlite.prepare('INSERT INTO members(id, email, role, active) VALUES (?, ?, ?, ?)');
    for (const [name, role, active] of [
        ['owner', 'owner', 1], ['second-owner', 'owner', 1], ['disabled', 'owner', 0],
        ['reseller', 'reseller', 1], ['printer', 'print_operator', 1]
    ]) member.run(name, `${name}@example.invalid`, role, active);
    db.sqlite.prepare('INSERT INTO orders(id) VALUES (?)').run(key);
    db.sqlite.prepare('INSERT INTO orders(id) VALUES (?)').run(OTHER_ORDER);
    for (let i = 1; i <= count; i++) {
        const details = nullDetails ? null : {
            orderId: key, status: 'paid', customerName: 'Synthetic customer',
            ...(nested ? { items: [{ name: 'Shirt', quantity: 2, amount: 701.001 }, { name: 'Cap', quantity: 1, amount: 20.5 }] }
                : { itemName: 'Shirt', quantity: 1, shippingDetails: { rushFee: 0, shippingFee: 25.5 } })
        };
        insertRow(db, i, { key, details, amount: i === 1 ? '701.001' : '20.5', order_id: nullDetails ? null : key });
    }
    return db;
}

function insertRow(db, index, { key = ORDER, type = 'sale', details = { orderId: key, status: 'paid' }, amount = '5', order_id = key } = {}) {
    db.sqlite.prepare(`INSERT INTO transactions(id, type, category, amount, date, description, details, order_id)
        VALUES (?, ?, 'Shirts', ?, ?, NULL, ?, ?)`)
        .run(id(index), type, amount, DATE, details === null ? null : JSON.stringify(details), order_id);
}

function rows(db) {
    return db.sqlite.prepare('SELECT * FROM transactions ORDER BY id').all().map(row => ({ ...row }));
}

function request(db, { key = ORDER, requestId = 'request-001', expectedVersion = 0, ids } = {}) {
    return {
        orderId: key, requestId, expectedVersion,
        changes: rows(db).filter(row => ids ? ids.includes(row.id) : row.type === 'sale'
            && ![true, 'true'].includes(JSON.parse(row.details)?.removedFromOrder)).map(row => ({
            id: row.id,
            expected: {
                type: row.type, category: row.category, amount: row.amount, date: row.date,
                description: row.description, details: JSON.parse(row.details)
            },
            updates: { amount: row.amount, details: JSON.parse(row.details) ?? {} }
        }))
    };
}

function state(db) {
    return {
        rows: rows(db),
        orders: db.sqlite.prepare('SELECT * FROM orders ORDER BY id').all(),
        receipts: db.sqlite.prepare('SELECT * FROM mutation_receipts ORDER BY actor_id, request_id').all(),
        audit: db.sqlite.prepare('SELECT * FROM activity_events ORDER BY id').all(),
        guards: db.sqlite.prepare('SELECT * FROM _order_save_guards').all()
    };
}

function expectedError(code, status) {
    return error => {
        assert.ok(error instanceof OrderStoreError, error.stack);
        assert.equal(error.code, code);
        if (status !== undefined) assert.equal(error.status, status);
        return true;
    };
}

async function rejectsUnchanged(db, input, code = 'VALIDATION_ERROR', actor = 'owner') {
    const before = state(db);
    await assert.rejects(saveOrderChanges(db, actor, input), expectedError(code));
    assert.deepEqual(state(db), before);
}

test('final schema LIKE/GLOB patterns fit the real D1 50-byte limit', t => {
    const db = new LocalD1(t);
    const schema = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").all()
        .map(row => row.sql).join('\n');
    for (const [, pattern] of schema.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/g)) {
        assert.ok(Buffer.byteLength(pattern.replaceAll("''", "'")) <= 50, `D1 pattern too long: ${pattern}`);
    }
});

function originalMigrationFixture(t) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(migrations[0]);
    db.prepare('INSERT INTO members(id,email,access_subject,role) VALUES (?,?,?,?)')
        .run('migration-owner', 'owner@example.invalid', 'verified-owner', 'owner');
    db.prepare('INSERT INTO orders(id,version) VALUES (?,?)').run(ORDER, 2);
    db.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id,created_at)
        VALUES (?,'sale','Shirts','701.001',?,NULL,?,?,?)`)
        .run(id(1), DATE, JSON.stringify({ orderId: ORDER, items: [{ quantity: 2 }] }), ORDER, DATE);
    db.prepare('INSERT INTO mutation_receipts(actor_id,request_id,payload_hash,response) VALUES (?,?,?,?)')
        .run('migration-owner', 'before-upgrade', 'saved-hash', JSON.stringify({ version: 2 }));
    db.prepare('INSERT INTO activity_events(actor_id,order_id,action,request_id,details) VALUES (?,?,?,?,?)')
        .run('migration-owner', ORDER, 'order.updated', 'before-upgrade', '{}');
    return db;
}

function migrationSnapshot(db) {
    return Object.fromEntries(['members', 'orders', 'transactions', 'mutation_receipts', 'activity_events']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test('date-constraint upgrade preserves all data, identity mappings, precision and indexes', t => {
    const db = originalMigrationFixture(t);
    const before = migrationSnapshot(db);
    db.exec(`BEGIN;\n${migrations[1]}\nCOMMIT;`);
    assert.deepEqual(migrationSnapshot(db), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'transactions_%' ORDER BY name").all()
        .map(row => row.name), ['transactions_legacy_order', 'transactions_order_id']);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='_transactions_date_pattern_next'").get().n, 0);
});

test('a late date-constraint upgrade failure rolls back the entire table swap', t => {
    const db = originalMigrationFixture(t);
    const before = migrationSnapshot(db);
    const originalSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='transactions'").get().sql;
    db.exec('BEGIN');
    assert.throws(() => db.exec(`${migrations[1]}\nCREATE INDEX transactions_order_id ON transactions(order_id);`),
        /already exists/);
    db.exec('ROLLBACK');
    assert.deepEqual(migrationSnapshot(db), before);
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='transactions'").get().sql, originalSchema);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration has no bootstrap identities and enforces schema and exact decimal text', t => {
    const db = new LocalD1(t);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM members').get().n, 0);
    assert.throws(() => db.sqlite.prepare("INSERT INTO members(id,email,role) VALUES ('x','x@example.invalid','admin')").run());
    for (const amount of ['-0', '01', '-01', '1.10', '1e2', 'NaN', '1.', '.1', '+1', '--1', '1.2.3', '', ' 1']) {
        assert.throws(() => db.sqlite.prepare("INSERT INTO transactions(id,type,category,amount,date) VALUES ('x','sale','Shirts',?,?)").run(amount, DATE), amount);
    }
    for (const [index, amount] of ['0', '-1', '-0.1', '701.001', '9007199254740993.123456789'].entries()) {
        db.sqlite.prepare("INSERT INTO transactions(id,type,category,amount,date) VALUES (?,'sale','Shirts',?,?)").run(id(index), amount, DATE);
        assert.equal(db.sqlite.prepare('SELECT amount, typeof(amount) AS storage FROM transactions WHERE id = ?').get(id(index)).storage, 'text');
    }
    assert.throws(() => db.sqlite.prepare("UPDATE transactions SET details = '{bad'").run());
    for (const date of ['2026-02-30T12:00:00Z', '2026-09-10T24:00:00Z', '2026-09-10T12:00:00+08:00',
        '2026-09-10T12:00:00.Z', '2026-09-10T12:00:00.12xZ', '0000-01-01T00:00:00Z',
        '202x-09-10T12:00:00Z', '2026-0x-10T12:00:00Z', '2026-09-10Tab:00:00Z']) {
        assert.throws(() => db.sqlite.prepare('UPDATE transactions SET date = ?').run(date), date);
    }
});

test('multi-line save writes exact amounts, every editable field, revision, audit and receipt atomically', async t => {
    const db = fixture(t);
    const input = request(db);
    input.changes[0].updates = {
        amount: '+00701.00100', category: 'Uniforms', date: '2026-09-11T09:30:15.987654+08:00',
        description: 'Synthetic note', details: { ...input.changes[0].updates.details, size: 'XL' }
    };
    input.changes[1].updates.amount = 21.125;
    const result = await saveOrderChanges(db, 'owner', input);
    assert.deepEqual(result, { orderId: ORDER, version: 1, ids: [id(1), id(2)] });
    const saved = state(db);
    assert.equal(saved.rows[0].amount, '701.001');
    assert.equal(saved.rows[1].amount, '21.125');
    assert.equal(saved.rows[0].category, 'Uniforms');
    assert.equal(saved.rows[0].date, '2026-09-11T01:30:15.987654Z');
    assert.equal(saved.rows[0].description, 'Synthetic note');
    assert.equal(saved.rows[0].order_id, ORDER);
    assert.equal(saved.receipts.length, 1);
    assert.deepEqual(JSON.parse(saved.receipts[0].response), result);
    assert.match(saved.receipts[0].payload_hash, /^[0-9a-f]{64}$/);
    assert.equal(saved.audit.length, 1);
    assert.equal(saved.audit[0].action, 'order.updated');
    assert.deepEqual(JSON.parse(saved.audit[0].details), { previousVersion: 0, ...result });
    assert.equal(saved.guards.length, 0);
});

test('no-op metadata save preserves historical decimals and sub-millisecond timestamps', async t => {
    const db = fixture(t);
    const input = request(db);
    input.changes[0].expected.amount = '000701.001000';
    input.changes[0].expected.date = '2026-09-10T09:02:03.123456000+08:00';
    input.changes[0].expected.details = JSON.parse(JSON.stringify(input.changes[0].expected.details,
        ['shippingDetails', 'shippingFee', 'rushFee', 'quantity', 'itemName', 'customerName', 'status', 'orderId']));
    input.changes[0].updates.amount = 701.001;
    input.changes[0].updates.details.address = 'Synthetic address';
    await saveOrderChanges(db, 'owner', input);
    assert.equal(rows(db)[0].amount, '701.001');
    assert.equal(rows(db)[0].date, DATE);
    assert.equal(JSON.parse(rows(db)[0].details).shippingDetails.shippingFee, 25.5);
});

test('nested legacy order updates one real source, not its virtual item IDs', async t => {
    const db = fixture(t, { count: 1, key: id(1), nested: true });
    db.sqlite.prepare('UPDATE transactions SET order_id = NULL').run();
    const input = request(db, { key: id(1) });
    input.changes[0].updates.details.items[1].name = 'Updated cap';
    input.changes[0].updates.amount = '721.501';
    const result = await saveOrderChanges(db, 'owner', input);
    assert.deepEqual(result.ids, [id(1)]);
    assert.equal(rows(db)[0].order_id, null);
    assert.equal(JSON.parse(rows(db)[0].details).items.length, 2);
    assert.equal(rows(db)[0].amount, '721.501');
});

test('historical SQL NULL details use the source UUID as the immutable order identity', async t => {
    const db = fixture(t, { count: 1, key: id(1), nullDetails: true });
    const input = request(db, { key: id(1) });
    input.changes[0].updates.details = { status: 'paid', itemName: 'Legacy shirt' };
    await saveOrderChanges(db, 'owner', input);
    assert.equal(rows(db)[0].amount, '701.001');
    assert.equal(rows(db)[0].order_id, null);
});

test('soft removal saves zero and excludes already removed and non-sale rows from membership', async t => {
    const db = fixture(t);
    insertRow(db, 3, { amount: '0', details: { orderId: ORDER, removedFromOrder: true } });
    insertRow(db, 4, { amount: '0', details: { orderId: ORDER, removedFromOrder: 'true' } });
    insertRow(db, 5, { type: 'expense' });
    const input = request(db);
    input.changes[1].updates = { amount: '-0.00', details: { ...input.changes[1].expected.details, removedFromOrder: true } };
    await saveOrderChanges(db, 'owner', input);
    assert.equal(rows(db)[1].amount, '0');
    const next = request(db, { expectedVersion: 1, requestId: 'request-002' });
    assert.deepEqual(next.changes.map(change => change.id), [id(1)]);
    await saveOrderChanges(db, 'owner', next);
    assert.equal(state(db).audit.length, 2);
});

test('legacy removedFromOrder numeric 1 is not the boolean true tombstone', async t => {
    const db = fixture(t, { count: 1 });
    insertRow(db, 2, { details: { orderId: ORDER, removedFromOrder: 1 } });
    assert.equal((await saveOrderChanges(db, 'owner', request(db))).ids.length, 2);
});

test('pending mode accepts legacy paid status but blocks nonpending and fulfillment changes', async t => {
    const db = fixture(t);
    const input = { ...request(db), requirePending: true };
    await saveOrderChanges(db, 'owner', input);
    for (const patch of [{ fulfillmentStatus: 'printing' }, { status: 'completed' }]) {
        const next = { ...request(db, { expectedVersion: 1, requestId: 'request-002' }), requirePending: true };
        Object.assign(next.changes[1].updates.details, patch);
        await rejectsUnchanged(db, next, 'ORDER_NOT_PENDING');
    }
    db.sqlite.prepare("UPDATE transactions SET details = json_set(details, '$.fulfillmentStatus', 'printing') WHERE id = ?").run(id(2));
    await rejectsUnchanged(db, { ...request(db, { expectedVersion: 1, requestId: 'request-003' }), requirePending: true }, 'ORDER_NOT_PENDING');
    await saveOrderChanges(db, 'owner', request(db, { expectedVersion: 1, requestId: 'request-004' }));
});

test('stale version, second-row snapshot and incomplete source set reject without partial changes', async t => {
    const db = fixture(t);
    for (const change of [
        input => { input.expectedVersion = 1; },
        input => { input.changes[1].expected.amount = '99'; },
        input => { input.changes.pop(); }
    ]) {
        const input = request(db);
        input.changes[0].updates.amount = '88';
        change(input);
        await rejectsUnchanged(db, input, 'ORDER_CONFLICT');
    }
});

for (const [field, sql, value] of [
    ['type', 'type = ?', 'expense'],
    ['category', 'category = ?', 'Changed category'],
    ['amount', 'amount = ?', '33.001'],
    ['date', 'date = ?', '2026-09-10T01:02:03.123457Z'],
    ['description', 'description = ?', 'Concurrent description'],
    ['details', "details = json_set(details, '$.quantity', ?)", 4],
    ['order_id', 'order_id = ?', OTHER_ORDER]
]) {
    test(`batch raw snapshot guard catches concurrent ${field} changes after preflight`, async t => {
        const db = fixture(t);
        const input = request(db);
        input.changes[0].updates.amount = '88';
        let concurrentState;
        db.beforeBatch = () => {
            db.sqlite.prepare(`UPDATE transactions SET ${sql} WHERE id = ?`).run(value, id(2));
            concurrentState = state(db);
        };
        await assert.rejects(saveOrderChanges(db, 'owner', input), expectedError('ORDER_CONFLICT', 409));
        assert.deepEqual(state(db), concurrentState);
    });
}

for (const mutation of ['extra', 'deleted', 'replaced', 'removed', 'reparented']) {
    test(`complete membership rejects ${mutation} source rows arriving between read and batch`, async t => {
        const db = fixture(t);
        const input = request(db);
        input.changes[0].updates.amount = '88';
        let concurrentState;
        db.beforeBatch = () => {
            if (mutation === 'extra') insertRow(db, 3);
            if (mutation === 'deleted' || mutation === 'replaced') db.sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id(2));
            if (mutation === 'replaced') insertRow(db, 3);
            if (mutation === 'removed') db.sqlite.prepare("UPDATE transactions SET details = json_set(details, '$.removedFromOrder', json('true')), amount = '0' WHERE id = ?").run(id(2));
            if (mutation === 'reparented') db.sqlite.prepare("UPDATE transactions SET order_id = ?, details = json_set(details, '$.orderId', ?) WHERE id = ?").run(OTHER_ORDER, OTHER_ORDER, id(2));
            concurrentState = state(db);
        };
        await assert.rejects(saveOrderChanges(db, 'owner', input), expectedError('ORDER_CONFLICT'));
        assert.deepEqual(state(db), concurrentState);
    });
}

test('inconsistent stored relational/details identity cannot be edited or silently repaired', async t => {
    const db = fixture(t);
    db.sqlite.prepare('UPDATE transactions SET order_id = ? WHERE id = ?').run(OTHER_ORDER, id(2));
    await rejectsUnchanged(db, request(db), 'ORDER_CONFLICT');
    db.sqlite.prepare('UPDATE transactions SET order_id = NULL').run();
    db.sqlite.prepare('DELETE FROM orders WHERE id = ?').run(ORDER);
    await rejectsUnchanged(db, request(db), 'ORDER_CONFLICT');
});

for (const [name, mutate] of [
    ['empty', input => { input.changes = []; }],
    ['duplicate', input => { input.changes[1].id = input.changes[0].id; }],
    ['virtual ID', input => { input.changes[0].id = `legacy:${id(1)}:0`; }],
    ['all removed', input => { input.changes.forEach(change => { change.updates.amount = 0; change.updates.details.removedFromOrder = true; }); }],
    ['nonzero removed', input => { input.changes[0].updates.details.removedFromOrder = true; }],
    ['reparent details', input => { input.changes[0].updates.details.orderId = OTHER_ORDER; }],
    ['missing order identity', input => { delete input.changes[0].updates.details.orderId; }],
    ['expected wrong order', input => { input.changes[0].expected.details.orderId = OTHER_ORDER; }],
    ['null category', input => { input.changes[0].updates.category = null; }],
    ['null date', input => { input.changes[0].updates.date = null; }],
    ['invalid calendar', input => { input.changes[0].updates.date = '2026-02-30T12:00:00Z'; }],
    ['timezone omitted', input => { input.changes[0].updates.date = '2026-09-10T12:00:00'; }],
    ['invalid timezone', input => { input.changes[0].updates.date = '2026-09-10T12:00:00+24:00'; }],
    ['fulfillment record field', input => { input.changes[0].updates.fulfillmentStatus = 'printing'; }],
    ['reparent record field', input => { input.changes[0].updates.order_id = OTHER_ORDER; }],
    ['missing expected description', input => { delete input.changes[0].expected.description; }],
    ['negative amount', input => { input.changes[0].updates.amount = '-0.001'; }],
    ['text exponent', input => { input.changes[0].updates.amount = '7.01001e2'; }],
    ['numeric exponent', input => { input.changes[0].updates.amount = 1e-7; }],
    ['text NaN', input => { input.changes[0].updates.amount = 'NaN'; }],
    ['numeric NaN', input => { input.changes[0].updates.amount = NaN; }],
    ['infinity', input => { input.changes[0].updates.amount = Infinity; }],
    ['unsafe number', input => { input.changes[0].updates.amount = Number.MAX_SAFE_INTEGER + 1; }],
    ['unsafe expected number', input => { input.changes[0].expected.amount = Number.MAX_SAFE_INTEGER + 1; }],
    ['undefined JSON', input => { input.changes[0].updates.details.bad = undefined; }],
    ['nonfinite JSON', input => { input.changes[0].updates.details.bad = Infinity; }],
    ['unsafe JSON', input => { input.changes[0].updates.details.bad = Number.MAX_SAFE_INTEGER + 1; }],
    ['array details', input => { input.changes[0].updates.details = []; }],
    ['negative version', input => { input.expectedVersion = -1; }],
    ['overflow version', input => { input.expectedVersion = Number.MAX_SAFE_INTEGER; }],
    ['nonboolean pending flag', input => { input.requirePending = 'true'; }]
]) {
    test(`validates ${name} before any D1 writes`, async t => {
        const db = fixture(t);
        const input = request(db);
        mutate(input);
        await rejectsUnchanged(db, input);
        assert.equal(db.executed.length, 0);
    });
}

test('large exact text decimals are not rounded through JS or SQLite numbers', async t => {
    const db = fixture(t);
    const input = request(db);
    input.changes[0].updates.amount = '9007199254740993.123456789000';
    await saveOrderChanges(db, 'owner', input);
    assert.equal(rows(db)[0].amount, '9007199254740993.123456789');
});

for (const actor of ['unknown', 'disabled', 'reseller', 'printer']) {
    test(`database denies ${actor} actors`, async t => {
        const db = fixture(t);
        await rejectsUnchanged(db, request(db), 'FORBIDDEN', actor);
    });
}

test('membership revoked after preflight is denied inside the atomic batch', async t => {
    const db = fixture(t);
    const input = request(db);
    db.beforeBatch = () => db.sqlite.prepare("UPDATE members SET role = 'reseller' WHERE id = 'owner'").run();
    await rejectsUnchanged(db, input, 'FORBIDDEN');
});

test('canonical idempotent replay is stable with reordered objects, scale, timezone and row order', async t => {
    const db = fixture(t);
    const input = request(db);
    const first = await saveOrderChanges(db, 'owner', input);
    const committed = state(db);
    const replay = structuredClone(input);
    replay.changes.reverse();
    replay.requirePending = false;
    for (const change of replay.changes) {
        change.expected.amount += '000';
        change.updates.amount = Number(change.updates.amount);
        change.expected.date = '2026-09-10T09:02:03.123456000+08:00';
        change.expected.details = Object.fromEntries(Object.entries(change.expected.details).reverse());
        change.updates.details = Object.fromEntries(Object.entries(change.updates.details).reverse());
        change.updates.category = change.expected.category;
        change.updates.date = DATE;
        change.updates.description = null;
    }
    assert.deepEqual(await saveOrderChanges(db, 'owner', replay), first);
    assert.deepEqual(state(db), committed);
    db.sqlite.prepare("UPDATE members SET active = 0 WHERE id = 'owner'").run();
    await rejectsUnchanged(db, replay, 'FORBIDDEN');
});

test('replay still checks authorization when receipt and order are already committed', async t => {
    const db = fixture(t);
    const input = request(db);
    await saveOrderChanges(db, 'owner', input);
    db.sqlite.prepare("UPDATE members SET role = 'print_operator' WHERE id = 'owner'").run();
    await rejectsUnchanged(db, input, 'FORBIDDEN');
});

test('request ID reuse with changed payload conflicts; identical IDs are scoped to actors', async t => {
    const db = fixture(t);
    const input = request(db);
    await saveOrderChanges(db, 'owner', input);
    const changed = structuredClone(input);
    changed.changes[1].updates.amount = '123';
    await rejectsUnchanged(db, changed, 'IDEMPOTENCY_CONFLICT');
    const next = request(db, { expectedVersion: 1 });
    await saveOrderChanges(db, 'second-owner', next);
    assert.equal(state(db).receipts.length, 2);
    assert.equal(state(db).audit.length, 2);
});

test('a duplicate committed after preflight is replayed without another revision or audit', async t => {
    const db = fixture(t);
    const input = request(db);
    input.changes[0].updates.amount = '99';
    let first;
    db.beforeBatch = async () => { first = await saveOrderChanges(db, 'owner', input); };
    assert.deepEqual(await saveOrderChanges(db, 'owner', input), first);
    assert.equal(state(db).audit.length, 1);
    assert.equal(state(db).orders.find(order => order.id === ORDER).version, 1);
});

test('a different save committed after preflight conflicts rather than overwriting it', async t => {
    const db = fixture(t);
    const input = request(db);
    let committed;
    db.beforeBatch = async () => {
        const other = structuredClone(input);
        other.requestId = 'concurrent-request';
        other.changes[0].updates.amount = '99';
        await saveOrderChanges(db, 'owner', other);
        committed = state(db);
    };
    await assert.rejects(saveOrderChanges(db, 'owner', input), expectedError('ORDER_CONFLICT'));
    assert.deepEqual(state(db), committed);
});

test('unexpected SQL error on a later source rolls back earlier writes and propagates', async t => {
    const db = fixture(t);
    db.sqlite.exec(`CREATE TRIGGER synthetic_abort BEFORE UPDATE ON transactions
        WHEN NEW.id = '${id(2)}' BEGIN SELECT RAISE(ABORT, 'synthetic later source failure'); END`);
    const before = state(db);
    const input = request(db);
    input.changes[0].updates.amount = '88';
    await assert.rejects(saveOrderChanges(db, 'owner', input), error => {
        assert.ok(!(error instanceof OrderStoreError));
        assert.match(error.message, /synthetic later source failure/);
        return true;
    });
    assert.deepEqual(state(db), before);
});

for (const [name, trigger] of [
    ['silently skipped source', `BEFORE UPDATE ON transactions WHEN NEW.id = '${id(2)}'`],
    ['silently skipped revision', 'BEFORE UPDATE ON orders'],
    ['silently skipped audit', 'BEFORE INSERT ON activity_events'],
    ['silently skipped receipt', 'BEFORE INSERT ON mutation_receipts']
]) {
    test(`${name} triggers a real CHECK failure and rolls back all writes`, async t => {
        const db = fixture(t);
        db.sqlite.exec(`CREATE TRIGGER synthetic_ignore ${trigger} BEGIN SELECT RAISE(IGNORE); END`);
        const input = request(db);
        input.changes[0].updates.amount = '88';
        await rejectsUnchanged(db, input, 'ORDER_CONFLICT');
    });
}

test('each named guard inserts a failing row for both false and NULL conditions', async t => {
    const db = fixture(t);
    for (const kind of ['forbidden', 'receipt_conflict', 'conflict', 'updated', 'version_updated', 'audit_written', 'receipt_written']) {
        for (const condition of ['0', 'NULL']) {
            const before = state(db);
            await assert.rejects(db.batch([
                db.prepare("UPDATE transactions SET amount = '55'"),
                db.prepare(`INSERT INTO _order_save_guards(kind, ok) VALUES ('${kind}', CASE WHEN ${condition} THEN 1 ELSE 0 END)`)
            ]), new RegExp(`CHECK constraint failed: order_save_${kind}`));
            assert.deepEqual(state(db), before);
        }
    }
});

test('unexpected read and batch outages are never mislabeled as optimistic conflicts', async t => {
    const db = fixture(t);
    const input = request(db);
    const outage = new Error('D1 unavailable');
    db.beforeBatch = () => { throw outage; };
    await assert.rejects(saveOrderChanges(db, 'owner', input), error => error === outage);
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
        const statement = prepare(sql);
        statement.all = async () => { throw outage; };
        return statement;
    };
    await assert.rejects(saveOrderChanges(db, 'owner', input), error => error === outage);
    assert.equal(state(db).audit.length, 0);
});

test('remote D1 extended CHECK errors retain the specific authorization and conflict result', async t => {
    const db = fixture(t);
    const input = request(db);
    for (const [constraint, code, status] of [
        ['order_save_forbidden', 'FORBIDDEN', 403],
        ['order_save_receipt_conflict', 'IDEMPOTENCY_CONFLICT', 409],
        ['order_save_conflict', 'ORDER_CONFLICT', 409],
        ['order_save_updated', 'ORDER_CONFLICT', 409],
        ['order_save_version_updated', 'ORDER_CONFLICT', 409],
        ['order_save_audit_written', 'ORDER_CONFLICT', 409],
        ['order_save_receipt_written', 'ORDER_CONFLICT', 409]
    ]) {
        db.beforeBatch = () => {
            throw new Error(`D1_ERROR: CHECK constraint failed: ${constraint}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)`);
        };
        await assert.rejects(saveOrderChanges(db, 'owner', input), expectedError(code, status));
    }
    for (const message of [
        'D1_ERROR: CHECK constraint failed: unrelated_constraint: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)',
        'D1_ERROR: UNIQUE constraint failed: activity_events.actor_id, activity_events.request_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
        'Remote service mentioned CHECK constraint failed: order_save_conflict',
        'D1_ERROR: CHECK constraint failed: order_save_conflict: unexpected suffix'
    ]) {
        const error = new Error(message);
        db.beforeBatch = () => { throw error; };
        await assert.rejects(saveOrderChanges(db, 'owner', input), received => received === error);
    }
    assert.equal(state(db).audit.length, 0);
});

test('a missing final response is an unknown outcome and receipt retry confirms exactly one save', async t => {
    const db = fixture(t);
    const input = request(db);
    db.hideResponse = true;
    await assert.rejects(saveOrderChanges(db, 'owner', input), error => {
        assert.ok(!(error instanceof OrderStoreError));
        assert.match(error.message, /could not be confirmed/);
        return true;
    });
    assert.equal(state(db).audit.length, 1);
    db.hideResponse = false;
    assert.equal((await saveOrderChanges(db, 'owner', input)).version, 1);
    assert.equal(state(db).audit.length, 1);
});

test('inconsistent stored receipt responses remain unexpected errors for the caller to log', async t => {
    const db = fixture(t);
    const input = request(db);
    await saveOrderChanges(db, 'owner', input);
    for (const response of ['{}', '{"orderId":"ST-TEST001","version":1,"ids":[9007199254740999]}']) {
        db.sqlite.prepare('UPDATE mutation_receipts SET response = ?').run(response);
        const before = state(db);
        await assert.rejects(saveOrderChanges(db, 'owner', input), error => {
            assert.ok(!(error instanceof OrderStoreError));
            assert.match(error.message, /receipt is inconsistent/);
            return true;
        });
        assert.deepEqual(state(db), before);
    }
});

test('150 source rows use a constant 14 SQL statements and at most eight parameters', async t => {
    const db = fixture(t, { count: 150 });
    const input = request(db);
    for (const change of input.changes) change.updates.amount = '701.001';
    const result = await saveOrderChanges(db, 'owner', input);
    assert.equal(result.ids.length, 150);
    assert.equal(db.executed.length, 14);
    assert.ok(db.executed.length <= 20);
    assert.equal(Math.max(...db.executed.map(statement => statement.values.length)), 8);
    assert.ok(Math.max(...db.executed.flatMap(statement => statement.values
        .filter(value => typeof value === 'string').map(value => Buffer.byteLength(value)))) < 200_000);
    assert.ok(rows(db).every(row => row.amount === '701.001'));
    assert.equal(state(db).audit.length, 1);
});

test('oversized request bytes and excessive JSON nesting fail before SQL without an item-count cap', async t => {
    const db = fixture(t);
    const oversized = request(db);
    oversized.changes[0].updates.details.large = 'x'.repeat(1024 * 1024);
    await rejectsUnchanged(db, oversized, 'PAYLOAD_TOO_LARGE');
    const deep = request(db);
    let nested = {};
    for (let i = 0; i < 66; i++) nested = { nested };
    deep.changes[0].updates.details.nested = nested;
    await rejectsUnchanged(db, deep);
    assert.equal(db.executed.length, 0);
});
