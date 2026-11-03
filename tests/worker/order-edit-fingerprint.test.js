import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { groupOrders } from '../../src/lib/orderItems.js';
import { buildOrderChanges, buildOrderDetailChanges, keepStoredPrintFields } from '../../src/lib/orderEditingPure.js';
import { shippedWith, withBookingNumber } from '../../src/lib/lbcBooking.js';

// Owner report (2026-11-03): saving an older order in the edit form rewrote fields the print
// queue fingerprints, which held its printed jobs and reopened the order. Runs every migration in
// SQLite and the real change builders (after the LBC session's regression script).
const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));

// Old-app shapes: `name` instead of itemName, no brand or linkedColor, the category only on the
// row, 'blanks', and a nested-items order.
const ROWS = [
    { id: 'legacy-flat', category: 'Shirts', amount: '900', order: 'ST-LEGACY01', details: {
        orderId: 'ST-LEGACY01', name: 'Court shirt', size: 'M', color: 'Black', quantity: 2, price: 450,
        customer: 'Juan Dela Cruz', customerContact: '09171234567', status: 'paid', bookingNumber: '' } },
    { id: 'legacy-blank', category: 'blanks', amount: '300', order: 'ST-LEGACY03', details: {
        orderId: 'ST-LEGACY03', itemName: 'Plain tee', category: 'blanks', size: 'L', linkedColor: 'White', quantity: 1,
        price: 300, customerName: 'Ana Reyes', status: 'paid' } },
    { id: 'legacy-nested', category: 'Shirts', amount: '1500', order: 'ST-LEGACY02', details: {
        orderId: 'ST-LEGACY02', customer: 'Maria Santos', customerContact: '09998887777', status: 'paid',
        items: [{ name: 'Club tee', size: 'L', color: 'Royal Blue', quantity: 3, price: 500 }] } }
];

function database(t) {
    const db = new DatabaseSync(':memory:');
    for (const migration of migrations) db.exec(migration);
    for (const row of ROWS) {
        db.prepare('INSERT INTO orders(id) VALUES (?)').run(row.order);
        db.prepare(`INSERT INTO transactions(id,type,category,amount,date,details,order_id) VALUES (?,'sale',?,?,'2026-08-01T00:00:00Z',?,?)`)
            .run(row.id, row.category, row.amount, JSON.stringify(row.details), row.order);
    }
    t.after(() => db.close());
    return db;
}
const fingerprint = (db, id) => db.prepare('SELECT fingerprint FROM production_source_state WHERE source_id=?').get(id).fingerprint;
// Applies one save's updates, reads the fingerprint, then rolls the save back.
function trial(db, id, update) {
    db.exec('SAVEPOINT trial');
    try {
        db.prepare('UPDATE transactions SET details=?, category=coalesce(?,category) WHERE id=?')
            .run(JSON.stringify(update.details), update.category ?? null, id);
        return fingerprint(db, id);
    } finally {
        db.exec('ROLLBACK TO trial');
        db.exec('RELEASE trial');
    }
}
const orderOf = row => groupOrders([{ id: row.id, type: 'sale', category: row.category, amount: Number(row.amount), amountExact: row.amount,
    date: '2026-08-01T00:00:00Z', description: null, details: structuredClone(row.details), orderVersion: 0 }])[0];
// What Orders > Edit > Save sends (OrderManagement handleSave) with only an LBC booking number typed.
function fullEdit(order, change = details => details) {
    const first = order.items[0].details;
    const shipping = first.shippingDetails || {};
    return buildOrderChanges(order, order.items.map(item => ({ id: item.id, amount: item.amount, details: change({ ...item.details }) })), {
        customerName: order.customerName, contactNumber: shipping.contactNumber || first.customerContact || first.contactNumber || '',
        fulfillmentStatus: order.fulfillmentStatus, paymentStatus: order.paymentStatus, paymentMode: order.paymentMode,
        trackingNumber: '', bookingNumber: 'BK-2026-0001', status: order.fulfillmentStatus,
        shippingDetails: { contactNumber: shipping.contactNumber || '', address: shipping.address || '', city: shipping.city || '',
            province: shipping.province || '', barangay: shipping.barangay || '' }
    }, { date: '2026-08-01T00:00:00Z' }).changes[0].updates;
}

