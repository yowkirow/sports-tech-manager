import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest, insertTransactions } from '../../worker/business-api.ts';
import { HttpError } from '../../worker/errors.ts';
import { normalizeDecimal, normalizeTimestamp } from '../../worker/order-store.ts';

const migrations = ['0001_business.sql', '0002_transaction_date_pattern.sql', '0003_business_api.sql']
    .map(name => readFileSync(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8'));
const productionMigration = readFileSync(new URL('../../worker/migrations/0005_production.sql', import.meta.url), 'utf8');
const DATE = '2026-09-10T01:02:03.123456789Z';
const ORDER = 'ST-BUSINESS01';
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const members = {
    owner: { id: 'owner', email: 'owner@example.invalid', role: 'owner' },
    reseller: { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' },
    other: { id: 'other', email: 'other@example.invalid', role: 'reseller' },
    printer: { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' }
};

// Local SQLite proves batch rollback and bind/query bounds; deployment still
// needs real D1 checks for query accounting, CPU and network unknown outcomes.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of Object.values(members)) {
            this.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)')
                .run(member.id, member.email, member.role);
        }
        this.executed = [];
        this.beforeMutation = null;
        this.hideResponse = false;
        t.after(() => this.sqlite.close());
    }

    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) {
                assert.ok(values.length <= 100, 'D1 bound parameters must stay within 100');
                for (const value of values) {
                    if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= 2_000_000);
                }
                this.values = values;
                return this;
            },
            async all() { return db.execute(this); }
        };
    }

    execute(statement) {
        this.executed.push(statement);
        const results = this.sqlite.prepare(statement.sql).all(...statement.values);
        return { success: true, results, meta: { changes: this.sqlite.prepare('SELECT changes() AS n').get().n } };
    }

    async batch(statements) {
        assert.ok(statements.length <= 50, 'Atomic batch must stay within the Free-plan query budget');
        const mutating = statements.some(statement => statement.sql.startsWith('INSERT INTO _business_guards'));
        const hook = mutating ? this.beforeMutation : null;
        if (hook) {
            this.beforeMutation = null;
            await hook();
        }
        this.sqlite.exec('BEGIN');
        let results;
        try {
            results = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
        if (mutating && this.hideResponse) results.at(-1).results = [];
        return results;
    }
}

function env(db) { return { DB: db, ENVIRONMENT: 'staging', PRINT_QUEUE_ENABLED: db.productionEnabled ? 'true' : 'false' }; }

