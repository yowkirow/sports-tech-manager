import assert from 'node:assert/strict';
import test from 'node:test';
import { groupOrders } from '../src/lib/orderItems.js';
import { buildOrderChanges, buildOrderDetailChanges, getEditableOrderItems, saveOrderChanges } from '../src/lib/orderEditing.js';

const makeRows = (snapshot = true) => {
    const pricing = { version: 1, discount: { type: 'percent', value: 10 }, shippingFee: 100, isRushOrder: true, rushFeePerShirt: 100, shippingLineId: 'shirt' };
    return [
        { id: 'shirt', amount: 930, name: 'Court Shirt', quantity: 2, originalAmount: 700, discountShare: 70, shippingShare: 100, rushFee: 200, category: 'shirts', size: 'S', brand: 'Sypik' },
        { id: 'ball', amount: 900, name: 'Court Ball', quantity: 10, originalAmount: 1000, discountShare: 100, shippingShare: 0, rushFee: 0, category: 'balls', size: 'N/A', brand: 'Ball Brand' }
    ].map(item => ({
        id: item.id, type: 'sale', category: item.category, amount: item.amount, description: item.name, date: '2026-09-01T10:00:00Z',
        details: {
            orderId: 'ST-DEMO', customerName: 'Demo Buyer', contactNumber: '09123456789',
            itemName: item.name, brand: item.brand, category: item.category, size: item.size,
            quantity: item.quantity, originalAmount: item.originalAmount, discountShare: item.discountShare,
            shippingShare: item.shippingShare, imageUrl: `${item.id}.png`, proofOfPayment: 'receipt.png',
            fulfillmentStatus: 'pending', paymentStatus: 'unpaid', voucherCode: 'COURT',
            ...(snapshot ? { pricing } : {}),
            shippingDetails: { shippingFee: 100, rushFee: item.rushFee, isRushOrder: true, address: 'Demo Street', city: 'Demo City' }
        }
    }));
};

test('unchanged mixed order preserves each line amount, metadata, receipt, shipping and rush charges', () => {
    const rows = makeRows();
    const [order] = groupOrders(rows);
    const result = buildOrderChanges(order, getEditableOrderItems(order), { customerName: 'Updated Buyer' });
    assert.deepEqual(result.changes.map(change => change.updates.amount), [930, 900]);
    assert.equal(result.total, 1830);
    assert.equal(result.changes[1].updates.details.itemName, 'Court Ball');
    assert.equal(result.changes[1].updates.details.brand, 'Ball Brand');
    assert.equal(result.changes[1].updates.details.imageUrl, 'ball.png');
    assert.equal(result.changes[1].updates.details.proofOfPayment, 'receipt.png');
    assert.equal(rows[1].details.customerName, 'Demo Buyer');
});

test('quantity edits recalculate percentage discount, shirt rush fees and ball quantity tiers', () => {
    const [order] = groupOrders(makeRows());
    const drafts = getEditableOrderItems(order);
    drafts[0].quantity = 3;
    const result = buildOrderChanges(order, drafts);
    assert.equal(result.total, 2245);
    assert.equal(result.changes[0].updates.details.shippingDetails.rushFee, 300);
    drafts[0].quantity = 2;
    drafts[1].quantity = 50;
    assert.equal(buildOrderChanges(order, drafts).total, 4530);
});

test('removing the shipping carrier retains shipping once and leaves a zero-value audit row', () => {
    const [order] = groupOrders(makeRows());
    const result = buildOrderChanges(order, getEditableOrderItems(order).slice(1));
    assert.equal(result.total, 1000);
    assert.equal(result.changes[0].updates.amount, 0);
    assert.equal(result.changes[0].updates.details.removedFromOrder, true);
    assert.equal(result.changes[0].updates.details.quantity, 0);
    assert.equal(result.changes[1].updates.details.shippingShare, 100);
    const saved = result.changes.map(change => ({ ...change.original, ...change.updates }));
    const [normalized] = groupOrders(saved);
    assert.equal(normalized.items.length, 1);
    assert.equal(normalized.totalAmount, 1000);
});

