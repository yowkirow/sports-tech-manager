import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { groupOrders } from '../../src/lib/orderItems.js';
import { getEditableOrderItems, priceOrderChanges } from '../../src/lib/orderEditingPure.js';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const correction = readFileSync(new URL('0015_legacy_shipping_in_totals.sql', directory), 'utf8');

function database(t) {
    const db = new DatabaseSync(':memory:');
    for (const migration of migrations) db.exec(migration);
    t.after(() => db.close());
    return db;
}
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function sale(db, n, orderId, amount, details) {
    if (orderId) db.prepare('INSERT OR IGNORE INTO orders(id) VALUES (?)').run(orderId);
    db.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id)
        VALUES (?,'sale','shirts',?,'2026-02-10T00:00:00Z','Online Order',?,?)`).run(id(n), amount, JSON.stringify({
        ...(orderId ? { orderId } : {}), customerName: 'Buyer', itemName: 'Club Tee', category: 'shirts', size: 'M', quantity: 1,
        unitPrice: 400, originalAmount: 400, discountShare: 0, isOnlineOrder: true, fulfillmentStatus: 'shipped',
        shippingDetails: { region: 'MM', shippingFee: 100, rushFee: 0, isRushOrder: false }, ...details
    }), orderId);
}
const rows = db => db.prepare("SELECT id,type,category,amount,date,description,details FROM transactions ORDER BY id").all()
    .map(row => ({ ...row, amount: Number(row.amount), amountExact: row.amount, details: JSON.parse(row.details) }));
const read = db => db.prepare('SELECT id,amount,details FROM transactions ORDER BY id').all().map(row => ({ ...row }));
const version = (db, orderId) => db.prepare('SELECT version FROM orders WHERE id=?').get(orderId).version;

test('0015 adds a missing shipping fee once per old-app online order, with an audit note', t => {
    const db = database(t);
    sale(db, 1, 'ST-MISSING', '400');
    sale(db, 2, 'ST-MISSING', '400');
    sale(db, 3, 'ST-INCLUDED', '500');
    sale(db, 4, 'ST-NEITHER', '500', { originalAmount: 600 });
    sale(db, 5, 'ST-STOREFRONT', '400', { source: 'storefront' });
    sale(db, 6, null, '650', { originalAmount: 650, shippingDetails: { region: 'Provincial', shippingFee: 200, rushFee: 0 } });
    sale(db, 7, 'ST-DECIMAL', '400.5', { originalAmount: 400.5 });
    sale(db, 8, 'ST-NOFEE', '400', { shippingDetails: { region: 'MM', shippingFee: 0 } });
    sale(db, 9, 'ST-RUSH', '500', { shippingDetails: { region: 'MM', shippingFee: 100, rushFee: 100, isRushOrder: true } });
    const before = read(db);
    const versions = ['ST-MISSING', 'ST-INCLUDED', 'ST-RUSH'].map(orderId => version(db, orderId));
    db.exec(correction);
    const after = read(db);
    const changed = after.filter((row, index) => row.amount !== before[index].amount || row.details !== before[index].details).map(row => row.id);
    assert.deepEqual(changed, [id(1), id(6), id(9)], 'one line of each qualifying order');
    const amount = n => after.find(row => row.id === id(n)).amount;
    assert.deepEqual([amount(1), amount(2), amount(6), amount(9)], ['500', '400', '850', '600']);
    const note = JSON.parse(after.find(row => row.id === id(1)).details);
    assert.equal(note.shippingShare, 100);
    assert.deepEqual(note.shippingCorrection, { addedFee: 100, previousAmount: '400', date: '2026-10-23',
        reason: 'Shipping fee was recorded but missing from the order total' });
    assert.deepEqual(['ST-MISSING', 'ST-INCLUDED', 'ST-RUSH'].map(orderId => version(db, orderId)), [versions[0] + 1, versions[1], versions[2] + 1]);
    db.exec(correction);
    assert.deepEqual(read(db), after, 'safe to re-run');
});

test('after 0015 the Orders screen shows a consistent total that an edit keeps', t => {
    const db = database(t);
    sale(db, 1, 'ST-MISSING', '400');
    sale(db, 2, 'ST-MISSING', '400');
    const legacy = groupOrders(rows(db)).find(order => order.id === 'ST-MISSING');
    assert.equal(legacy.totalAmount, 800);
    assert.equal(legacy.shippingFee, 100);
    assert.equal(legacy.priceAdjustment, -100, 'before: the shipping fee shows but is missing from the total');
    db.exec(correction);
    const order = groupOrders(rows(db)).find(item => item.id === 'ST-MISSING');
    assert.deepEqual([order.totalAmount, order.subtotal, order.shippingFee, order.priceAdjustment], [900, 800, 100, 0]);
    const unchanged = priceOrderChanges(order, getEditableOrderItems(order));
    assert.equal(unchanged.total, 900);
    const moreShirts = priceOrderChanges(order, getEditableOrderItems(order).map((item, index) => index === 1 ? { ...item, quantity: 2 } : item));
    assert.equal(moreShirts.total, 1300, 'one shipping fee, not one per line');
    assert.equal(moreShirts.shippingFee, 100);
});
