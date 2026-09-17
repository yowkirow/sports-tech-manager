import assert from 'node:assert/strict';
import test from 'node:test';
import { getCheckoutStatuses } from '../src/lib/checkoutPolicy.js';

test('reseller orders always start unpaid and pending even if edited client state asks otherwise', () => {
    const expected = { paymentStatus: 'unpaid', fulfillmentStatus: 'pending', status: 'pending' };
    assert.deepEqual(getCheckoutStatuses('reseller'), expected);
    assert.deepEqual(getCheckoutStatuses('reseller', 'paid', 'shipped'), expected);
    assert.deepEqual(getCheckoutStatuses('reseller', 'paid', 'ready'), expected);
});

test('owner checkout preserves existing defaults and explicit statuses', () => {
    assert.deepEqual(getCheckoutStatuses('owner'), { paymentStatus: 'paid', fulfillmentStatus: 'pending', status: 'pending' });
    assert.deepEqual(getCheckoutStatuses('owner', 'unpaid', 'ready'), { paymentStatus: 'unpaid', fulfillmentStatus: 'ready', status: 'ready' });
});

test('missing or unsupported roles cannot create orders', () => {
    for (const role of [undefined, null, '', 'admin', 'staff', 'print_operator']) {
        assert.throws(() => getCheckoutStatuses(role), /cannot create orders/);
    }
});