async function call(db, role, path, method = 'GET', body) {
    const response = await handleBusinessRequest(new Request(`https://app.example.invalid${path}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), env(db), members[role] ?? role);
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
}

function error(code, status) {
    return actual => {
        assert.ok(actual instanceof HttpError, actual.stack);
        assert.equal(actual.code, code);
        if (status !== undefined) assert.equal(actual.status, status);
        return true;
    };
}

function transaction(number, patch = {}) {
    return {
        id: id(number), type: 'expense', category: 'Custom expense', amount: '701.001', date: DATE,
        description: null, details: { quantity: 1 }, ...patch
    };
}

function sale(number, patch = {}) {
    return transaction(number, {
        type: 'sale', category: 'shirts', amount: '400',
        details: { orderId: ORDER, itemName: 'Team Shirt', category: 'shirts', quantity: 1, status: 'pending' }, ...patch
    });
}

async function insert(db, rows, requestId = crypto.randomUUID(), role = 'owner') {
    return call(db, role, '/api/transactions', 'POST', { rows, requestId });
}

function seed(db, row) {
    db.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id)
        VALUES (?,?,?,?,?,?,?,?)`).run(row.id, row.type, row.category, row.amount, row.date,
        row.description, row.details === null ? null : JSON.stringify(row.details), row.order_id ?? null);
}

function state(db) {
    return Object.fromEntries([
        'transactions', 'orders', 'mutation_receipts', 'business_events', 'system_state',
        'transaction_tombstones', 'customers', 'activity_logs', 'member_profiles', '_business_guards'
    ].map(table => [table, db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function revision(db) { return db.sqlite.prepare('SELECT revision FROM system_state').get().revision; }

function enableProduction(db) {
    db.sqlite.exec(productionMigration);
    db.productionEnabled = true;
}

function productionJob(db, sourceId, itemIndex = -1, completed = true) {
    const line = db.sqlite.prepare(`SELECT * FROM production_order_shirt_lines
        WHERE source_id = ? AND item_index = ?`).get(sourceId, itemIndex);
    assert.ok(line);
    const jobId = `${sourceId}:${itemIndex}`;
    db.sqlite.prepare(`INSERT INTO production_jobs(id,job_code,source_id,item_index,legacy_item_key,
        order_id,source_fingerprint,snapshot_id,design_name,brand,color,size,required,accepted,assignee_id,status)
        VALUES (?,?,?,?,?,?,?,'snapshot','Team Shirt','Sypik','White','M',?,?,'printer',?)`)
        .run(jobId, jobId, sourceId, itemIndex, jobId, line.order_id, line.fingerprint,
            line.required, completed ? line.required : 0, completed ? 'completed' : 'released');
    return jobId;
}

function orderInput(rows, requestId, update) {
    return {
        packingConfirmed: true,
        orderId: rows[0].details.orderId,
        expectedVersion: rows[0].orderVersion,
        requestId,
        changes: rows.map(row => ({
            id: row.id,
            expected: Object.fromEntries(['type', 'category', 'date', 'description', 'details'].map(key => [key, row[key]])
                .concat([['amount', row.amountExact]])),
            updates: { amount: row.amountExact, details: { ...row.details, ...update } }
        }))
    };
}

test('import normalization exports preserve exact decimal strings and UTC nanoseconds', () => {
    assert.equal(normalizeDecimal('+009007199254740993.12345678900'), '9007199254740993.123456789');
    assert.equal(normalizeDecimal('-000.000'), '0');
    assert.equal(normalizeTimestamp('1970-01-01T08:00:00.000000001+08:00'), '1970-01-01T00:00:00.000000001Z');
    assert.equal(normalizeTimestamp('2026-09-10'), '2026-09-10T00:00:00Z');
});

test('migration preserves mixed business rows, epoch precision and legacy metadata without identities', t => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(migrations[0]);
    db.exec(migrations[1]);
    db.prepare(`INSERT INTO transactions(id,type,category,amount,date,details)
        VALUES (?,'legacy_custom_type','custom','9007199254740993.000000001',?,'{"nested":{"kept":true}}')`)
        .run(id(1), '1970-01-01T00:00:00.000000001Z');
    const before = db.prepare('SELECT * FROM transactions').all();
    db.exec(migrations[2]);
    assert.deepEqual(db.prepare('SELECT * FROM transactions').all(), before);
    assert.equal(db.prepare('SELECT count(*) AS n FROM members').get().n, 0);
    db.prepare(`INSERT INTO referrers(id,name,phone,voucher_code,target_reimbursement,metadata)
        VALUES (?,'Synthetic referrer','not a number','REF10','1500.001',?)`)
        .run(id(2), '{"unknownLegacyField":{"preserved":true}}');
    assert.equal(db.prepare('SELECT target_reimbursement FROM referrers').get().target_reimbursement, '1500.001');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const schema = db.prepare('SELECT sql FROM sqlite_master WHERE sql IS NOT NULL').all().map(row => row.sql).join('\n');
    for (const [, pattern] of schema.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/g)) {
        assert.ok(Buffer.byteLength(pattern.replaceAll("''", "'")) <= 50);
    }
});

test('owner history includes every event type; reseller history excludes other financial records and catalog costs', async t => {
    const db = new LocalD1(t);
    seed(db, transaction(1, { type: 'define_product', amount: '99', details: {
        name: 'Team Shirt', price: 600, category: 'shirts', unitCost: 99,
        supplier: 'private', createdBy: members.owner.email, nestedPrivate: { cost: 90 }
    }, description: 'Private supplier note' }));
    seed(db, transaction(2, { details: { createdBy: members.owner.email, supplier: 'private owner cost' } }));
    seed(db, transaction(3, { type: 'old_import_type', details: { createdBy: members.reseller.email, ownHistory: true } }));
    seed(db, sale(4, { details: { createdBy: members.other.email, customerName: 'Private buyer' } }));
    seed(db, transaction(5, { type: 'delete_product', details: { name: 'Old', secret: 'private' } }));
    seed(db, transaction(6, { type: 'voucher', details: { code: 'PRIVATE' } }));
    const owner = await call(db, 'owner', '/api/transactions');
    assert.equal(owner.count, 6);
    assert.equal(owner.rows.find(row => row.id === id(2)).amount, 701.001);
    assert.equal(owner.rows.find(row => row.id === id(2)).amountExact, '701.001');
    const reseller = await call(db, 'reseller', '/api/transactions');
    assert.deepEqual(reseller.rows.map(row => row.id).sort(), [id(1), id(3), id(5)]);
    const catalog = reseller.rows.find(row => row.id === id(1));
    assert.deepEqual(catalog.details, { name: 'Team Shirt', price: 600, category: 'shirts' });
    assert.equal(catalog.description, null);
    assert.equal(catalog.amountExact, '0');
    assert.doesNotMatch(JSON.stringify(reseller), /supplier|Private buyer|unitCost|nestedPrivate|PRIVATE/);
    await assert.rejects(call(db, 'printer', '/api/transactions'), error('forbidden', 403));
});

test('history pagination uses one revision and correctly orders fractional UTC timestamps', async t => {
    const db = new LocalD1(t);
    for (const [number, date] of [
        [1, '1970-01-01T00:00:00Z'], [2, '1970-01-01T00:00:00.1Z'],
        [3, '1970-01-01T00:00:00.000000001Z'], [4, '1970-01-01T00:00:01Z']
    ]) seed(db, transaction(number, { date }));
    const first = await call(db, 'owner', '/api/transactions?limit=2');
    assert.deepEqual(first.rows.map(row => row.id), [id(4), id(2)]);
    const last = await call(db, 'owner', `/api/transactions?limit=2&offset=2&revision=${first.revision}`);
    assert.deepEqual(last.rows.map(row => row.id), [id(3), id(1)]);
    assert.equal(first.count, 4);
    seed(db, transaction(5));
    await assert.rejects(call(db, 'owner', `/api/transactions?offset=2&revision=${first.revision}`), error('history_changed', 409));
    for (const query of ['limit=1001', 'limit=0', 'offset=-1', 'revision=1.2', 'offset=9007199254740992']) {
        await assert.rejects(call(db, 'owner', `/api/transactions?${query}`), error('validation_error', 400));
    }
});

test('all supported owner lifecycle events insert atomically with exact values and actor attribution', async t => {
    const db = new LocalD1(t);
    const types = ['expense', 'sale', 'define_product', 'delete_product', 'define_brand', 'delete_brand',
        'define_color', 'delete_color', 'voucher', 'update_stock', 'club_income'];
    const rows = types.map((type, index) => transaction(index + 1, {
        type, amount: type === 'sale' ? '9007199254740993.123456789' : '+0001.00100',
        date: '1970-01-01T08:00:00.123456789+08:00',
        details: { createdBy: 'forged@example.invalid', userRole: 'owner', ...(type === 'sale' ? { orderId: ORDER } : { name: type }) }
    }));
    const saved = await insert(db, rows, 'all-events');
    assert.equal(saved.rows.length, types.length);
    assert.equal(saved.rows[1].amountExact, '9007199254740993.123456789');
    assert.equal(saved.rows[1].orderVersion, 0);
    assert.equal(saved.rows[1].details.orderId, ORDER);
    assert.ok(saved.rows.every(row => row.details.createdBy === members.owner.email));
    assert.ok(saved.rows.every(row => row.date === '1970-01-01T00:00:00.123456789Z'));
    assert.equal(revision(db), rows.length);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM business_events').get().n, 1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM _business_guards').get().n, 0);
    const before = state(db);
    assert.deepEqual(await insert(db, rows, 'all-events'), saved);
    assert.deepEqual(state(db), before);
    await assert.rejects(insert(db, [transaction(90)], 'all-events'), error('idempotency_conflict', 409));
    assert.deepEqual(state(db), before);
});

test('server generated IDs are stable on receipt replay and source IDs cannot be duplicated', async t => {
    const db = new LocalD1(t);
    const row = transaction(1);
    delete row.id;
    const saved = await insert(db, [row], 'generate-id');
    assert.match(saved.rows[0].id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await insert(db, [row], 'generate-id'), saved);
    const before = state(db);
    await assert.rejects(insert(db, [{ ...row, id: saved.rows[0].id }]), error('transaction_conflict', 409));
    assert.deepEqual(state(db), before);
});

for (const mutation of [
    row => { row.order_id = ORDER; },
    row => { row.sql = 'DROP TABLE transactions'; },
    row => { row.id = 'synthetic-item-1'; },
    row => { row.type = 'arbitrary_type'; },
    row => { row.date = '2026-02-30T00:00:00Z'; },
    row => { row.date = '2026-09-10T00:00:00'; },
    row => { row.amount = '1e8'; },
    row => { row.amount = Number.MAX_SAFE_INTEGER + 1; },
    row => { row.details = ['not', 'an', 'object']; }
]) {
    test(`insert rejects unsupported or invalid input: ${mutation}`, async t => {
        const db = new LocalD1(t);
        const row = transaction(1);
        mutation(row);
        const before = state(db);
        await assert.rejects(insert(db, [row]), actual => actual instanceof HttpError && actual.status === 400);
        assert.deepEqual(state(db), before);
    });
}

test('large insert batches use bounded JSON bindings and fewer than 50 total statements', async t => {
    const db = new LocalD1(t);
    const rows = Array.from({ length: 200 }, (_, index) => transaction(index + 1));
    assert.equal((await insert(db, rows)).rows.length, rows.length);
    assert.ok(db.executed.length <= 50);
    assert.ok(Math.max(...db.executed.map(statement => statement.values.length)) <= 100);
});

test('late failures and silently skipped writes roll back rows, order identities, audit, receipts and revision', async t => {
    for (const trigger of [
        `CREATE TRIGGER fail_late BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT, 'late receipt failure'); END`,
        `CREATE TRIGGER fail_late BEFORE INSERT ON transactions WHEN NEW.id = '${id(2)}' BEGIN SELECT RAISE(IGNORE); END`,
        `CREATE TRIGGER fail_late BEFORE INSERT ON business_events BEGIN SELECT RAISE(IGNORE); END`,
        `CREATE TRIGGER fail_late BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(IGNORE); END`
    ]) {
        const db = new LocalD1(t);
        db.sqlite.exec(trigger);
        const before = state(db);
        await assert.rejects(insert(db, [sale(1), sale(2)]));
        assert.deepEqual(state(db), before);
    }
});

for (const update of ["active = 0", "role = 'reseller'", "email = 'changed@example.invalid'"]) {
    test(`write atomically rechecks membership after preflight: ${update}`, async t => {
        const db = new LocalD1(t);
        db.beforeMutation = () => db.sqlite.exec(`UPDATE members SET ${update} WHERE id = 'owner'`);
        await assert.rejects(insert(db, [transaction(1)]), error('forbidden', 403));
        assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
        assert.equal(revision(db), 0);
    });
}

test('receipt replay also rechecks live authorization and lost-response retry confirms one commit', async t => {
    const db = new LocalD1(t);
    db.hideResponse = true;
    await assert.rejects(insert(db, [transaction(1)], 'lost-response'), /could not be confirmed/);
    assert.equal(revision(db), 1);
    db.hideResponse = false;
    assert.equal((await insert(db, [transaction(1)], 'lost-response')).rows.length, 1);
    assert.equal(revision(db), 1);
    db.sqlite.exec("UPDATE members SET active = 0 WHERE id = 'owner'");
    await assert.rejects(insert(db, [transaction(1)], 'lost-response'), error('forbidden', 403));
});

function product(db, number = 1, patch = {}) {
    seed(db, transaction(number, { type: 'define_product', amount: '0', date: '2026-09-01T00:00:00Z',
        details: { name: 'Team Shirt', price: 600, category: 'shirts', brand: 'Sypik', linkedColor: 'White', ...patch } }));
}

function resellerSale(number = 10, patch = {}) {
    return sale(number, { details: {
        orderId: ORDER, itemName: 'Team Shirt', quantity: 1, source: 'pos', category: 'shirts',
        brand: 'Sypik', color: 'White', size: 'M', customerName: 'Synthetic buyer',
        createdBy: 'forged@example.invalid', userRole: 'owner', unitPrice: 400, originalAmount: 400,
        shippingShare: 0, discountShare: 0, paymentStatus: 'unpaid', fulfillmentStatus: 'pending', status: 'pending',
        ...patch
    } });
}

test('reseller checkout validates current catalog, server prices, flat shape and verified ownership', async t => {
    const db = new LocalD1(t);
    product(db);
    const row = resellerSale();
    const saved = await insert(db, [row], 'reseller-checkout', 'reseller');
    assert.equal(saved.rows[0].details.createdBy, members.reseller.email);
    assert.equal(saved.rows[0].details.userRole, 'reseller');
    assert.equal(saved.rows[0].details.paymentStatus, 'unpaid');
    assert.equal(saved.rows[0].amountExact, '400');
    assert.equal(saved.rows[0].orderVersion, 0);
    seed(db, transaction(99, { type: 'delete_product', details: { name: 'Team Shirt' } }));
    assert.deepEqual(await insert(db, [row], 'reseller-checkout', 'reseller'), saved);
    assert.equal((await call(db, 'other', '/api/transactions')).rows.some(value => value.type === 'sale'), false);
});

test('reseller ball tier pricing mirrors POS quantity tiers without trusting submitted retail prices', async t => {
    const db = new LocalD1(t);
    product(db, 1, { name: 'Pickleball', category: 'balls', linkedColor: '', price: 500 });
    const row = resellerSale(10, { itemName: 'Pickleball', category: 'balls', color: '',
        quantity: 21, unitPrice: 90, originalAmount: 1890 });
    row.category = 'balls';
    row.amount = '1890';
    assert.equal((await insert(db, [row], 'balls', 'reseller')).rows[0].amount, 1890);
});

for (const [label, patch, status] of [
    ['paid', { paymentStatus: 'paid' }, 403],
    ['released', { status: 'shipped' }, 403],
    ['arbitrary source', { source: 'owner' }, 400],
    ['spoofed inventory brand', { brand: 'Different brand' }, 400],
    ['spoofed color', { color: 'Black' }, 400],
    ['nested order', { items: [{ id: 'injected' }] }, 400],
    ['discount', { discountShare: 399 }, 400],
    ['discount metadata', { pricing: { discount: { type: 'percent', value: 100 } } }, 400],
    ['shipping fee', { shippingDetails: { shippingFee: 100 } }, 400],
    ['removed line', { removedFromOrder: true }, 400],
    ['arbitrary stock quantity', { quantity: -1 }, 400],
    ['injected product field', { supplierCost: 100 }, 400]
]) {
    test(`reseller checkout denies ${label}`, async t => {
        const db = new LocalD1(t);
        product(db);
        const before = state(db);
        await assert.rejects(insert(db, [resellerSale(10, patch)], label, 'reseller'),
            actual => actual instanceof HttpError && actual.status === status);
        assert.deepEqual(state(db), before);
    });
}

test('reseller catalog changes after validation conflict inside the atomic write', async t => {
    const db = new LocalD1(t);
    product(db);
    db.beforeMutation = () => seed(db, transaction(99, { type: 'delete_product', details: { name: 'Team Shirt' } }));
    await assert.rejects(insert(db, [resellerSale()], 'catalog-race', 'reseller'), error('transaction_conflict', 409));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM transactions WHERE type = 'sale'").get().n, 0);
    await assert.rejects(insert(db, [transaction(40)], 'reseller-expense', 'reseller'), error('forbidden', 403));
    await assert.rejects(insert(db, [sale(40)], 'printer-sale', 'printer'), error('forbidden', 403));
});

test('owner single-row sales adjustment preserves source details and increments its order version', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1), sale(2)]);
    const input = { expected: saved.rows[0], requestId: 'single-adjustment',
        updates: { amount: '401.001', date: '1970-01-01T08:00:00.000000001+08:00', description: 'Adjustment' } };
    const result = await call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', input);
    assert.equal(result.row.amountExact, '401.001');
    assert.equal(result.row.date, '1970-01-01T00:00:00.000000001Z');
    assert.equal(result.row.orderVersion, 1);
    assert.deepEqual(result.row.details, saved.rows[0].details);
    assert.equal((await call(db, 'owner', '/api/transactions')).rows.find(row => row.id === id(2)).orderVersion, 1);
    const before = state(db);
    assert.deepEqual(await call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', input), result);
    assert.deepEqual(state(db), before);
    await assert.rejects(call(db, 'owner', `/api/transactions/${id(2)}`, 'PATCH', {
        expected: saved.rows[1], requestId: 'stale-other-line', updates: { amount: 800 }
    }), error('transaction_conflict', 409));
    assert.deepEqual(state(db), before);
});

