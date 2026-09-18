import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { authorizedGuestOrder, handlePublicRequest, normalizeContact } from '../../worker/public-api.ts';
import { buildPublicCatalog } from '../../src/lib/publicCatalog.js';

const migrationDirectory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'));
const uid = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const DATE = '2026-09-01T00:00:00.000Z';

// Executes the emitted SQL, including constraints and rollback, against SQLite.
// It does not simulate Cloudflare CPU budgets or remote D1 transport.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        migrations.forEach(sql => this.sqlite.exec(sql));
        this.beforeBatch = null;
        this.loseCheckoutResponse = false;
        this.catalogSnapshots = [];
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { assert.ok(values.length <= 100); this.values = values; return this; },
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
        if (statement.sql.includes('/* public_catalog_snapshot */')) this.catalogSnapshots.push(results);
        return { success: true, results, meta: { changes: this.sqlite.prepare('SELECT changes() AS n').get().n } };
    }
    async batch(statements) {
        if (this.beforeBatch) await this.beforeBatch(statements);
        this.sqlite.exec('BEGIN');
        let result;
        try {
            result = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
        if (this.loseCheckoutResponse && statements.some(statement => statement.sql.includes('INSERT INTO guest_checkout_receipts'))) {
            this.loseCheckoutResponse = false;
            throw new Error('Synthetic lost response after commit');
        }
        return result;
    }
}
function fixture(t) {
    const DB = new LocalD1(t);
    const objects = new Map();
    const MEDIA = {
        async put(key, bytes, options) { objects.set(key, { bytes, options }); },
        async delete(key) { objects.delete(key); },
        async get(key) { const item = objects.get(key); return item ? { body: item.bytes, size: item.bytes.length } : null; }
    };
    const env = { DB, MEDIA, GUEST_TOKEN_SECRET: 'synthetic-test-secret-not-a-real-key-123456', ENVIRONMENT: 'staging', ACCESS_TEAM_DOMAIN: '', ACCESS_AUDIENCE: '' };
    insert(env, uid(1), 'define_product', { name: 'Team Shirt', price: 350, linkedColor: 'Black', category: 'shirts', cost: 17, customerName: 'MUST NOT LEAK' });
    insert(env, uid(2), 'define_product', { name: 'Practice Ball', price: 100, category: 'balls' });
    insert(env, uid(3), 'update_stock', { name: 'Practice Ball', quantity: 500, category: 'balls' });
    insert(env, uid(4), 'voucher', { code: 'SAVE', active: true, discountType: 'percent', value: 10, usageLimit: 1, referrerPhone: 'SECRET' });
    return { env, objects };
}
function insert(env, id, type, details, amount = '0', category = details.category || 'general', orderId = null) {
    env.DB.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id)
        VALUES (?,?,?,?,?,'synthetic',?,?)`).run(id, type, category, amount, DATE, JSON.stringify(details), orderId);
}
function intent(overrides = {}) {
    return {
        requestId: crypto.randomUUID(),
        items: [{ productId: uid(1), name: 'Team Shirt', size: 'M', quantity: 2 }],
        customerName: 'Synthetic Customer', contactNumber: '(0917) 123-4567',
        shippingDetails: { address: 'Test street', city: 'Test city', province: 'Metro Manila', barangay: 'Test barangay' },
        region: 'MM', rush: true, paymentMode: 'COD', ...overrides
    };
}
function req(path, body, token, method = body === undefined ? 'GET' : 'POST', ip = '192.0.2.1') {
    return new Request(`https://shop.example.invalid${path}`, {
        method, headers: {
            'CF-Connecting-IP': ip,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
}
async function call(env, path, body, token, method, ip) {
    const response = await handlePublicRequest(req(path, body, token, method, ip), env);
    return { status: response.status, body: await response.json(), headers: response.headers };
}
const code = expected => error => { assert.equal(error.code, expected, error.stack); return true; };
function saleRows(env) {
    return env.DB.sqlite.prepare("SELECT * FROM transactions WHERE type='sale' ORDER BY id").all().map(row => ({ ...row, details: JSON.parse(row.details) }));
}
async function placed(env, overrides) {
    return (await call(env, '/api/public/checkout', intent(overrides))).body;
}
function edit(order, overrides = {}) {
    return {
        requestId: crypto.randomUUID(), expectedVersion: order.orderVersion,
        items: order.items.map(item => ({ id: item.id, quantity: item.details.quantity, size: item.details.size, color: item.details.color })),
        customerName: order.customerName, contactNumber: order.details.contactNumber,
        shippingDetails: Object.fromEntries(['address', 'city', 'province', 'barangay'].map(key => [key, order.details.shippingDetails[key]])),
        ...overrides
    };
}

