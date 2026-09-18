import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest } from '../../worker/business-api.ts';
import { HttpError } from '../../worker/errors.ts';
import { groupOrders } from '../../src/lib/orderItems.js';
import { buildOrderChanges } from '../../src/lib/orderEditingPure.js';
import { saveOrderChanges } from '../../src/lib/orderEditing.js';

const migrations = ['0001_business.sql', '0002_transaction_date_pattern.sql', '0003_business_api.sql']
    .map(name => readFileSync(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8'));
const ORDER = 'ST-RESELLER-EDIT';
const DATE = '2026-09-10T01:02:03.123456789Z';
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reseller = { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' };
const other = { id: 'other', email: 'other@example.invalid', role: 'reseller' };
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const printer = { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' };

class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        migrations.forEach(migration => this.sqlite.exec(migration));
        for (const member of [reseller, other, owner, printer]) {
            this.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
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
                assert.ok(values.length <= 100);
                values.filter(value => typeof value === 'string').forEach(value => assert.ok(Buffer.byteLength(value) <= 2_000_000));
                this.values = values;
                return this;
            },
            async all() { return db.execute(this); }
        };
    }
    execute(statement) {
        this.executed.push(statement);
        return { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values) };
    }
    async batch(statements) {
        assert.ok(statements.length <= 50);
        const mutating = statements.some(statement => statement.sql.startsWith('INSERT INTO _business_guards'));
        if (mutating && this.beforeMutation) {
            const hook = this.beforeMutation;
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

async function api(db, body, member = reseller, path = '/api/orders/save') {
    const response = await handleBusinessRequest(new Request(`https://app.example.invalid${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), { DB: db, ENVIRONMENT: 'staging', PRINT_QUEUE_ENABLED: 'false' }, member);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
}
function sale(n, details = {}, amount = '400') {
    return {
        id: id(n), type: 'sale', category: details.category ?? 'shirts', amount, date: DATE, description: null,
        details: {
            orderId: ORDER, createdBy: reseller.email, userRole: 'reseller', source: 'pos',
            itemName: 'Team Shirt', category: 'shirts', quantity: 1, unitPrice: 400, originalAmount: 400,
            brand: 'Sypik', color: 'White', imageUrl: 'stored-shirt.png', size: 'M',
            discountShare: 0, shippingShare: 0, paymentStatus: 'unpaid', fulfillmentStatus: 'pending', status: 'pending',
            customerName: 'Original customer', contactNumber: '09123456789',
            shippingDetails: { address: 'Old address', city: 'City', province: 'Province', barangay: 'Barangay', region: 'Region',
                shippingFee: 0, isRushOrder: false, rushFee: 0 },
            ...details
        }
    };
}
function seed(db, row) {
    const order = row.type === 'sale' ? (row.details.orderId || row.id) : null;
    if (order) db.sqlite.prepare('INSERT OR IGNORE INTO orders(id) VALUES (?)').run(order);
    db.sqlite.prepare('INSERT INTO transactions(id,type,category,amount,date,description,details,order_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(row.id, row.type, row.category, row.amount, row.date, row.description, JSON.stringify(row.details), order);
}
function product(db, n = 900, patch = {}) {
    seed(db, { id: id(n), type: 'define_product', category: 'shirts', amount: '0', date: DATE, description: null,
        details: { name: 'Team Shirt', category: 'shirts', brand: 'Sypik', linkedColor: 'White',
            imageUrl: 'current-different-image.png', price: 1200, supplierCost: 200, ...patch } });
}
function rows(db) {
    return db.sqlite.prepare(`SELECT t.*,o.version AS orderVersion FROM transactions t LEFT JOIN orders o ON o.id = t.order_id
        WHERE t.type = 'sale' ORDER BY t.id`).all().map(row => ({
        ...row, amountExact: row.amount, amount: Number(row.amount), details: JSON.parse(row.details)
    }));
}
function state(db) {
    return Object.fromEntries(['transactions', 'orders', 'business_events', 'activity_events', 'mutation_receipts', 'system_state', '_business_guards']
        .map(table => [table, db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function rejection(status, code) {
    return error => {
        assert.ok(error instanceof HttpError, error.stack);
        assert.equal(error.status, status, error.message);
        if (code) assert.equal(error.code, code);
        return true;
    };
}
// Capture exactly the management screen -> pure builder -> save API contract.
async function input(db, changeDrafts = drafts => drafts, patch = {}, requestId = 'save-order', source = rows(db)) {
    const order = groupOrders(source)[0];
    const first = order.items[0].details;
    const shipping = first.shippingDetails;
    const drafts = changeDrafts(order.items.map(item => ({ id: item.id, amount: item.amount, details: { ...item.details } })));
    const built = buildOrderChanges(order, drafts, {
        customerName: order.customerName, contactNumber: first.contactNumber,
        fulfillmentStatus: order.fulfillmentStatus, paymentStatus: order.paymentStatus,
        paymentMode: order.paymentMode, trackingNumber: first.trackingNumber || '', status: order.fulfillmentStatus,
        shippingDetails: { contactNumber: first.contactNumber, address: shipping.address, city: shipping.city,
            province: shipping.province, barangay: shipping.barangay },
        ...patch
    }, { date: order.date });
    let body;
    await saveOrderChanges(built.changes, { requirePending: true, requestId, save: async value => {
        body = value;
        return { orderId: value.orderId, version: value.expectedVersion + 1, ids: value.changes.map(change => change.id) };
    } });
    return body;
}

test('real management/API contract saves own pending address and size edits, preserving private source metadata and exact money', async t => {
    const db = new LocalD1(t);
    const original = sale(1, { unitPrice: 612.34, originalAmount: '612.34001', discountShare: '12.34001',
        priceAdjustment: '0.0000001', ownerNote: { private: 'retained' }, comments: [{ text: 'Original comment' }] }, '600.0000001');
    seed(db, original);
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, size: 'L' } })), {
        customerName: 'New customer', contactNumber: '09999999999',
        shippingDetails: { address: 'New address', city: 'New city', province: 'New province', barangay: 'New barangay', contactNumber: '09999999999' }
    });
    assert.deepEqual(await api(db, body), { orderId: ORDER, version: 1, ids: [id(1)] });
    const saved = rows(db)[0];
    assert.equal(saved.amountExact, original.amount);
    for (const key of ['originalAmount', 'discountShare', 'priceAdjustment', 'ownerNote', 'comments', 'itemName', 'imageUrl', 'brand']) {
        assert.deepEqual(saved.details[key], original.details[key], key);
    }
    assert.equal(saved.date, DATE);
    assert.equal(saved.details.size, 'L');
    assert.equal(saved.details.shippingDetails.address, 'New address');
    assert.equal(saved.details.createdBy, reseller.email);
    assert.equal(saved.details.userRole, 'reseller');
    assert.equal(saved.orderVersion, 1);
    assert.equal(state(db).business_events[0].actor_id, reseller.id);
    assert.equal(state(db).business_events[0].action, 'reseller.order.updated');
});

test('quantity changes reuse current POS catalog validation and fixed 400 pricing, not retail or legacy prices', async t => {
    const db = new LocalD1(t);
    product(db);
    seed(db, sale(1, { unitPrice: 650, originalAmount: 650 }, '650'));
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 3 } })));
    assert.equal(body.changes[0].updates.amount, 1950);
    await api(db, body);
    const saved = rows(db)[0];
    assert.equal(saved.amountExact, '1200');
    assert.equal(saved.details.unitPrice, 400);
    assert.equal(saved.details.originalAmount, 1200);
    assert.equal(saved.details.imageUrl, 'stored-shirt.png');
    assert.ok(db.executed.some(statement => statement.sql.includes('row_number() OVER')));
});

test('blank product quantity edits retain stored identity rather than frontend-normalized shirt category', async t => {
    const db = new LocalD1(t);
    product(db, 900, { category: 'blanks' });
    seed(db, sale(1, { category: 'blanks', productId: 'legacy-catalog-id', linkedColor: 'White' }));
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    assert.equal(body.changes[0].updates.details.category, 'shirts');
    await api(db, body);
    const saved = rows(db)[0];
    assert.equal(saved.category, 'blanks');
    assert.equal(saved.details.category, 'blanks');
    assert.equal(saved.details.productId, 'legacy-catalog-id');
    assert.equal(saved.amountExact, '800');
});

test('mixed existing prices remain line-specific when some quantity edits need repricing and others do not', async t => {
    const db = new LocalD1(t);
    product(db);
    seed(db, sale(1));
    seed(db, sale(2, { unitPrice: 650, originalAmount: 650 }, '650'));
    seed(db, sale(3));
    const body = await input(db, drafts => drafts.map(draft => ({
        ...draft, details: { ...draft.details, quantity: draft.id === id(3) ? 1 : 2 }
    })));
    await api(db, body);
    const saved = rows(db);
    assert.deepEqual(saved.map(row => row.amountExact), ['800', '800', '400']);
    assert.deepEqual(saved.map(row => row.details.unitPrice), [400, 400, 400]);
    assert.deepEqual(saved.map(row => row.details.quantity), [2, 2, 1]);
    assert.deepEqual(saved.map(row => row.details.imageUrl), Array(3).fill('stored-shirt.png'));
    assert.equal(state(db).business_events.length, 1);
    assert.equal(state(db).mutation_receipts.length, 1);
});

test('no-op edits do not require current catalog availability; quantity edits do', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    seed(db, { id: id(900), type: 'delete_product', category: 'shirts', amount: '0', date: DATE, description: null,
        details: { name: 'Team Shirt' } });
    await api(db, await input(db, undefined, { customerName: 'Historical customer' }));
    const before = state(db);
    await assert.rejects(api(db, await input(db,
        drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })), {}, 'increase')),
    rejection(400));
    assert.deepEqual(state(db), before);
});

test('repricing uses only stored discounts/fees and adjustments; submitted total cannot override them', async t => {
    const db = new LocalD1(t);
    product(db);
    seed(db, sale(1, {
        source: 'online', originalAmount: 400, discountShare: 40, shippingShare: 150, priceAdjustment: 25,
        pricing: { version: 1, discount: { type: 'percent', value: 10 }, shippingFee: 150,
            shippingLineId: id(1), isRushOrder: true, rushFeePerShirt: 100 },
        shippingDetails: { shippingFee: 150, isRushOrder: true, rushFee: 100 }
    }, '635'));
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    const injected = structuredClone(body);
    injected.changes[0].updates.details.priceAdjustment = -200;
    injected.changes[0].updates.amount -= 225;
    await assert.rejects(api(db, injected), rejection(400));
    await api(db, body);
    const saved = rows(db)[0];
    assert.equal(saved.amountExact, '1095');
    assert.equal(saved.details.unitPrice, 400);
    assert.equal(saved.details.discountShare, 80);
    assert.equal(saved.details.shippingDetails.rushFee, 200);
    assert.equal(saved.details.shippingShare, 150);
    assert.equal(saved.details.priceAdjustment, 25);
});

for (const [quantity, price] of [[20, 100], [21, 90], [49, 90], [50, 80], [99, 80], [100, 70]]) {
    test(`ball quantity ${quantity} uses established ${price} tier`, async t => {
        const db = new LocalD1(t);
        product(db, 900, { name: 'Pickleball', category: 'balls', linkedColor: '' });
        seed(db, sale(1, { itemName: 'Pickleball', category: 'balls', color: '', size: 'N/A', unitPrice: 100, originalAmount: 100 }, '100'));
        const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity } })));
        await api(db, body);
        assert.equal(rows(db)[0].amountExact, String(price * quantity));
        assert.equal(rows(db)[0].details.unitPrice, price);
    });
}

test('removing historical online shipping carrier reallocates freight/discount/rush via shared pricing, never drops fees', async t => {
    const db = new LocalD1(t);
    const pricing = { version: 1, discount: { type: 'fixed', value: 100 }, shippingFee: 150,
        isRushOrder: true, rushFeePerShirt: 100, shippingLineId: id(1) };
    for (const n of [1, 2]) seed(db, sale(n, {
        source: 'online', isOnlineOrder: true, pricing, discountShare: 50, shippingShare: n === 1 ? 150 : 0,
        shippingDetails: { address: 'Original', shippingFee: 150, isRushOrder: true, rushFee: 100 }
    }, n === 1 ? '600' : '450'));
    const body = await input(db, drafts => drafts.slice(1));
    const response = await api(db, body);
    assert.deepEqual(response.ids, [id(1), id(2)]);
    const [removed, kept] = rows(db);
    assert.equal(removed.amountExact, '0');
    assert.equal(removed.details.removedFromOrder, true);
    assert.equal(kept.amountExact, '550');
    assert.equal(kept.details.shippingShare, 150);
    assert.equal(kept.details.discountShare, 100);
    assert.equal(kept.details.shippingDetails.rushFee, 100);
});

for (const [label, mutate, status = 400] of [
    ['amount', body => { body.changes[0].updates.amount = '1'; }],
    ['unit price', body => { body.changes[0].updates.details.unitPrice = 1; }],
    ['adjustment', body => { body.changes[0].updates.details.priceAdjustment = -399; }],
    ['discount', body => { body.changes[0].updates.details.discountShare = 399; }],
    ['pricing snapshot', body => { body.changes[0].updates.details.pricing.discount = { type: 'percent', value: 100 }; }],
    ['freight', body => { body.changes[0].updates.details.shippingDetails.shippingFee = 1; }],
    ['rush', body => { body.changes[0].updates.details.shippingDetails.rushFee = 1; }],
    ['payment', body => { body.changes[0].updates.details.paymentStatus = 'paid'; }],
    ['payment mode', body => { body.changes[0].updates.details.paymentMode = 'COD'; }],
    ['status', body => { body.changes[0].updates.details.status = 'ready'; }],
    ['tracking', body => { body.changes[0].updates.details.trackingNumber = 'TRACK'; }],
    ['comments', body => { body.changes[0].updates.details.comments = [{ text: 'Injected' }]; }],
    ['private cost', body => { body.changes[0].updates.details.supplierCost = 1; }],
    ['createdBy', body => { body.changes[0].updates.details.createdBy = other.email; }],
    ['userRole', body => { body.changes[0].updates.details.userRole = 'owner'; }],
    ['product identity', body => { body.changes[0].updates.details.itemName = 'Another Shirt'; }],
    ['image', body => { body.changes[0].updates.details.imageUrl = 'different'; }],
    ['brand', body => { body.changes[0].updates.details.brand = 'Another'; }],
    ['color', body => { body.changes[0].updates.details.color = 'Another'; }],
    ['category', body => { body.changes[0].updates.category = 'balls'; }],
    ['date', body => { body.changes[0].updates.date = '2026-09-11T00:00:00Z'; }],
    ['description', body => { body.changes[0].updates.description = 'changed'; }],
    ['unknown body field', body => { body.privileged = true; }],
    ['unknown change field', body => { body.changes[0].requesterRole = 'owner'; }],
    ['unknown snapshot field', body => { body.changes[0].expected.fake = true; }],
    ['unknown update field', body => { body.changes[0].updates.priceAdjustment = -399; }],
    ['bad quantity', body => { body.changes[0].updates.details.quantity = -1; }],
    ['string quantity', body => { body.changes[0].updates.details.quantity = '1'; }],
    ['nonboolean pending', body => { body.requirePending = 'true'; }],
    ['nonboolean packing', body => { body.packingConfirmed = 'false'; }],
    ['duplicate source', body => { body.changes.push(structuredClone(body.changes[0])); }],
    ['packing confirmation', body => { body.packingConfirmed = true; }, 403]
]) {
    test(`rejects ${label} injection without writing anything`, async t => {
        const db = new LocalD1(t);
        seed(db, sale(1));
        const body = await input(db);
        mutate(body);
        const before = state(db);
        await assert.rejects(api(db, body), rejection(status));
        assert.deepEqual(state(db), before);
    });
}

test('cannot remove every line; false pending/packing flags never bypass policy', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    const body = await input(db);
    body.requirePending = false;
    body.packingConfirmed = false;
    assert.equal((await api(db, body)).version, 1);
    const removed = await input(db, undefined, {}, 'remove-all');
    Object.assign(removed.changes[0].updates.details, { removedFromOrder: true, quantity: 0 });
    removed.changes[0].updates.amount = 0;
    await assert.rejects(api(db, removed), rejection(400));
});

for (const [label, patch] of [
    ['paid', { paymentStatus: 'paid' }], ['shipped', { fulfillmentStatus: 'shipped' }],
    ['cancelled', { fulfillmentStatus: 'cancelled' }], ['in progress', { fulfillmentStatus: 'in_progress' }],
    ['ready', { fulfillmentStatus: 'ready' }]
]) {
    test(`${label} source orders are not reseller-editable`, async t => {
        const db = new LocalD1(t);
        seed(db, sale(1, patch));
        const body = await input(db);
        const before = state(db);
        await assert.rejects(api(db, body), error => error instanceof HttpError && [400, 409].includes(error.status));
        assert.deepEqual(state(db), before);
    });
}

test('exact owner email, all active source membership, and verified reseller role are mandatory', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    const body = await input(db);
    await assert.rejects(api(db, body, printer), rejection(403));
    await assert.rejects(api(db, body, other), rejection(403));
    await assert.rejects(api(db, body, { ...reseller, email: reseller.email.toUpperCase() }), rejection(403));
    seed(db, sale(2, { createdBy: other.email, customerName: 'Other private customer' }));
    const before = state(db);
    await assert.rejects(api(db, body), rejection(403));
    assert.deepEqual(state(db), before);
    assert.ok(db.executed.filter(statement => statement.sql.startsWith('SELECT t.id')).every(statement =>
        statement.sql.includes("json_extract(t.details,'$.createdBy') = ?")));
});

test('inactive removed sources never grant access or block complete active own-order edits', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    seed(db, sale(2, { removedFromOrder: true, createdBy: other.email, quantity: 0 }, '0'));
    const body = await input(db);
    const result = await api(db, body);
    assert.deepEqual(result.ids, [id(1)]);
    assert.equal(rows(db)[1].details.createdBy, other.email);
    assert.equal(rows(db)[1].details.removedFromOrder, true);
});

for (const [label, mutate, status = 409] of [
    ['revoked membership', db => db.sqlite.exec("UPDATE members SET active = 0 WHERE id = 'reseller'"), 403],
    ['deleted membership', db => db.sqlite.exec("DELETE FROM members WHERE id = 'reseller'"), 403],
    ['role changed', db => db.sqlite.exec("UPDATE members SET role = 'owner' WHERE id = 'reseller'"), 403],
    ['email changed', db => db.sqlite.exec("UPDATE members SET email = 'changed@example.invalid' WHERE id = 'reseller'"), 403],
    ['source deleted', db => db.sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id(1))],
    ['active membership grew', db => seed(db, sale(2))],
    ['cross-owner membership grew', db => seed(db, sale(2, { createdBy: other.email })), 403],
    ['source reassigned', db => db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.createdBy',?) WHERE id = ?").run(other.email, id(1)), 403],
    ['source became paid', db => db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.paymentStatus','paid') WHERE id = ?").run(id(1))],
    ['source shipped', db => db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.fulfillmentStatus','shipped') WHERE id = ?").run(id(1))],
    ['exact amount changed', db => db.sqlite.prepare("UPDATE transactions SET amount = '400.00000001' WHERE id = ?").run(id(1))],
    ['nanosecond date changed', db => db.sqlite.prepare("UPDATE transactions SET date = '2026-09-10T01:02:03.123456788Z' WHERE id = ?").run(id(1))],
    ['description changed', db => db.sqlite.prepare("UPDATE transactions SET description = 'Changed' WHERE id = ?").run(id(1))],
    ['private details changed', db => db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.note','Changed') WHERE id = ?").run(id(1))],
    ['version changed', db => db.sqlite.prepare('UPDATE orders SET version = 1 WHERE id = ?').run(ORDER)]
]) {
    test(`atomic batch rejects ${label} after preflight`, async t => {
        const db = new LocalD1(t);
        seed(db, sale(1));
        const body = await input(db, undefined, { customerName: 'Not saved' });
        let concurrent;
        db.beforeMutation = () => { mutate(db); concurrent = state(db); };
        await assert.rejects(api(db, body), rejection(status));
        assert.deepEqual(state(db), concurrent);
    });
}

test('expected snapshots, full membership and catalog revision cannot be stale', async t => {
    const db = new LocalD1(t);
    product(db);
    seed(db, sale(1));
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    let concurrent;
    db.beforeMutation = () => {
        db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.linkedColor','Black') WHERE id = ?").run(id(900));
        concurrent = state(db);
    };
    await assert.rejects(api(db, body), rejection(409));
    assert.deepEqual(state(db), concurrent);
    const noChange = await input(db);
    noChange.changes[0].expected.amount = '399';
    await assert.rejects(api(db, noChange), rejection(409));
    const omitted = await input(db);
    seed(db, sale(2));
    await assert.rejects(api(db, omitted), rejection(409));
});

test('lost response replay is idempotent; changed payload conflicts; replay rechecks scope and active membership inside batch', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    const body = await input(db, undefined, { customerName: 'Saved once' });
    db.hideResponse = true;
    await assert.rejects(api(db, body), /could not be confirmed/);
    db.hideResponse = false;
    const once = state(db);
    const result = await api(db, body);
    assert.deepEqual(result, { orderId: ORDER, version: 1, ids: [id(1)] });
    assert.deepEqual(state(db), once);
    const changed = structuredClone(body);
    changed.changes[0].updates.details.customerName = 'Different payload';
    await assert.rejects(api(db, changed), rejection(409, 'idempotency_conflict'));
    assert.deepEqual(state(db), once);
    db.beforeMutation = () => db.sqlite.exec("UPDATE members SET active = 0 WHERE id = 'reseller'");
    await assert.rejects(api(db, body), rejection(403));
    db.sqlite.exec("UPDATE members SET active = 1 WHERE id = 'reseller'");
    db.beforeMutation = () => seed(db, sale(2, { createdBy: other.email }));
    await assert.rejects(api(db, body), rejection(403));
    assert.equal(state(db).business_events.length, 1);
    assert.equal(state(db).mutation_receipts.length, 1);
});

test('receipt replay is denied after the order becomes paid or disappears', async t => {
    const db = new LocalD1(t);
    seed(db, sale(1));
    const body = await input(db);
    await api(db, body);
    db.beforeMutation = () => db.sqlite.prepare("UPDATE transactions SET details = json_set(details,'$.paymentStatus','paid') WHERE id = ?").run(id(1));
    await assert.rejects(api(db, body), rejection(409));
    db.sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id(1));
    await assert.rejects(api(db, body), rejection(409));
});

for (const statement of [
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT,'late receipt failure'); END",
    "CREATE TRIGGER skip_row BEFORE UPDATE ON transactions WHEN OLD.type = 'sale' BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER skip_version BEFORE UPDATE ON orders BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER skip_audit BEFORE INSERT ON business_events BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER skip_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(IGNORE); END"
]) {
    test(`late/partial write rolls back everything: ${statement.split(' ')[2]}`, async t => {
        const db = new LocalD1(t);
        seed(db, sale(1));
        seed(db, sale(2));
        const body = await input(db, undefined, { customerName: 'Not saved' });
        db.sqlite.exec(statement);
        const before = state(db);
        await assert.rejects(api(db, body));
        assert.deepEqual(state(db), before);
    });
}

test('150-line orders retain constant query and binding limits, with no individual-row fallback', async t => {
    const db = new LocalD1(t);
    product(db);
    for (let n = 1; n <= 150; n++) seed(db, sale(n));
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    const result = await api(db, body);
    assert.equal(result.ids.length, 150);
    assert.equal(db.executed.length, 18);
    assert.equal(rows(db).reduce((total, row) => total + row.amount, 0), 120000);
    assert.equal(db.executed.filter(statement => statement.sql.startsWith('UPDATE transactions')).length, 1);
});

test('legacy nested items retain metadata and support unambiguous quantity/removal edits', async t => {
    const db = new LocalD1(t);
    product(db);
    product(db, 901, { name: 'Pickleball', category: 'balls', linkedColor: '' });
    const row = sale(1, { items: [
        { name: 'Team Shirt', category: 'shirts', brand: 'Sypik', color: 'White', size: 'M', quantity: 1,
            price: 400, originalAmount: 400, itemMetadata: { retained: true } },
        { name: 'Pickleball', category: 'balls', brand: 'Sypik', color: '', size: 'N/A', quantity: 1,
            price: 100, originalAmount: 100 }
    ] }, '500');
    for (const key of ['itemName', 'category', 'unitPrice', 'originalAmount', 'brand', 'color', 'size', 'quantity']) delete row.details[key];
    seed(db, row);
    const body = await input(db, drafts => drafts.slice(0, 1).map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    await api(db, body);
    const saved = rows(db)[0];
    assert.equal(saved.details.items.length, 1);
    assert.equal(saved.details.items[0].quantity, 2);
    assert.deepEqual(saved.details.items[0].itemMetadata, { retained: true });
    assert.equal(saved.amountExact, '800');
});

test('nested historical address/size-only edit preserves all per-item financial allocations exactly', async t => {
    const db = new LocalD1(t);
    const row = sale(1, {
        discountShare: '50.000001',
        items: [
            { name: 'Team Shirt', category: 'shirts', color: 'White', size: 'M', quantity: 1, price: 650,
                originalAmount: '650.000001', discountShare: '25.0000005', amount: 625, legacyNote: 'retained' },
            { name: 'Other Shirt', category: 'shirts', color: 'White', size: 'S', quantity: 1, price: 650,
                originalAmount: 650, discountShare: '25.0000005', amount: 625 }
        ]
    }, '1250.0000001');
    for (const key of ['itemName', 'category', 'unitPrice', 'originalAmount', 'brand', 'color', 'size', 'quantity']) delete row.details[key];
    seed(db, row);
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, size: 'L' } })), {
        customerName: 'New nested customer'
    });
    await api(db, body);
    const saved = rows(db)[0];
    assert.equal(saved.amountExact, row.amount);
    assert.equal(saved.details.discountShare, row.details.discountShare);
    saved.details.items.forEach((item, index) => {
        assert.deepEqual(item, { ...row.details.items[index], size: 'L' });
    });
});

test('ambiguous duplicate nested removals fail rather than lose or switch historical item metadata', async t => {
    const db = new LocalD1(t);
    const row = sale(1, { items: [
        { name: 'Team Shirt', category: 'shirts', color: 'White', size: 'M', quantity: 1, price: 400, privateNote: 'First' },
        { name: 'Team Shirt', category: 'shirts', color: 'White', size: 'M', quantity: 1, price: 400, privateNote: 'Second' }
    ] }, '800');
    for (const key of ['itemName', 'category', 'unitPrice', 'originalAmount', 'brand', 'color', 'size', 'quantity']) delete row.details[key];
    seed(db, row);
    const body = await input(db, drafts => drafts.slice(1));
    const before = state(db);
    await assert.rejects(api(db, body), rejection(400));
    assert.deepEqual(state(db), before);
});

test('wrapped legacy quantity edits fail closed rather than leave stale inner quantities', async t => {
    const db = new LocalD1(t);
    const row = sale(1, { items: [{ details: {
        name: 'Team Shirt', category: 'shirts', color: 'White', size: 'M', quantity: 1, price: 400
    } }] });
    for (const key of ['itemName', 'category', 'unitPrice', 'originalAmount', 'brand', 'color', 'size', 'quantity']) delete row.details[key];
    seed(db, row);
    const body = await input(db, drafts => drafts.map(draft => ({ ...draft, details: { ...draft.details, quantity: 2 } })));
    const before = state(db);
    await assert.rejects(api(db, body), rejection(400));
    assert.deepEqual(state(db), before);
});

test('legacy UUID order without orders row acquires version atomically and preserves its identity', async t => {
    const db = new LocalD1(t);
    const row = sale(1);
    delete row.details.orderId;
    seed(db, row);
    db.sqlite.exec('UPDATE transactions SET order_id = NULL; DELETE FROM orders');
    const source = rows(db).map(row => ({ ...row, orderVersion: 0 }));
    const body = await input(db, undefined, { customerName: 'Legacy updated' }, 'legacy-save', source);
    assert.deepEqual(await api(db, body), { orderId: id(1), version: 1, ids: [id(1)] });
    assert.equal(rows(db)[0].orderVersion, 1);
});