test('snapshot changes, partial snapshots and order-save bypasses are rejected', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1)]);
    const original = saved.rows[0];
    for (const expected of [
        { ...original, amountExact: '401', amount: 401 },
        { ...original, details: { ...original.details, quantity: 2 } },
        { ...original, date: '2026-09-10T01:02:03Z' }
    ]) {
        await assert.rejects(call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
            expected, updates: { amount: 600 }, requestId: crypto.randomUUID()
        }), error('transaction_conflict', 409));
    }
    for (const input of [
        { expected: { amount: 400 }, updates: { amount: 600 } },
        { expected: { ...original, orderVersion: undefined }, updates: { amount: 600 } },
        { expected: original, updates: { details: { ...original.details, orderId: 'ST-OTHER' } } },
        { expected: original, updates: { type: 'expense' } },
        { expected: original, updates: { category: 'other' } }
    ]) {
        await assert.rejects(call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
            ...input, requestId: crypto.randomUUID()
        }), error('validation_error', 400));
    }
    await assert.rejects(call(db, 'reseller', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: original, updates: { amount: 600 }, requestId: 'reseller-patch'
    }), error('forbidden', 403));
});

test('concurrent other-source changes and deletion prevent a stale sales adjustment', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1), sale(2)]);
    db.beforeMutation = () => db.sqlite.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run('999', id(2));
    await assert.rejects(call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved.rows[0], updates: { amount: 600 }, requestId: 'other-line-race'
    }), error('transaction_conflict', 409));
    assert.equal(db.sqlite.prepare('SELECT amount FROM transactions WHERE id = ?').get(id(1)).amount, '400');
    db.beforeMutation = () => db.sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id(1));
    await assert.rejects(call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved.rows[0], updates: { amount: 600 }, requestId: 'deletion-race'
    }), error('transaction_conflict', 409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transactions WHERE id = ?').get(id(1)).n, 0);
});