test('catalog reconstructs products and returns only catalog/aggregate stock/voucher configuration', async t => {
    const { env } = fixture(t);
    const order = await placed(env);
    const response = await call(env, '/api/public/catalog');
    assert.deepEqual(Object.keys(response.body).sort(), ['brands', 'products', 'stock', 'vouchers']);
    assert.equal(response.body.products.length, 2);
    assert.equal(response.body.stock['acc-practice-ball'], 500);
    const json = JSON.stringify(response.body);
    for (const privateValue of ['Synthetic Customer', 'MUST NOT LEAK', 'SECRET', '09171234567', order.orderId, 'customerName', 'cost', 'proofOfPayment']) assert.ok(!json.includes(privateValue), privateValue);
    insert(env, uid(9), 'delete_product', { name: 'Team Shirt' });
    env.DB.sqlite.prepare("UPDATE transactions SET date='2026-09-02T00:00:00Z' WHERE id=?").run(uid(9));
    assert.equal((await call(env, '/api/public/catalog')).body.products.length, 1);
});

test('minimal stock projection matches full legacy helpers without retrieving private or monetary history', async t => {
    const { env } = fixture(t);
    insert(env, uid(60), 'expense', { category: 'blanks', brand: 'Sypik', linkedColor: 'Black', size: 'M', quantity: 15, cost: 999, supplier: 'PRIVATE SUPPLIER' }, '999', 'blanks');
    insert(env, uid(61), 'sale', {
        customerName: 'PRIVATE CUSTOMER', contactNumber: '09990000000', customerAddress: 'PRIVATE ADDRESS',
        proofOfPayment: 'https://private.invalid/receipt', privateCost: 71, orderId: 'ST-PROJECTION', voucherCode: 'SAVE',
        status: 'pending', items: [
            { name: 'Team Shirt', category: 'shirts', brand: 'Sypik', color: 'Black', size: 'M', quantity: 3, price: 350, privateCost: 5 },
            { details: { name: 'Practice Ball', category: 'balls', quantity: 2, unitPrice: 100, privateCost: 99 } },
            { name: 'Practice Ball', category: 'balls', quantity: 50, removedFromOrder: true }
        ]
    }, '2000', 'sales');
    const fullRows = env.DB.sqlite.prepare('SELECT * FROM transactions ORDER BY date DESC,created_at DESC,id DESC').all()
        .map(row => ({ ...row, details: JSON.parse(row.details) }));
    const expected = buildPublicCatalog(fullRows);
    const actual = await call(env, '/api/public/catalog');
    assert.deepEqual(actual.body.stock, expected.stock);
    assert.deepEqual(actual.body.vouchers, expected.vouchers);
    const projected = env.DB.catalogSnapshots.at(-1).filter(row => ['sale', 'expense'].includes(row.type));
    assert.ok(projected.every(row => row.amount === '0'));
    const projectedJSON = JSON.stringify(projected);
    for (const field of ['PRIVATE CUSTOMER', 'PRIVATE ADDRESS', 'PRIVATE SUPPLIER', '09990000000', 'private.invalid', 'privateCost', 'unitPrice', '2000']) {
        assert.ok(!projectedJSON.includes(field), field);
    }
    assert.equal(actual.body.stock['shirt-sypik-black-m'], 12);
    assert.equal(actual.body.stock['acc-practice-ball'], 498);
});

test('catalog reconstruction is cached by database identity and refreshed after revision changes', async t => {
    const { env } = fixture(t);
    await call(env, '/api/public/catalog');
    await call(env, '/api/public/catalog');
    assert.equal(env.DB.catalogSnapshots.length, 1);
    insert(env, uid(65), 'update_stock', { name: 'Practice Ball', category: 'balls', quantity: 4 });
    assert.equal((await call(env, '/api/public/catalog')).body.stock['acc-practice-ball'], 504);
    assert.equal(env.DB.catalogSnapshots.length, 2);
    const other = fixture(t);
    assert.equal((await call(other.env, '/api/public/catalog')).body.stock['acc-practice-ball'], 500);
});

