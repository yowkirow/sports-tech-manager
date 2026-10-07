import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payoutSteps, productionCandidates, productionLineKey, productionQuantity, productionError, walletPeso } from '../../src/lib/production.js';

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