test('owner expense updates use full snapshots and preserve creator attribution', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [transaction(1)]);
    const result = await call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved.rows[0], requestId: 'expense-patch',
        updates: { category: 'Travel', details: { quantity: 5, createdBy: members.reseller.email, userRole: 'reseller' } }
    });
    assert.equal(result.row.category, 'Travel');
    assert.equal(result.row.details.createdBy, members.owner.email);
    assert.equal(result.row.details.userRole, 'owner');
});

test('deletion retains audit/receipts and tombstones prevent ID recreation', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1)]);
    const input = { expected: saved.rows[0], requestId: 'delete-source' };
    assert.deepEqual(await call(db, 'owner', `/api/transactions/${id(1)}`, 'DELETE', input), { id: id(1) });
    assert.equal(db.sqlite.prepare('SELECT version FROM orders WHERE id = ?').get(ORDER).version, 1);
    const before = state(db);
    assert.deepEqual(await call(db, 'owner', `/api/transactions/${id(1)}`, 'DELETE', input), { id: id(1) });
    assert.deepEqual(state(db), before);
    await assert.rejects(insert(db, [transaction(1)]), error('transaction_conflict', 409));
    await assert.rejects(call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved.rows[0], updates: { amount: 50 }, requestId: 'recreate'
    }), error('transaction_conflict', 409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM business_events').get().n, 2);
    assert.throws(() => db.sqlite.exec('DELETE FROM business_events'), /append only/);
    assert.throws(() => db.sqlite.exec("UPDATE business_events SET action = 'tampered'"), /append only/);
});