test('compacted stock descriptors retain whitespace, fallback and quantity normalization semantics', async t => {
    const { env } = fixture(t);
    let seed = 47123;
    const pick = values => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return values[seed % values.length];
    };
    for (let index = 0; index < 350; index++) {
        const details = {
            category: pick(['shirts', 'blanks', 'sale', 'sales', 'general', 'Accessories', 'balls', '', ' shirts ', '\tshirts\n', '\u00a0blanks\u00a0']),
            name: pick([' Ball Pack ', 'Cap', '', null, '  ']),
            itemName: pick(['Practice  Ball', '', null, '  ']),
            subCategory: pick(['Spare  Balls', '', null, '  ']),
            brand: pick(['Sypik', ' Six  Zero ', '', null, '  ']),
            size: pick(['M', ' L ', 'N/A', '', null, '  ']),
            color: pick(['Black', ' White ', '', null, '  ']),
            linkedColor: pick(['Blue', '', null, '  ']),
            quantity: pick([0, 1, 7, '3', '', null, 'bad', '0x10', true, false, [], [2], 1.5]),
            removedFromOrder: pick([false, true]),
            club: pick(['', null, 'downtown-dinks'])
        };
        insert(env, uid(20000 + index), pick(['sale', 'expense', 'update_stock']), details, '0',
            pick(['shirts', 'blanks', 'sales', 'general', 'accessories']));
    }
    const fullRows = env.DB.sqlite.prepare('SELECT * FROM transactions ORDER BY date DESC,created_at DESC,id DESC').all()
        .map(row => ({ ...row, details: JSON.parse(row.details) }));
    assert.deepEqual((await call(env, '/api/public/catalog')).body.stock, buildPublicCatalog(fullRows).stock);
});

