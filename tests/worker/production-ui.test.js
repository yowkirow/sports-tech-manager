import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BATCH_JOBS, payoutSteps, productionBatchLines, productionCandidates, productionCustomerOf, productionGroupMatches, productionLineKey, productionOrderGroups, productionQuantity, productionError, walletPeso } from '../../src/lib/production.js';

test('production UI sends only normalized shirt source references and server snapshot tokens', () => {
    const transactions = [
        { id: 'source', type: 'sale', category: 'Shirts', amount: 500, details: {
            customerName: 'PRIVATE', contactNumber: 'PRIVATE', items: [
                { name: 'Shirt', quantity: 2, size: 'M' },
                { name: 'Ball', category: 'Balls', quantity: 1 }
            ]
        } },
        { id: 'removed', type: 'sale', category: 'Shirts', details: { removedFromOrder: true, size: 'M' } }
    ];
    const source = { sourceId: 'source', itemIndex: 0, orderId: 'ST-SAFE', designName: 'Shirt', brand: 'Sypik',
        color: 'Black', size: 'M', required: 2, sourceToken: 'server-hash', customerName: 'PRIVATE' };
    const candidates = productionCandidates(transactions, [source,
        { ...source, itemIndex: 1 }, { ...source, sourceId: 'removed', itemIndex: null }], []);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sourceToken, 'server-hash');
    assert.ok(!JSON.stringify(candidates).includes('PRIVATE'));
    assert.equal(productionCandidates(transactions, [source], [{ sourceId: 'source', itemIndex: 0 }]).length, 0);
    assert.equal(productionLineKey({ sourceId: 'flat', itemIndex: null }), 'flat:-1');
});

test('production UI whole quantities never round decimals, negatives, overflow or empty strings', () => {
    for (const value of ['', '-1', '1.2', '1e1', ' 2 ', '100000000000000000000000', 'abc', 11]) {
        assert.equal(productionQuantity(value, 10), null, String(value));
    }
    assert.equal(productionQuantity('0', 10), null);
    assert.equal(productionQuantity('0', 10, true), 0);
    assert.equal(productionQuantity('3', 10), 3);
    assert.match(productionError({ status: 409 }), /input is still here/);
    assert.match(productionError({ status: 403 }), /assignment changed/);
});

test('wallet money formats exact integer centavos and offers only whole pay steps up to the balance', () => {
    assert.equal(walletPeso(0), '₱0');
    assert.equal(walletPeso(100000), '₱1,000');
    assert.equal(walletPeso(1234500), '₱12,345');
    assert.equal(walletPeso(100050), '₱1,000.50');
    assert.equal(walletPeso(-200000), '−₱2,000');
    assert.equal(walletPeso(1000.5), '₱—');
    assert.equal(walletPeso('100000'), '₱—');
    assert.deepEqual(payoutSteps(300000, 100000), [300000, 200000, 100000]);
    assert.deepEqual(payoutSteps(99999, 100000), []);
    assert.deepEqual(payoutSteps(0, 100000), []);
    assert.deepEqual(payoutSteps(-100000, 100000), []);
    assert.deepEqual(payoutSteps(100000, 0), []);
});

test('owner picker groups shirt lines by the customer who ordered, keeps order numbers, and sends no names', () => {
    const sale = (id, orderId, customerName, date, details = {}) => ({ id, type: 'sale', category: 'Shirts', amount: 500, date,
        details: { orderId, customerName, itemName: 'Shirt', size: 'M', quantity: 1, ...details } });
    const transactions = [
        sale('t1', 'ST-B2', 'zoe Cruz', '2026-10-02T00:00:00Z'),
        sale('t2', 'ST-A1', 'Ana Reyes', '2026-10-05T00:00:00Z', { items: [{ name: 'Club', size: 'M', quantity: 2 }, { name: 'Team', size: 'L', quantity: 1 }] }),
        { id: 't3', type: 'sale', category: 'Shirts', amount: 500, date: '2026-10-01T00:00:00Z', details: { customer: 'Ana Reyes', orderId: 'ST-A0', size: 'S' } }
    ];
    const source = (sourceId, orderId, itemIndex, required, designName) => ({ sourceId, itemIndex, orderId, designName, brand: 'Sypik',
        color: 'White', size: 'M', required, sourceToken: `${sourceId}:${itemIndex}`, designImageUrl: '/api/media/objects/x' });
    const candidates = productionCandidates(transactions, [
        source('t1', 'ST-B2', null, 1, 'Shirt'), source('t2', 'ST-A1', 0, 2, 'Club'), source('t2', 'ST-A1', 1, 1, 'Team'), source('t3', 'ST-A0', null, 1, 'Shirt')
    ], []);
    assert.equal(candidates[0].designImageUrl, '/api/media/objects/x');
    const groups = productionOrderGroups(candidates, transactions);
    assert.deepEqual(groups.map(group => [group.customerName, group.orderId, group.shirts, group.lines.length]), [
        ['Ana Reyes', 'ST-A0', 1, 1], ['Ana Reyes', 'ST-A1', 3, 2], ['zoe Cruz', 'ST-B2', 1, 1]
    ]);
    assert.equal(productionGroupMatches(groups[2], 'ZOE'), true);
    assert.equal(productionGroupMatches(groups[2], 'st-b2'), true);
    assert.equal(productionGroupMatches(groups[1], 'team'), true);
    assert.equal(productionGroupMatches(groups[0], 'zoe'), false);
    const payload = productionBatchLines(groups.flatMap(group => group.lines));
    assert.deepEqual(Object.keys(payload[0]).sort(), ['expectedSourceToken', 'itemIndex', 'sourceId']);
    assert.ok(!JSON.stringify(payload).includes('Ana') && !JSON.stringify(payload).includes('zoe'));
    assert.equal(productionCustomerOf(transactions)({ sourceId: 't2' }), 'Ana Reyes');
    assert.equal(productionCustomerOf(transactions)({ sourceId: 'missing' }), '');
    assert.equal(MAX_BATCH_JOBS, 30);
});