test('reset requires the explicit phrase and active owner, and keeps audit identities', async t => {
    const db = new LocalD1(t);
    await insert(db, [sale(1), transaction(2)]);
    await assert.rejects(call(db, 'owner', '/api/transactions', 'DELETE', { confirmation: 'yes', requestId: 'reset' }),
        error('validation_error', 400));
    await assert.rejects(call(db, 'reseller', '/api/transactions', 'DELETE', { confirmation: 'DELETE ALL', requestId: 'reset' }),
        error('forbidden', 403));
    const beforeRevision = revision(db);
    const body = { confirmation: 'DELETE ALL', requestId: 'reset' };
    assert.deepEqual(await call(db, 'owner', '/api/transactions', 'DELETE', body), { ok: true });
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transaction_tombstones').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM mutation_receipts').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM business_events').get().n, 2);
    assert.ok(revision(db) > beforeRevision);
    const before = state(db);
    await call(db, 'owner', '/api/transactions', 'DELETE', body);
    assert.deepEqual(state(db), before);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('existing production jobs block transaction reset without blocking financial source adjustments', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1)]);
    enableProduction(db);
    productionJob(db, id(1), -1, false);
    const adjusted = await call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: saved.rows[0], requestId: 'adjust-released', updates: { amount: '401.001' }
    });
    assert.equal(adjusted.row.amountExact, '401.001');
    assert.equal(db.sqlite.prepare('SELECT status FROM production_jobs').get().status, 'released');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM production_events').get().n, 0);
    const before = state(db);
    await assert.rejects(call(db, 'owner', '/api/transactions', 'DELETE', {
        confirmation: 'DELETE ALL', requestId: 'reset'
    }), error('production_locked', 409));
    assert.deepEqual(state(db), before);
    await call(db, 'owner', `/api/transactions/${id(1)}`, 'DELETE', {
        expected: adjusted.row, requestId: 'delete-released'
    });
    assert.equal(db.sqlite.prepare('SELECT status FROM production_jobs').get().status, 'held');
    assert.equal(db.sqlite.prepare('SELECT source_changed FROM production_jobs').get().source_changed, 1);
    assert.equal(db.sqlite.prepare('SELECT action FROM production_events').get().action, 'source_deleted');
});

test('Ready requires current completed QA for every flat source with the same 14-statement primitive', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1), sale(2)]);
    enableProduction(db);
    const input = orderInput(saved.rows, 'ready-order', { fulfillmentStatus: 'ready' });
    const before = state(db);
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('ORDER_CONFLICT', 409));
    assert.deepEqual(state(db), before);
    productionJob(db, id(1));
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('ORDER_CONFLICT', 409));
    productionJob(db, id(2), -1, false);
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('ORDER_CONFLICT', 409));
    db.sqlite.exec("UPDATE production_jobs SET accepted = required, status = 'completed'");
    const start = db.executed.length;
    assert.deepEqual(await call(db, 'owner', '/api/orders/save', 'POST', input), {
        orderId: ORDER, version: 1, ids: [id(1), id(2)]
    });
    assert.equal(db.executed.length - start, 14);
    const after = state(db);
    await call(db, 'owner', '/api/orders/save', 'POST', input);
    assert.deepEqual(state(db), after);
});