test('legacy discounts retain the saved monetary allowance rather than current voucher settings', () => {
    const [order] = groupOrders(makeRows(false));
    const result = buildOrderChanges(order, getEditableOrderItems(order).slice(1));
    assert.equal(result.discountAmount, 170);
    assert.equal(result.total, 930);
    assert.equal(result.options.legacyDiscount, true);
});

test('legacy multi-item POS edits map back to one real transaction ID without losing other items', () => {
    const source = {
        id: 'legacy-pos', type: 'sale', category: 'Sales', amount: 850, date: '2026-09-01T10:00:00Z',
        details: { customer: 'Buyer', items: [
            { id: 'catalog-shirt', name: 'Shirt', brand: 'Sypik', category: 'shirts', size: 'S', quantity: 1, price: 350 },
            { id: 'catalog-ball', name: 'Ball', brand: 'Ball Brand', category: 'balls', quantity: 5, price: 100 }
        ] }
    };
    const [order] = groupOrders([source]);
    const drafts = getEditableOrderItems(order);
    drafts[0].quantity = 2;
    const result = buildOrderChanges(order, drafts, { customerName: 'Updated Buyer' });
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].id, 'legacy-pos');
    assert.equal(result.changes[0].updates.amount, 1200);
    assert.equal(result.changes[0].updates.details.items[1].name, 'Ball');
    const [saved] = groupOrders([{ ...source, ...result.changes[0].updates }]);
    assert.equal(saved.items[0].details.quantity, 2);
    assert.equal(saved.items[1].details.brand, 'Ball Brand');
    assert.equal(saved.customerName, 'Updated Buyer');
});

test('manual line-total adjustments remain explicit and product replacement uses the selected product', () => {
    const [order] = groupOrders(makeRows());
    const drafts = getEditableOrderItems(order);
    drafts[0].priceAdjustment = -30;
    assert.equal(buildOrderChanges(order, drafts).changes[0].updates.amount, 900);
    const replacement = {
        id: 'shirt', productChanged: true, priceAdjustment: 0,
        details: { itemName: 'Grip', quantity: 2, unitPrice: 100, category: 'accessories', brand: 'Grip Brand', imageUrl: 'grip.png', size: 'N/A', color: 'White' }
    };
    const replaced = buildOrderChanges(order, [replacement, drafts[1]]);
    assert.equal(replaced.changes[0].updates.category, 'accessories');
    assert.equal(replaced.changes[0].updates.details.brand, 'Grip Brand');
    assert.equal(replaced.changes[0].updates.details.originalAmount, 200);
    assert.equal(replaced.changes[0].updates.details.shippingDetails.rushFee, 0);
});

const mockClient = (response) => {
    const requests = [];
    return {
        requests,
        async rpc(name, args) {
            requests.push({ name, args });
            return response || { data: args.p_changes.map(change => ({ id: change.id })), error: null };
        }
    };
};

test('one RPC sends the full edit and original snapshots, including pending-only protection', async () => {
    const rows = makeRows();
    const [order] = groupOrders(rows);
    const { changes } = buildOrderChanges(order, getEditableOrderItems(order));
    const client = mockClient();
    await saveOrderChanges(client, changes, { requirePending: true });
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].name, 'save_order_changes');
    assert.equal(client.requests[0].args.p_require_pending, true);
    assert.deepEqual(client.requests[0].args.p_changes.map(change => change.id), ['shirt', 'ball']);
    assert.deepEqual(client.requests[0].args.p_changes[0].expected.details, rows[0].details);
    assert.deepEqual(client.requests[0].args.p_changes[1].updates, changes[1].updates);
});

test('status, tracking and comment changes retain source amounts and save as one order operation', async () => {
    const rows = makeRows();
    const [order] = groupOrders(rows);
    const changes = buildOrderDetailChanges(order, details => ({
        ...details, fulfillmentStatus: 'shipped', trackingNumber: 'TRACK-TEST', comments: [{ text: 'Sent' }]
    }));
    const client = mockClient();
    await saveOrderChanges(client, changes);
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].args.p_require_pending, false);
    assert.deepEqual(changes.map(change => change.updates.amount), [930, 900]);
    assert.equal(changes.every(change => change.updates.details.fulfillmentStatus === 'shipped'), true);
    assert.equal(rows[0].details.fulfillmentStatus, 'pending');
});

