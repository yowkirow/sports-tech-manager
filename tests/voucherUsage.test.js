import assert from 'node:assert/strict';
import test from 'node:test';
import { getVoucherUsage } from '../src/lib/voucherUsage.js';

const sale = (id, details = {}) => ({ id, type: 'sale', details: { voucherCode: 'COURT', ...details } });

test('counts orders rather than individual items, with independent voucher totals', () => {
    const usage = getVoucherUsage([
        sale('1', { orderId: 'first' }),
        sale('2', { orderId: 'first' }),
        sale('3', { orderId: 'second' }),
        sale('4', { orderId: 'first', voucherCode: 'CLUB' })
    ]);
    assert.deepEqual([...usage], [['COURT', 2], ['CLUB', 1]]);
});

test('excludes returned sales, non-sales and transactions without vouchers', () => {
    const usage = getVoucherUsage([
        sale('1', { fulfillmentStatus: 'Returned' }),
        sale('2', { status: 'returned' }),
        sale('3', { voucherCode: null }),
        { id: '4', type: 'voucher', details: { voucherCode: 'COURT' } },
        { id: '5', type: 'sale' }
    ]);
    assert.equal(usage.size, 0);
});

test('legacy sales without order IDs are distinct and do not collide with order IDs', () => {
    const usage = getVoucherUsage([sale('1'), sale('2'), sale('3', { orderId: '1' }), sale('1')]);
    assert.equal(usage.get('COURT'), 3);
});