test('Ready requires explicit owner packing confirmation even after print QA is complete', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1)]);
    enableProduction(db);
    productionJob(db, id(1));
    const input = orderInput(saved.rows, 'packing-ready', { fulfillmentStatus: 'ready' });
    input.packingConfirmed = false;
    const before = state(db);
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('PACKING_CONFIRMATION_REQUIRED', 400));
    assert.deepEqual(state(db), before);
    input.packingConfirmed = true;
    await call(db, 'owner', '/api/orders/save', 'POST', input);
});

test('migration retains source customer notes and referrer administrator attribution', async t => {
    const db = new LocalD1(t);
    assert.ok(db.sqlite.prepare('PRAGMA table_info(customers)').all().some(column => column.name === 'notes'));
    assert.ok(db.sqlite.prepare('PRAGMA table_info(referrers)').all().some(column => column.name === 'admin_email'));
});
test('Ready rejects missing nested variants, stale fingerprints and same-write physical changes', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1, { details: { orderId: ORDER, items: [
        { name: 'Shirt A', category: 'shirts', size: 'M', quantity: 1 },
        { details: { name: 'Shirt B', category: 'blanks', size: 'L', quantity: 2 } }
    ] } })]);
    enableProduction(db);
    const input = orderInput(saved.rows, 'nested-ready', { fulfillmentStatus: 'ready' });
    productionJob(db, id(1), 0);
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('ORDER_CONFLICT', 409));
    productionJob(db, id(1), 1);
    db.sqlite.exec("UPDATE production_jobs SET source_fingerprint = 'stale' WHERE item_index = 1");
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', input), error('ORDER_CONFLICT', 409));
    db.sqlite.exec(`UPDATE production_jobs SET source_fingerprint =
        (SELECT fingerprint FROM production_source_state WHERE source_id = production_jobs.source_id)`);
    const changed = structuredClone(input);
    changed.changes[0].updates.details.items[0].quantity = 3;
    const jobs = db.sqlite.prepare('SELECT * FROM production_jobs').all();
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', changed), error('ORDER_CONFLICT', 409));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM production_jobs').all(), jobs);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM production_events').get().n, 0);
    await call(db, 'owner', '/api/orders/save', 'POST', input);
});

test('history paging is CPU-bounded and cheap revision checks remain role-protected', async t => {
    const db = new LocalD1(t);
    await insert(db, Array.from({ length: 150 }, (_, index) => sale(index + 1)));
    const page = await call(db, 'owner', '/api/transactions?limit=1000');
    assert.equal(page.rows.length, 100);
    assert.equal(page.count, 150);
    const next = await call(db, 'owner', `/api/transactions?offset=100&limit=1000&revision=${page.revision}`);
    assert.equal(next.rows.length, 50);
    assert.equal((await call(db, 'owner', '/api/transactions/revision')).revision, page.revision);
    await assert.rejects(call(db, 'printer', '/api/transactions/revision'), error('forbidden', 403));
});
test('physical edits hold production jobs atomically while comments/payment/return tags do not', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1)]);
    enableProduction(db);
    productionJob(db, id(1), -1, false);
    await call(db, 'owner', '/api/orders/save', 'POST', orderInput(saved.rows, 'metadata', {
        paymentStatus: 'paid', comments: [{ text: 'Private note' }], returned: true
    }));
    assert.equal(db.sqlite.prepare('SELECT status FROM production_jobs').get().status, 'released');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM production_events').get().n, 0);
    const current = await call(db, 'owner', '/api/transactions');
    const physical = orderInput(current.rows, 'physical', { size: 'XL' });
    db.sqlite.exec("CREATE TRIGGER fail_physical_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT, 'late physical failure'); END");
    const before = state(db);
    const jobs = db.sqlite.prepare('SELECT * FROM production_jobs').all();
    await assert.rejects(call(db, 'owner', '/api/orders/save', 'POST', physical), /late physical failure/);
    assert.deepEqual(state(db), before);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM production_jobs').all(), jobs);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM production_events').get().n, 0);
    db.sqlite.exec('DROP TRIGGER fail_physical_receipt');
    await call(db, 'owner', '/api/orders/save', 'POST', physical);
    assert.equal(db.sqlite.prepare('SELECT status FROM production_jobs').get().status, 'held');
    assert.equal(db.sqlite.prepare('SELECT source_changed FROM production_jobs').get().source_changed, 1);
});

test('whole-order deletion is atomic across lines, versioned, and safely replayed', async t => {
    const db = new LocalD1(t);
    const inserted = await insert(db, [sale(1), sale(2)]);
    const body = { expectedVersion: 0, requestId: 'delete-whole-order', sourceIds: inserted.rows.map(row => row.id) };
    const before = state(db);
    await assert.rejects(call(db, 'reseller', `/api/orders/${ORDER}`, 'DELETE', body), error('forbidden', 403));
    await assert.rejects(call(db, 'owner', `/api/orders/${ORDER}`, 'DELETE', { ...body, sourceIds: [id(1)] }),
        error('transaction_conflict', 409));
    assert.deepEqual(state(db), before);
    db.sqlite.exec("CREATE TRIGGER fail_delete_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT,'late order deletion failure'); END");
    await assert.rejects(call(db, 'owner', `/api/orders/${ORDER}`, 'DELETE', body), /late order deletion failure/);
    assert.deepEqual(state(db), before);
    db.sqlite.exec('DROP TRIGGER fail_delete_receipt');
    const deleted = await call(db, 'owner', `/api/orders/${ORDER}`, 'DELETE', body);
    assert.equal(deleted.orderId, ORDER);
    assert.deepEqual(deleted.ids, [id(1), id(2)]);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT version FROM orders WHERE id=?').get(ORDER).version, 1);
    assert.deepEqual(await call(db, 'owner', `/api/orders/${ORDER}`, 'DELETE', body), deleted);
});
test('historical Ready orders retain financial and comment editing without retroactive job requirements', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1, {
        details: { orderId: ORDER, category: 'shirts', fulfillmentStatus: 'ready', quantity: 1 }
    })]);
    enableProduction(db);
    await call(db, 'owner', '/api/orders/save', 'POST', orderInput(saved.rows, 'legacy-ready-metadata', {
        paymentStatus: 'paid', comments: [{ text: 'Historical order note' }], returned: true
    }));
    const current = await call(db, 'owner', '/api/transactions');
    const result = await call(db, 'owner', `/api/transactions/${id(1)}`, 'PATCH', {
        expected: current.rows[0], requestId: 'legacy-financial', updates: { amount: '501.001' }
    });
    assert.equal(result.row.amountExact, '501.001');
    assert.equal(result.row.details.fulfillmentStatus, 'ready');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM production_jobs').get().n, 0);
});