test('database rollbacks surface without falling back to separate row updates', async () => {
    const [order] = groupOrders(makeRows());
    const { changes } = buildOrderChanges(order, getEditableOrderItems(order));
    for (const error of [
        { code: '40001', message: 'Stale order' },
        { code: '22023', message: 'Only pending orders can be edited.' },
        { code: '42501', message: 'The complete order could not be saved.' }
    ]) {
        const client = mockClient({ error, data: null });
        await assert.rejects(saveOrderChanges(client, changes), /No changes were saved/);
        assert.equal(client.requests.length, 1);
    }
});

test('a lost or incomplete RPC response requires reload without asserting that a commit failed', async () => {
    const [order] = groupOrders(makeRows());
    const { changes } = buildOrderChanges(order, getEditableOrderItems(order));
    for (const response of [
        { error: { message: 'Failed to fetch' }, data: null },
        { error: null, data: [{ id: 'shirt' }] },
        { error: null, data: [{ id: 'shirt' }, { id: 'shirt' }] },
        { error: null, data: [{ id: 'shirt' }, { id: 'unknown' }] },
        { error: { code: 'PGRST202', message: 'Function missing' }, data: null }
    ]) {
        await assert.rejects(saveOrderChanges(mockClient(response), changes), /could not be confirmed.*Reload/);
    }
});

test('empty, duplicate and synthetic source changes are rejected without requesting a save', async () => {
    const [order] = groupOrders(makeRows());
    const { changes } = buildOrderChanges(order, getEditableOrderItems(order));
    const client = mockClient();
    await assert.rejects(saveOrderChanges(client, []), /cannot be empty/);
    await assert.rejects(saveOrderChanges(client, [changes[0], changes[0]]), /duplicate/);
    await assert.rejects(saveOrderChanges(client, [{ ...changes[0], id: 'legacy:0' }]), /invalid source/);
    assert.equal(client.requests.length, 0);
});

test('no-op edits retain historical uneven discount allocations and sub-cent unit prices', () => {
    const rows = makeRows(false);
    rows[0].details.quantity = 3;
    rows[0].details.originalAmount = 1000;
    rows[0].details.discountShare = 30.01;
    rows[0].amount = 1269.99;
    rows[1].details.discountShare = 139.99;
    rows[1].amount = 860.01;
    const [order] = groupOrders(rows);
    const result = buildOrderChanges(order, getEditableOrderItems(order));
    assert.deepEqual(result.changes.map(change => change.updates.amount), [1269.99, 860.01]);
    assert.equal(result.changes[0].updates.details.originalAmount, 1000);
    assert.equal(result.changes[0].updates.details.discountShare, 30.01);
    const [saved] = groupOrders(result.changes.map(change => ({ ...change.original, ...change.updates })));
    const repeat = buildOrderChanges(saved, getEditableOrderItems(saved));
    assert.deepEqual(repeat.changes.map(change => change.updates.amount), [1269.99, 860.01]);
});

test('an amount override from Sales is retained even when an older pricing snapshot has an adjustment', () => {
    const rows = makeRows();
    rows[0].details.priceAdjustment = 0;
    rows[0].amount -= 30;
    const [order] = groupOrders(rows);
    const result = buildOrderChanges(order, getEditableOrderItems(order));
    assert.equal(result.changes[0].updates.amount, 900);
    assert.equal(result.changes[0].updates.details.priceAdjustment, -30);
});

test('unchanged legacy allocations do not reject valid lines after a hypothetical discount redistribution', () => {
    const rows = makeRows(false);
    rows[0].details.discountShare = 0;
    rows[0].amount = 20;
    rows[1].details.discountShare = 1000;
    rows[1].amount = 0;
    const [order] = groupOrders(rows);
    const result = buildOrderChanges(order, getEditableOrderItems(order));
    assert.deepEqual(result.changes.map(change => change.updates.amount), [20, 0]);
});
