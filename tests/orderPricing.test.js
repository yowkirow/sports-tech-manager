import assert from 'node:assert/strict';
import test from 'node:test';
import { getBallUnitPrice, getCartUnitPrice, getOrderPricingOptions, isBallProduct, priceOrder } from '../src/lib/orderPricing.js';

test('detects ball products and applies current catalog unit prices', () => {
    assert.equal(isBallProduct({ category: 'balls', name: 'Anything' }), true);
    assert.equal(isBallProduct({ name: 'Court Ball' }), true);
    assert.equal(isBallProduct({ category: 'shirts', name: 'Court Shirt' }), false);
    assert.equal(getBallUnitPrice(20), 100);
    assert.equal(getBallUnitPrice(21), 90);
    assert.equal(getBallUnitPrice(50), 80);
    assert.equal(getBallUnitPrice(100), 70);
    assert.equal(getCartUnitPrice({ name: 'Court Shirt', price: 350, quantity: 2 }), 350);
    assert.equal(getCartUnitPrice({ name: 'Court Ball', category: 'balls', quantity: 50 }, 50), 80);
    assert.equal(getCartUnitPrice({ name: 'Legacy Ball', category: 'balls', unitPrice: 95, preserveUnitPrice: true, quantity: 10 }), 95);
});

test('prices unchanged mixed orders with voucher, shipping, and rush preserved exactly', () => {
    const result = priceOrder([
        { id: 'shirt', name: 'Court Shirt', category: 'shirts', quantity: 2, unitPrice: 350, brand: 'Sypik' },
        { id: 'ball', name: 'Court Ball', category: 'balls', quantity: 10, unitPrice: 100, brand: 'Ball Brand' }
    ], {
        discount: { type: 'percent', value: 10 },
        shippingFee: 100,
        isRushOrder: true,
        rushFeePerShirt: 100,
        shippingLineId: 'shirt'
    });

    assert.equal(result.subtotal, 1700);
    assert.equal(result.discountAmount, 170);
    assert.equal(result.shippingFee, 100);
    assert.equal(result.rushFeeAmount, 200);
    assert.equal(result.total, 1830);
    assert.deepEqual(result.items.map(item => item.amount), [930, 900]);
    assert.deepEqual(result.items.map(item => item.discountShare), [70, 100]);
    assert.equal(result.items[0].shippingShare, 100);
    assert.equal(result.items[1].shippingShare, 0);
    assert.equal(result.items[0].brand, 'Sypik');
});

test('reprices balls at 21, 50, and 100 quantities and keeps shipping exactly once', () => {
    assert.deepEqual([21, 50, 100].map(quantity => priceOrder([
        { id: `ball-${quantity}`, name: 'Court Ball', category: 'balls', quantity, unitPrice: 100 }
    ]).items[0].unitPrice), [90, 80, 70]);

    const reassigned = priceOrder([
        { id: 'ball', name: 'Court Ball', category: 'balls', quantity: 10, unitPrice: 100 }
    ], { discount: { type: 'percent', value: 10 }, shippingFee: 100, shippingLineId: 'removed-shirt' });

    assert.equal(reassigned.items[0].shippingShare, 100);
    assert.equal(reassigned.total, 1000);
});

test('caps fixed vouchers and allocates percent rounding deterministically to the earliest remainder lines', () => {
    const fixed = priceOrder([
        { id: 'a', name: 'A', quantity: 1, unitPrice: 5 },
        { id: 'b', name: 'B', quantity: 1, unitPrice: 5 }
    ], { discount: { type: 'fixed', value: 20 } });
    assert.equal(fixed.discountAmount, 10);
    assert.deepEqual(fixed.items.map(item => item.amount), [0, 0]);

    const rounded = priceOrder([
        { id: 'a', name: 'A', quantity: 1, unitPrice: 0.01 },
        { id: 'b', name: 'B', quantity: 1, unitPrice: 0.01 },
        { id: 'c', name: 'C', quantity: 1, unitPrice: 0.01 }
    ], { discount: { type: 'percent', value: 50 } });
    assert.equal(rounded.discountAmount, 0.02);
    assert.deepEqual(rounded.items.map(item => item.discountShare), [0.01, 0.01, 0]);
    assert.equal(rounded.total, 0.01);
});

test('legacy snapshotless rows preserve saved fixed discounts and infer shipping and rush settings conservatively', () => {
    const rows = [
        {
            id: 'shirt',
            amount: 930,
            details: {
                itemName: 'Court Shirt',
                category: 'shirts',
                quantity: 2,
                unitPrice: 350,
                originalAmount: 700,
                discountShare: 70,
                shippingDetails: { shippingFee: 100, rushFee: 200, isRushOrder: true }
            }
        },
        {
            id: 'ball',
            amount: 900,
            details: {
                itemName: 'Court Ball',
                category: 'balls',
                quantity: 10,
                unitPrice: 100,
                originalAmount: 1000,
                discountShare: 100,
                shippingDetails: { shippingFee: 100, rushFee: 0, isRushOrder: true }
            }
        }
    ];

    const options = getOrderPricingOptions(rows);
    assert.deepEqual(options.discount, { type: 'fixed', value: 170 });
    assert.equal(options.legacyDiscount, true);
    assert.equal(options.shippingFee, 100);
    assert.equal(options.isRushOrder, true);
    assert.equal(options.rushFeePerShirt, 100);
    assert.equal(options.shippingLineId, 'shirt');

    const repriced = priceOrder([
        { id: 'ball', name: 'Court Ball', category: 'balls', quantity: 10, unitPrice: 100 }
    ], options);
    assert.equal(repriced.discountAmount, 170);
    assert.equal(repriced.total, 930);
});

test('rejects invalid quantities and prices, and keeps explicit line adjustments in totals', () => {
    assert.throws(() => getBallUnitPrice(0), /positive safe integer/);
    assert.throws(() => getCartUnitPrice({ name: 'Broken Shirt', price: -1, quantity: 1 }), /non-negative/);
    assert.throws(() => priceOrder([{ id: 'bad', name: 'Broken', quantity: 0, unitPrice: 1 }]), /positive safe integer/);
    assert.throws(() => priceOrder([{ id: 'bad', name: 'Broken', quantity: 1, unitPrice: 1, priceAdjustment: -2 }]), /cannot be negative/);

    const adjusted = priceOrder([
        { id: 'shirt', name: 'Court Shirt', category: 'shirts', quantity: 2, unitPrice: 350, priceAdjustment: -30 }
    ], { discount: { type: 'percent', value: 10 }, shippingFee: 100, isRushOrder: true, rushFeePerShirt: 100 });

    assert.equal(adjusted.items[0].amount, 900);
    assert.equal(adjusted.total, 900);
});