test('owner inserts cannot bypass production Ready coverage, while non-shirt orders remain valid', async t => {
    const db = new LocalD1(t);
    enableProduction(db);
    const before = state(db);
    await assert.rejects(insert(db, [sale(1, { details: { orderId: ORDER, fulfillmentStatus: 'ready', category: 'shirts' } })]),
        error('production_locked', 409));
    assert.deepEqual(state(db), before);
    const saved = await insert(db, [sale(2, { category: 'balls',
        details: { orderId: ORDER, fulfillmentStatus: 'ready', category: 'balls', quantity: 1 } })]);
    assert.equal(saved.rows[0].details.fulfillmentStatus, 'ready');
});

test('order-save delegates the complete primitive and transaction triggers advance feed revision', async t => {
    const db = new LocalD1(t);
    const saved = await insert(db, [sale(1), sale(2)]);
    const before = revision(db);
    const input = {
        orderId: ORDER, expectedVersion: 0, requestId: 'save-order',
        changes: saved.rows.map(row => ({
            id: row.id,
            expected: Object.fromEntries(['type', 'category', 'date', 'description', 'details'].map(key => [key, row[key]])
                .concat([['amount', row.amountExact]])),
            updates: { amount: '499.001', details: { ...row.details, quantity: 2 } }
        }))
    };
    const start = db.executed.length;
    assert.deepEqual(await call(db, 'owner', '/api/orders/save', 'POST', input), {
        orderId: ORDER, version: 1, ids: [id(1), id(2)]
    });
    assert.equal(db.executed.length - start, 14);
    assert.equal(revision(db), before + 2);
    await call(db, 'owner', '/api/orders/save', 'POST', input);
    assert.equal(revision(db), before + 2);
    await assert.rejects(call(db, 'reseller', '/api/orders/save', 'POST', input), error('forbidden', 403));
});

test('customer upsert increments exact decimal totals idempotently without leaking global data to resellers', async t => {
    const db = new LocalD1(t);
    const body = { details: { name: 'Same Name', contact_number: 'Private owner phone', address: 'Private owner address',
        total_spent: '9007199254740993.123456789' }, requestId: 'customer-first' };
    const first = await call(db, 'owner', '/api/customers', 'POST', body);
    const increment = { details: { name: 'Same Name', total_spent: '0.000000001' }, requestId: 'customer-increment' };
    const second = await call(db, 'owner', '/api/customers', 'POST', increment);
    assert.equal(second.customer.id, first.customer.id);
    assert.equal(second.customer.total_spentExact, '9007199254740993.12345679');
    assert.equal(second.customer.contact_number, 'Private owner phone');
    assert.deepEqual(await call(db, 'owner', '/api/customers', 'POST', increment), second);
    assert.deepEqual(await call(db, 'reseller', '/api/customers?q=Same'), { customers: [] });
    const reseller = await call(db, 'reseller', '/api/customers', 'POST', {
        details: { name: 'Same Name', contact_number: 'Reseller phone', total_spent: '400.01' }, requestId: 'reseller-customer'
    });
    assert.notEqual(reseller.customer.id, first.customer.id);
    assert.equal(reseller.customer.contact_number, 'Reseller phone');
    assert.equal(reseller.customer.address, null);
    assert.equal(Object.hasOwn(reseller.customer, 'total_spent'), false);
    assert.equal(Object.hasOwn(reseller.customer, 'total_spentExact'), false);
    const search = await call(db, 'reseller', '/api/customers?q=sAmE');
    assert.deepEqual(search.customers, [reseller.customer]);
    assert.doesNotMatch(JSON.stringify(search), /Private owner|900719925/);
    assert.deepEqual(await call(db, 'other', '/api/customers?q=Same'), { customers: [] });
    assert.deepEqual(await call(db, 'owner', '/api/customers?q=%'), { customers: [] });
    await assert.rejects(call(db, 'printer', '/api/customers?q=Same'), error('forbidden', 403));
});

test('customer concurrent increments conflict rather than lose money, and late receipt failure rolls back', async t => {
    const db = new LocalD1(t);
    const first = await call(db, 'owner', '/api/customers', 'POST', { details: { name: 'Buyer', total_spent: '0.1' }, requestId: 'first' });
    db.beforeMutation = () => db.sqlite.prepare('UPDATE customers SET total_spent = ? WHERE id = ?').run('0.3', first.customer.id);
    await assert.rejects(call(db, 'owner', '/api/customers', 'POST', {
        details: { name: 'Buyer', total_spent: '0.2' }, requestId: 'racing'
    }), error('transaction_conflict', 409));
    assert.equal(db.sqlite.prepare('SELECT total_spent FROM customers').get().total_spent, '0.3');
    db.sqlite.exec("CREATE TRIGGER fail_customer_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT, 'late failure'); END");
    const before = state(db);
    await assert.rejects(call(db, 'owner', '/api/customers', 'POST', {
        details: { name: 'Buyer', total_spent: '0.4' }, requestId: 'late'
    }), /late failure/);
    assert.deepEqual(state(db), before);
});

