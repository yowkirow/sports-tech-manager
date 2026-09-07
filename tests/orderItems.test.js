import assert from 'node:assert/strict';
import test from 'node:test';
import { getSaleItems, groupOrders } from '../src/lib/orderItems.js';

const legacySale = (id, details = {}) => ({
    id, type: 'sale', category: 'Sales', amount: 850, date: '2026-09-01T10:00:00Z',
    details: {
        customer: 'Demo Buyer',
        customerContact: '09123456789',
        customerAddress: 'Demo Street',
        items: [
            { id: 'product-1', name: 'Court Shirt', brand: 'Sypik', category: 'shirts', price: 350, quantity: 1, size: 'S', color: 'Black' },
            { id: 'product-2', name: 'Court Ball', category: 'balls', price: 100, quantity: 5 }
        ],
        ...details
    }
});

test('normalizes legacy POS items and contact fields without losing source IDs or money', () => {
    const source = legacySale('sale-1');
    const items = getSaleItems(source);
    assert.deepEqual(items.map(item => item.id), ['sale-1:0', 'sale-1:1']);
    assert.deepEqual(items.map(item => item.transactionId), ['sale-1', 'sale-1']);
    assert.deepEqual(items.map(item => item.details.itemName), ['Court Shirt', 'Court Ball']);
    assert.equal(items.reduce((sum, item) => sum + item.amount, 0), source.amount);
    assert.equal(items[0].details.customerName, 'Demo Buyer');
    assert.equal(items[0].details.shippingDetails.address, 'Demo Street');
    assert.equal(source.details.customerName, undefined);
});

test('two POS checkouts in the same minute remain separate orders', () => {
    const orders = groupOrders([legacySale('one'), legacySale('two')]);
    assert.equal(orders.length, 2);
    assert.equal(orders[0].items.length, 2);
    assert.equal(orders[0].transactions.length, 1);
    assert.equal(orders[0].totalAmount, 850);
});

test('flat online lines group by explicit order ID without inventing shipping revenue', () => {
    const rows = ['one', 'two'].map(id => ({
        id, type: 'sale', category: 'shirts', date: '2026-09-01T10:00:00Z', amount: 300,
        details: { orderId: 'ST-ONE', customerName: 'Buyer', itemName: id, quantity: 1, originalAmount: 350, discountShare: 50, shippingDetails: { shippingFee: 100 } }
    }));
    const [order] = groupOrders(rows);
    assert.equal(order.totalAmount, 600);
    assert.equal(order.shippingFee, 100);
    assert.deepEqual(order.items.map(item => item.transactionId), ['one', 'two']);
});

test('ignores removed order lines and club earnings, but does not remove returned tags', () => {
    assert.deepEqual(getSaleItems(legacySale('removed', { removedFromOrder: true })), []);
    assert.deepEqual(getSaleItems(legacySale('club', { club: 'downtown-dinks' })), []);
    assert.equal(getSaleItems(legacySale('returned', { fulfillmentStatus: 'returned' })).length, 2);
});

test('preserves explicit zero quantities and reconciles legacy amount allocations to cents', () => {
    const source = legacySale('one', { items: [{ name: 'A', price: 1, quantity: 1 }, { name: 'B', price: 1, quantity: 1 }, { name: 'C', price: 1, quantity: 0 }] });
    source.amount = 0.01;
    const items = getSaleItems(source);
    assert.equal(items[2].details.quantity, 0);
    assert.equal(Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100), 1);
});

test('handles empty legacy carts without allocating money to nonexistent items', () => {
    assert.deepEqual(getSaleItems(legacySale('empty', { items: [] })), []);
});

test('nested item snapshots cannot override later parent status, payment or address updates', () => {
    const source = legacySale('nested', {
        fulfillmentStatus: 'shipped',
        paymentStatus: 'paid',
        shippingDetails: { address: 'Current Street', rushFee: 100 },
        items: [
            { name: 'Shirt', category: 'shirts', quantity: 1, price: 350, fulfillmentStatus: 'pending', paymentStatus: 'unpaid', shippingDetails: { address: 'Old Street', rushFee: 100 } },
            { name: 'Ball', category: 'balls', quantity: 5, price: 100, fulfillmentStatus: 'pending', shippingDetails: { rushFee: 0 } }
        ]
    });
    const [order] = groupOrders([source]);
    assert.equal(order.fulfillmentStatus, 'shipped');
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.details.shippingDetails.address, 'Current Street');
    assert.equal(order.totalRushFee, 100);
    assert.equal(order.items[1].details.size, 'N/A');
});