test('saving an older order without changing a shirt keeps every print fingerprint, in the edit form and the LBC panel', t => {
    const db = database(t);
    for (const row of ROWS) {
        const order = orderOf(row);
        const before = fingerprint(db, row.id);
        const edit = fullEdit(order);
        assert.equal(edit.details.bookingNumber, 'BK-2026-0001', row.id);
        assert.equal(trial(db, row.id, edit), before, `${row.id}: Edit > Save`);
        assert.equal(edit.category, undefined, `${row.id}: the row category stays as stored`);
        assert.equal(trial(db, row.id, buildOrderDetailChanges(order, details => withBookingNumber(details, 'BK-2026-0001'))[0].updates), before,
            `${row.id}: booking number`);
        assert.equal(trial(db, row.id, buildOrderDetailChanges(order, details => shippedWith(details, '1224 8001 5678'))[0].updates), before,
            `${row.id}: Mark as shipped`);
    }
    const flat = fullEdit(orderOf(ROWS[0])).details;
    assert.deepEqual([flat.brand, flat.linkedColor, flat.itemName, flat.category], [undefined, undefined, undefined, undefined],
        'no Sypik brand, color label, name or category is stamped onto the older row');
});

test('a real size or color change still reaches the fingerprint, and only that field changes', t => {
    const db = database(t);
    const order = orderOf(ROWS[0]);
    const before = JSON.parse(fingerprint(db, ROWS[0].id));
    const resized = fullEdit(order, details => ({ ...details, size: 'L' }));
    assert.equal(resized.details.size, 'L');
    const after = JSON.parse(trial(db, ROWS[0].id, resized));
    assert.deepEqual(after.map((value, index) => JSON.stringify(value) === JSON.stringify(before[index]) ? null : index).filter(index => index !== null),
        [10], 'only the size slot of the 0005 fingerprint changes');
    const recolored = fullEdit(order, details => ({ ...details, color: 'White' }));
    assert.deepEqual([recolored.details.color, recolored.details.linkedColor], ['White', 'White']);
    assert.notEqual(trial(db, ROWS[0].id, recolored), JSON.stringify(before));
    const nested = orderOf(ROWS[2]);
    const renamed = fullEdit(nested, details => ({ ...details, size: 'XL' })).details.items[0];
    assert.deepEqual([renamed.size, renamed.brand, renamed.linkedColor, renamed.name], ['XL', undefined, undefined, 'Club tee']);
});

test('stored fields are kept only when the line still means the same and a reseller save can read them', () => {
    const row = { category: 'sale', description: null };
    // Keeping the empty stored category with the new size would read as an accessory, not a shirt.
    const next = { itemName: 'Club tee', category: 'shirts', size: 'N/A', quantity: 1 };
    assert.deepEqual(keepStoredPrintFields(next, { itemName: 'Club tee', size: 'M', quantity: 1 }, null, row), next);
    assert.deepEqual(keepStoredPrintFields({ itemName: 'Tee', brand: 'Sypik', color: 'Red', linkedColor: 'Red', quantity: 2 },
        { name: 'Tee', color: 'Red', quantity: 2 }, null, row), { name: 'Tee', color: 'Red', quantity: 2 });
    // The reseller save reads `itemName ?? name`, `size ??` and `color ??` as stored and needs a numeric
    // quantity, so an empty string or a quoted quantity is written the way the editor shows it.
    assert.deepEqual(keepStoredPrintFields({ itemName: 'Tee', size: 'N/A', color: 'Red', linkedColor: 'Red', quantity: 1 },
        { itemName: '', name: 'Tee', size: '', color: '', linkedColor: 'Red', quantity: '1' }, null, row),
    { itemName: 'Tee', size: 'N/A', color: 'Red', linkedColor: 'Red', quantity: 1 });
    assert.deepEqual(keepStoredPrintFields({ itemName: 'Team Shirt', quantity: 1 }, { quantity: 1 }, null, { category: 'sale', description: 'Team Shirt' }),
        { itemName: 'Team Shirt', quantity: 1 }, 'a name that only comes from the description is written out');
    const wrapped = { details: { itemName: 'Tee' } };
    const rebuilt = { itemName: 'Tee', brand: 'Sypik' };
    assert.equal(keepStoredPrintFields(rebuilt, wrapped, {}, row), rebuilt, 'wrapped legacy items are left as built');
});