test('profile supports only scoped display/preferences fields, never credentials, roles or PINs', async t => {
    const db = new LocalD1(t);
    assert.deepEqual(await call(db, 'owner', '/api/profile'), { profile: {} });
    const patch = { full_name: 'Synthetic Owner', expense_categories: ['Travel', 'Shirts'],
        enable_sms_notifications: true, tracking_sms_template: 'Hi {customerName}: {trackingLink}' };
    assert.deepEqual(await call(db, 'owner', '/api/profile', 'PATCH', patch), { profile: patch });
    assert.deepEqual(await call(db, 'owner', '/api/profile'), { profile: patch });
    assert.deepEqual(await call(db, 'reseller', '/api/profile'), { profile: {} });
    for (const field of ['role', 'pin', 'email', 'textbee_api_key', 'textbee_device_id', 'member_id']) {
        await assert.rejects(call(db, 'owner', '/api/profile', 'PATCH', { [field]: 'not accepted' }), error('validation_error', 400));
    }
    db.sqlite.prepare("UPDATE member_profiles SET profile = json_set(profile, '$.textbee_api_key', 'old private key')").run();
    assert.doesNotMatch(JSON.stringify(await call(db, 'owner', '/api/profile')), /old private key|textbee_api_key/);
    db.beforeMutation = () => db.sqlite.exec("UPDATE members SET active = 0 WHERE id = 'owner'");
    await assert.rejects(call(db, 'owner', '/api/profile', 'PATCH', { full_name: 'Not saved' }), error('forbidden', 403));
    assert.notEqual(JSON.parse(db.sqlite.prepare('SELECT profile FROM member_profiles').get().profile).full_name, 'Not saved');
});

test('activity attribution is verified, read is owner-only, and member directory omits access identity', async t => {
    const db = new LocalD1(t);
    const result = await call(db, 'reseller', '/api/activity', 'POST', {
        action: 'POS Checkout', details: { itemCount: 2 }, entityId: ORDER
    });
    assert.match(result.id, /^[a-f0-9-]{36}$/);
    const logs = await call(db, 'owner', '/api/activity?offset=0&limit=5');
    assert.equal(logs.logs[0].user_email, members.reseller.email);
    assert.equal(logs.logs[0].entity_id, ORDER);
    assert.deepEqual(JSON.parse(logs.logs[0].details), { itemCount: 2 });
    await assert.rejects(call(db, 'reseller', '/api/activity'), error('forbidden', 403));
    await assert.rejects(call(db, 'owner', '/api/activity', 'POST', {
        action: 'forged', user_email: 'forged@example.invalid'
    }), error('validation_error', 400));
    await call(db, 'owner', '/api/profile', 'PATCH', { full_name: 'Synthetic Owner' });
    db.sqlite.exec("UPDATE members SET access_subject = 'private-access-subject' WHERE id = 'owner'");
    const directory = await call(db, 'owner', '/api/members');
    const owner = directory.members.find(member => member.id === 'owner');
    assert.deepEqual(owner, { ...members.owner, name: 'Synthetic Owner', active: true });
    assert.doesNotMatch(JSON.stringify(directory), /private-access-subject|access_subject/);
    await assert.rejects(call(db, 'reseller', '/api/members'), error('forbidden', 403));
});

test('member directory includes employee names from the shared profile schema and rejects non-text names', async t => {
    const db = new LocalD1(t);
    assert.equal((await call(db, 'owner', '/api/members')).members.find(member => member.id === 'printer').name, '');
    enableProduction(db);
    db.sqlite.prepare('INSERT INTO member_profiles(member_id,profile) VALUES (?,?)')
        .run('printer', '{"full_name":"Synthetic Printer"}');
    const enabled = await call(db, 'owner', '/api/members');
    assert.equal(enabled.members.find(member => member.id === 'printer').name, 'Synthetic Printer');
    db.productionEnabled = false;
    assert.equal((await call(db, 'owner', '/api/members')).members.find(member => member.id === 'printer').name, 'Synthetic Printer');
    db.sqlite.exec(`UPDATE member_profiles SET profile = '{"full_name":{"private":"not a name"}}' WHERE member_id = 'printer'`);
    assert.equal((await call(db, 'owner', '/api/members')).members.find(member => member.id === 'printer').name, '');
});

test('HTTP boundaries reject oversized/invalid input and unmatched paths return null', async t => {
    const db = new LocalD1(t);
    const response = await handleBusinessRequest(new Request('https://app.example.invalid/api/unhandled'), env(db), members.owner);
    assert.equal(response, null);
    const memberPost = await handleBusinessRequest(new Request('https://app.example.invalid/api/members', { method: 'POST' }), env(db), members.owner);
    assert.equal(memberPost, null);
    await assert.rejects(handleBusinessRequest(new Request('https://app.example.invalid/api/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad'
    }), env(db), members.owner), error('invalid_json', 400));
    await assert.rejects(insert(db, [transaction(1, { description: 'x'.repeat(1024 * 1024) })]),
        error('payload_too_large', 413));
    await assert.rejects(insertTransactions(db, members.owner, [transaction(1, { details: { cycle: undefined } })], 'bad-json'));
    assert.equal(revision(db), 0);
});