test('null historical details cannot create a synthetic stock movement', async t => {
    const { env } = fixture(t);
    const before = (await call(env, '/api/public/catalog')).body.stock;
    env.DB.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,details)
        VALUES (?,'sale','shirts','500',?,NULL)`).run(uid(24000), DATE);
    assert.deepEqual((await call(env, '/api/public/catalog')).body.stock, before);
});

test('measured-shape synthetic history stays projected and uses revision-only warm reads', async t => {
    const { env } = fixture(t);
    const privatePayload = 'synthetic-private-metadata-'.repeat(80);
    env.DB.sqlite.exec('BEGIN');
    for (let index = 0; index < 1622; index++) {
        const sale = index < 778;
        insert(env, uid(1000 + index), sale ? 'sale' : 'update_stock', {
            name: `Synthetic accessory ${index % 25}`, itemName: `Synthetic accessory ${index % 25}`,
            category: 'accessories', quantity: sale ? 1 : 10,
            ...(sale ? { orderId: `ST-SYNTHETIC-${index % 357}`, status: 'pending' } : {}),
            customerName: 'Synthetic customer', customerAddress: privatePayload, proofOfPayment: privatePayload,
            privateFinancialMetadata: privatePayload
        }, '250', 'accessories');
    }
    env.DB.sqlite.exec('COMMIT');
    await call(env, '/api/public/catalog');
    const projected = env.DB.catalogSnapshots[0];
    assert.ok(projected.length < 100, 'Repeated stock movements should be aggregated before Worker reconstruction.');
    const full = env.DB.sqlite.prepare('SELECT id,type,category,amount,date,description,details FROM transactions').all();
    const projectedBytes = Buffer.byteLength(JSON.stringify(projected));
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    assert.ok(projectedBytes < fullBytes * 0.2);
    const timings = [];
    for (let index = 0; index < 9; index++) {
        const start = performance.now();
        buildPublicCatalog(projected.map(row => ({ ...row, details: JSON.parse(row.details) })));
        timings.push(performance.now() - start);
    }
    timings.sort((left, right) => left - right);
    await call(env, '/api/public/catalog');
    assert.equal(env.DB.catalogSnapshots.length, 1);
    t.diagnostic(`Synthetic 1626-row decode/reconstruction local median ${timings[4].toFixed(2)} ms; projected ${projectedBytes}/${fullBytes} bytes. This is not a deployed Worker CPU measurement.`);
});

test('checkout recomputes shipping/rush/discount; writes canonical unpaid flat rows atomically', async t => {
    const { env } = fixture(t);
    const result = await placed(env, { voucherCode: 'SAVE' });
    assert.equal(result.total, 930); // 700 - 70 + 100 shipping + 200 rush
    const rows = saleRows(env);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, '930');
    assert.equal(rows[0].details.paymentStatus, 'unpaid');
    assert.equal(typeof rows[0].details.quantity, 'number');
    assert.equal(rows[0].details.fulfillmentStatus, 'pending');
    assert.equal(rows[0].details.contactNumber, '09171234567');
    assert.equal(rows[0].details.shippingDetails.rushFee, 200);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_checkout_receipts').get().n, 1);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM _guest_checkout_guards').get().n, 0);
    await assert.rejects(placed(env, { voucherCode: 'SAVE' }), code('invalid_input'));
});

test('client financial/status injection, invalid quantities and unsupported variants are rejected', async t => {
    const { env } = fixture(t);
    for (const patch of [
        { amount: 1 }, { paid: true }, { details: { createdBy: 'owner' } },
        { items: [{ productId: uid(1), size: 'M', quantity: 0 }] },
        { items: [{ productId: uid(1), size: 'M', quantity: '2' }] },
        { items: [{ productId: uid(1), size: 'BAD', quantity: 1 }] },
        { items: [{ productId: uid(1), size: 'M', color: 'Blue', quantity: 1 }] },
        { items: [{ productId: uid(1), size: 'M', quantity: 1, unitPrice: 1 }] }
    ]) await assert.rejects(call(env, '/api/public/checkout', intent(patch)), code('invalid_input'));
    assert.equal(saleRows(env).length, 0);
});

test('lost checkout responses replay the same receipt without duplicate sales and reject changed payload', async t => {
    const { env } = fixture(t);
    const body = intent();
    env.DB.loseCheckoutResponse = true;
    await assert.rejects(call(env, '/api/public/checkout', body), /lost response/);
    const firstId = saleRows(env)[0].order_id;
    const retry = await call(env, '/api/public/checkout', body);
    assert.equal(retry.body.orderId, firstId);
    assert.equal(saleRows(env).length, 1);
    await assert.rejects(call(env, '/api/public/checkout', { ...body, rush: false }), code('idempotency_conflict'));
});

test('concurrent catalog/stock/voucher change aborts checkout without partial order/receipt writes', async t => {
    const { env } = fixture(t);
    env.DB.beforeBatch = statements => {
        if (!statements.some(statement => statement.sql.includes('INSERT INTO _guest_checkout_guards'))) return;
        env.DB.beforeBatch = null;
        insert(env, uid(8), 'update_stock', { name: 'Practice Ball', category: 'balls', quantity: -500 });
    };
    await assert.rejects(placed(env, { voucherCode: 'SAVE' }), code('catalog_changed'));
    assert.equal(saleRows(env).length, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_checkout_receipts').get().n, 0);
});

test('a SQL error in a later checkout line rolls back the entire batch including the order header', async t => {
    const { env } = fixture(t);
    env.DB.sqlite.exec(`CREATE TRIGGER synthetic_checkout_failure BEFORE INSERT ON transactions
        WHEN NEW.type='sale' AND NEW.category='balls' BEGIN SELECT RAISE(ABORT,'synthetic_second_line_failure'); END`);
    await assert.rejects(placed(env, {
        items: [{ productId: uid(1), size: 'M', quantity: 1 }, { productId: uid(2), size: 'N/A', quantity: 1 }]
    }), /synthetic_second_line_failure/);
    assert.equal(saleRows(env).length, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_checkout_receipts').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM _guest_checkout_guards').get().n, 0);
});

test('ball tiers use established shared prices; shirts are preorder and accessories cannot oversell', async t => {
    const { env } = fixture(t);
    assert.equal((await placed(env, { rush: true, items: [{ productId: uid(2), size: 'N/A', quantity: 100 }] })).total, 7100);
    await assert.rejects(placed(env, { items: [{ productId: uid(2), size: 'N/A', quantity: 401 }] }), code('invalid_input'));
    assert.equal((await placed(env, { rush: false, items: [{ productId: uid(1), size: 'XS', quantity: 500 }] })).total, 175100);
});

test('tracking verifies full normalized contact before returning only the scoped order', async t => {
    const { env } = fixture(t);
    const first = await placed(env);
    const second = await placed(env, { contactNumber: '09998887777' });
    await assert.rejects(call(env, '/api/public/track', { orderId: first.orderId, contact: '1234567' }), code('order_not_found'));
    await assert.rejects(call(env, '/api/public/track', { orderId: 'ST-MISSING', contact: '09171234567' }), code('order_not_found'));
    const tracked = await call(env, '/api/public/track', { orderId: first.orderId, contact: '0917 123 4567' });
    assert.equal(tracked.body.order.id, first.orderId);
    assert.ok(!JSON.stringify(tracked.body).includes(second.orderId));
    assert.ok(!JSON.stringify(tracked.body).includes('createdBy'));
    await assert.rejects(call(env, `/api/public/orders/${second.orderId}`, undefined, tracked.body.token), code('order_scope'));
    await assert.rejects(call(env, `/api/public/orders/${first.orderId}`, undefined, `${tracked.body.token}a`), code('verification_required'));
    const latest = await call(env, '/api/public/track', { contact: '(0999) 888-7777' });
    assert.equal(latest.body.order.id, second.orderId);
});

test('expired tracking capability requires fresh full-contact verification', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const oldNow = Date.now;
    try {
        Date.now = () => oldNow() + 31 * 60 * 1000;
        await assert.rejects(call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token), code('verification_required'));
        const result = await call(env, '/api/public/track', { orderId: initial.orderId, contact: '09171234567' });
        assert.equal(result.body.order.id, initial.orderId);
    } finally { Date.now = oldNow; }
});

test('shared capability check returns only a currently verified guest order with an active DB grant', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const path = `/api/media/objects/${uid(50)}`;
    assert.equal(await authorizedGuestOrder(req(path), env), null);
    assert.equal(await authorizedGuestOrder(req(path, undefined, initial.token), env), initial.orderId);
    await assert.rejects(authorizedGuestOrder(req(path, undefined, `${initial.token}a`), env), code('verification_required'));
    env.DB.sqlite.prepare('UPDATE guest_order_grants SET revoked=1 WHERE order_id=?').run(initial.orderId);
    await assert.rejects(authorizedGuestOrder(req(path, undefined, initial.token), env), code('verification_required'));
    env.DB.sqlite.prepare('UPDATE guest_order_grants SET revoked=0 WHERE order_id=?').run(initial.orderId);
    env.DB.sqlite.prepare("UPDATE transactions SET details=json_set(details,'$.contactNumber','09990000000') WHERE order_id=?").run(initial.orderId);
    await assert.rejects(authorizedGuestOrder(req(path, undefined, initial.token), env), code('verification_required'));
});

test('guest response hides migrated/legacy receipt URLs while owner source data remains intact', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const proof = `/api/media/objects/${uid(50)}`;
    env.DB.sqlite.prepare("UPDATE transactions SET details=json_set(details,'$.proofOfPayment',?) WHERE order_id=?").run(proof, initial.orderId);
    const response = await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token);
    assert.ok(!JSON.stringify(response.body).includes(proof));
    assert.equal(saleRows(env)[0].details.proofOfPayment, proof);
});

test('legacy nested UUID fallback supports full customerContact verification and exact no-op total', async t => {
    const { env } = fixture(t);
    const id = uid(20);
    insert(env, id, 'sale', {
        customer: 'Legacy Customer', customerContact: '09991234567', status: 'paid',
        items: [{ name: 'Legacy shirt', quantity: 2, price: 300, size: 'M', color: 'Black' }],
        shippingDetails: { shippingFee: 100 }, discountShare: 20
    }, '681', 'shirts');
    const tracked = (await call(env, '/api/public/track', { orderId: id, contact: '09991234567' })).body;
    assert.equal(tracked.order.items.length, 1);
    assert.equal(tracked.order.totalAmount, 681);
    const changed = await call(env, `/api/public/orders/${id}/save`, edit(tracked.order), tracked.token);
    assert.equal(changed.body.order.totalAmount, 681);
    assert.equal(changed.body.order.orderVersion, 1);
    assert.equal(saleRows(env)[0].amount, '681');
});

test('pending edits retain prices, allocations, paid/balance and replay contact changes idempotently', async t => {
    const { env } = fixture(t);
    const initial = await placed(env, { voucherCode: 'SAVE' });
    const tracked = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body;
    const body = edit(tracked.order, { contactNumber: '09990000000' });
    const saved = await call(env, `/api/public/orders/${initial.orderId}/save`, body, initial.token);
    assert.equal(saved.body.order.totalAmount, 930);
    assert.equal(saved.body.order.paidAmount, 0);
    assert.equal(saved.body.order.orderVersion, 1);
    const retry = await call(env, `/api/public/orders/${initial.orderId}/save`, body, initial.token);
    assert.equal(retry.body.order.orderVersion, 1);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_order_events').get().n, 1);
    await assert.rejects(call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token), code('verification_required'));
    assert.equal((await call(env, `/api/public/orders/${initial.orderId}`, undefined, saved.body.token)).body.order.details.contactNumber, '09990000000');
});

test('guest saves reject arbitrary changes, stale version, removed last item and concurrent status changes', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const order = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body.order;
    const path = `/api/public/orders/${initial.orderId}/save`;
    await assert.rejects(call(env, path, edit(order, { paymentStatus: 'paid' }), initial.token), code('invalid_input'));
    await assert.rejects(call(env, path, edit(order, { items: [] }), initial.token), code('invalid_input'));
    await assert.rejects(call(env, path, edit(order, { expectedVersion: 10 }), initial.token), code('order_conflict'));
    env.DB.beforeBatch = statements => {
        if (!statements.some(statement => statement.sql.includes('INSERT INTO _guest_order_guards'))) return;
        env.DB.beforeBatch = null;
        env.DB.sqlite.prepare("UPDATE transactions SET details=json_set(details,'$.fulfillmentStatus','in_progress') WHERE order_id=?").run(initial.orderId);
    };
    await assert.rejects(call(env, path, edit(order), initial.token), code('order_conflict'));
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_order_events').get().n, 0);
    const current = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body.order;
    await assert.rejects(call(env, path, edit(current), initial.token), code('order_not_pending'));
});

test('revoking a guest grant after preflight aborts the atomic edit without changing the order', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const order = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body.order;
    const original = saleRows(env);
    env.DB.beforeBatch = statements => {
        if (!statements.some(statement => statement.sql.includes('INSERT INTO _guest_order_guards'))) return;
        env.DB.beforeBatch = null;
        env.DB.sqlite.prepare('UPDATE guest_order_grants SET revoked=1 WHERE order_id=?').run(initial.orderId);
    };
    await assert.rejects(call(env, `/api/public/orders/${initial.orderId}/save`, edit(order), initial.token), code('order_conflict'));
    assert.deepEqual(saleRows(env), original);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_order_receipts').get().n, 0);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_order_events').get().n, 0);
});

test('full detail snapshots reject stale edits even when revision metadata is artificially unchanged', async t => {
    const { env } = fixture(t);
    const initial = await placed(env);
    const order = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body.order;
    env.DB.beforeBatch = statements => {
        if (!statements.some(statement => statement.sql.includes('INSERT INTO _guest_order_guards'))) return;
        env.DB.beforeBatch = null;
        const revision = env.DB.sqlite.prepare('SELECT revision FROM system_state WHERE singleton=1').get().revision;
        env.DB.sqlite.prepare("UPDATE transactions SET details=json_set(details,'$.paymentStatus','paid') WHERE order_id=?").run(initial.orderId);
        env.DB.sqlite.prepare('UPDATE system_state SET revision=? WHERE singleton=1').run(revision);
    };
    await assert.rejects(call(env, `/api/public/orders/${initial.orderId}/save`, edit(order), initial.token), code('order_conflict'));
    assert.equal(saleRows(env)[0].details.paymentStatus, 'paid');
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM guest_order_events').get().n, 0);
});

test('quantity edits and removal reprice shared discounts/rush/shipping without deleting source history', async t => {
    const { env } = fixture(t);
    const initial = await placed(env, {
        voucherCode: 'SAVE',
        items: [{ productId: uid(1), size: 'M', quantity: 2 }, { productId: uid(1), size: 'L', quantity: 1 }]
    });
    const order = (await call(env, `/api/public/orders/${initial.orderId}`, undefined, initial.token)).body.order;
    const remaining = order.items.find(item => item.details.size === 'L');
    const result = await call(env, `/api/public/orders/${initial.orderId}/save`, edit(order, {
        items: [{ id: remaining.id, quantity: 3, size: 'L', color: remaining.details.color }]
    }), initial.token);
    assert.equal(result.body.order.totalAmount, 1345); // 1050 less 10% + 300 rush + 100 shipping
    assert.equal(result.body.order.items.length, 1);
    assert.equal(saleRows(env).length, 2);
    const removed = saleRows(env).find(row => row.id !== remaining.id);
    assert.equal(removed.amount, '0');
    assert.equal(removed.details.removedFromOrder, true);
});

test('no-op customer edits preserve exact historical decimal text and financial snapshots', async t => {
    const { env } = fixture(t);
    const id = uid(30);
    const details = {
        customerName: 'Legacy Customer', contactNumber: '09991234567', status: 'paid', category: 'shirts',
        itemName: 'Legacy Shirt', quantity: 1, unitPrice: 701.001, originalAmount: 701.001, size: 'M', color: 'Black',
        privateCost: 'owner-only'
    };
    insert(env, id, 'sale', details, '701.001', 'shirts');
    const tracked = (await call(env, '/api/public/track', { orderId: id, contact: '09991234567' })).body;
    assert.ok(!JSON.stringify(tracked).includes('privateCost'));
    await call(env, `/api/public/orders/${id}/save`, edit(tracked.order, { customerName: 'Corrected customer' }), tracked.token);
    const saved = saleRows(env)[0];
    assert.equal(saved.amount, '701.001');
    assert.equal(saved.details.unitPrice, 701.001);
    assert.equal(saved.details.originalAmount, 701.001);
    assert.equal(saved.details.privateCost, 'owner-only');
    assert.equal(saved.details.pricing, undefined);
});

test('physical returned tags do not add stock back to the catalog', async t => {
    const { env } = fixture(t);
    const initial = await placed(env, { items: [{ productId: uid(2), size: 'N/A', quantity: 5 }] });
    env.DB.sqlite.prepare("UPDATE transactions SET details=json_set(details,'$.fulfillmentStatus','returned','$.status','returned') WHERE order_id=?").run(initial.orderId);
    assert.equal((await call(env, '/api/public/catalog')).body.stock['acc-practice-ball'], 495);
});

test('private receipt requires valid image, staged capability and same-order authorization; proof never marks paid', async t => {
    const { env, objects } = fixture(t);
    await assert.rejects(handlePublicRequest(new Request('https://shop.example.invalid/api/public/receipts', {
        method: 'POST', body: '<svg>not a receipt</svg>'
    }), env), code('unsupported_image'));
    await assert.rejects(handlePublicRequest(new Request('https://shop.example.invalid/api/public/receipts', {
        method: 'POST', headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) }, body: 'oversized'
    }), env), code('receipt_too_large'));
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    const uploaded = await handlePublicRequest(new Request('https://shop.example.invalid/api/public/receipts', { method: 'POST', body: png }), env);
    const receipt = await uploaded.json();
    assert.equal(objects.size, 1);
    assert.deepEqual(Object.keys(receipt).sort(), ['receiptId', 'token']);
    const placedOrder = await placed(env, { paymentMode: 'Gcash', receipt });
    assert.equal(saleRows(env)[0].details.paymentStatus, 'unpaid');
    const image = await handlePublicRequest(req(`/api/media/receipts/${receipt.receiptId}`, undefined, placedOrder.token), env);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
    const other = await placed(env);
    await assert.rejects(handlePublicRequest(req(`/api/media/receipts/${receipt.receiptId}`, undefined, other.token), env), code('order_scope'));
    await assert.rejects(placed(env, { paymentMode: 'Gcash', receipt }), code('receipt_conflict'));
    assert.equal(saleRows(env).length, 2);
});

test('rate limits are atomic, return Retry-After, and retain only HMAC keys', async t => {
    const { env } = fixture(t);
    for (let i = 0; i < 15; i++) await assert.rejects(call(env, '/api/public/track', { contact: '09991234567' }), code('order_not_found'));
    const limited = await call(env, '/api/public/track', { contact: '09991234567' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);
    const keys = env.DB.sqlite.prepare('SELECT key FROM rate_limit_state').all();
    assert.ok(keys.every(row => !row.key.includes('192.0.2.1') && !row.key.includes('09991234567')));
});

test('contact normalization rejects partial and arbitrary text inputs', () => {
    assert.equal(normalizeContact('+63 (917) 123-4567'), '639171234567');
    assert.throws(() => normalizeContact('1234'), code('invalid_input'));
    assert.throws(() => normalizeContact('phone:09171234567'), code('invalid_input'));
});
