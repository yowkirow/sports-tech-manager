import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHIPPABLE_STATUSES, bookedNotShipped, lbcCopyText, lbcReceiver, localMobile, mobileForLbc, normalizeLbcNumber, parcelTrackingUrl, plainLabelCode, receiverAddress, sameLbcCode, shippedWith, withBookingNumber, withTrackingNumber } from '../src/lib/lbcBooking.js';

const order = (details, customerName = details.customerName || 'Unknown') => ({ customerName, items: [{ details }] });

test('LBC receiver details come from the order, including legacy fields, without guessing', () => {
    const current = lbcReceiver(order({
        customerName: ' Maria Santos ', shippingDetails: { contactNumber: '+63 917 123 4567', address: '12 Jupiter St.',
            barangay: 'Poblacion', city: 'City of Makati', province: 'Metro Manila' }
    }));
    assert.deepEqual(current, { name: 'Maria Santos', mobile: '+63 917 123 4567', street: '12 Jupiter St.',
        barangay: 'Poblacion', city: 'City of Makati', province: 'Metro Manila' });
    const legacy = lbcReceiver(order({ customerName: 'Jun', customerContact: '09998887777', customerAddress: 'Lot 4',
        customerBarangay: 'Lahug', customerCity: 'Cebu City', customerProvince: 'Cebu', shippingDetails: { address: '', city: '' } }));
    assert.deepEqual(legacy, { name: 'Jun', mobile: '09998887777', street: 'Lot 4', barangay: 'Lahug', city: 'Cebu City', province: 'Cebu' });
    assert.deepEqual(lbcReceiver({}), { name: '', mobile: '', street: '', barangay: '', city: '', province: '' });
});

test('mobile numbers copy in the form LBC expects and stay readable in the block', () => {
    for (const value of ['09171234567', '+639171234567', '639171234567', '9171234567', '0917-123-4567', '+63 (917) 123 4567']) {
        assert.equal(mobileForLbc(value), '9171234567', value);
        assert.equal(localMobile(value), '09171234567', value);
    }
    assert.equal(localMobile('landline 8123-4567'), 'landline 8123-4567');
    assert.equal(mobileForLbc(undefined), '');
});

test('the copy-all block lists name, mobile and one-line address, leaving out missing parts', () => {
    const receiver = { name: 'Maria Santos', mobile: '+639171234567', street: '12 Jupiter St.', barangay: 'Poblacion', city: 'City of Makati', province: 'Metro Manila' };
    assert.equal(lbcCopyText(receiver), 'Name: Maria Santos\nMobile: 09171234567\nAddress: 12 Jupiter St., Poblacion, City of Makati, Metro Manila');
    assert.equal(lbcCopyText({ ...receiver, mobile: '', street: '', barangay: '' }), 'Name: Maria Santos\nAddress: City of Makati, Metro Manila');
    assert.equal(receiverAddress({ street: '', barangay: '', city: '', province: '' }), '');
    assert.equal(lbcCopyText({ name: '', mobile: '', street: '', barangay: '', city: '', province: '' }), '');
});

test('pasted LBC numbers are cleaned, and LBC links become their number', () => {
    assert.equal(normalizeLbcNumber('  123456789012 \n'), '123456789012');
    assert.equal(normalizeLbcNumber('1234\t5678\n9012'), '1234 5678 9012');
    assert.equal(normalizeLbcNumber('https://www.lbcexpress.com/track/?tracking_no=123456789012'), '123456789012');
    assert.equal(normalizeLbcNumber('https://lbcexpress.com/track/?tracking_no=%20AB12%20'), 'AB12');
    // Other links are kept as typed (the owner still sees them); staff never see them.
    const other = 'https://www.lalamove.com/track?order=ABC';
    assert.equal(normalizeLbcNumber(other), other);
    assert.equal(plainLabelCode(normalizeLbcNumber(other)), null);
    assert.equal(normalizeLbcNumber(''), '');
    assert.equal(normalizeLbcNumber(null), '');
});

test('the staff label rule matches migration 0013: plain codes only', () => {
    for (const [value, expected] of [
        ['123456789012', '123456789012'], [' AB-1234 5678 ', 'AB-1234 5678'], ['ABCD', 'ABCD'], ['x'.repeat(40), 'x'.repeat(40)],
        ['ABC', null], ['x'.repeat(41), null], ['https://www.lbcexpress.com/track', null], ['0917 / Makati', null],
        ['1234\n5678', null], [12345678, null], ['', null], [null, null]
    ]) assert.equal(plainLabelCode(value), expected, JSON.stringify(value));
});

test('the booking number never changes the order status', () => {
    const details = { fulfillmentStatus: 'in_progress', status: 'in_progress', customerName: 'Maria', trackingNumber: '', items: [{ size: 'M' }] };
    const booked = withBookingNumber(details, 'BK-2026-0001');
    assert.deepEqual(booked, { ...details, bookingNumber: 'BK-2026-0001' });
    assert.notEqual(booked, details);
    // A corrected tracking number on a shipped order keeps the status too.
    const shipped = { ...details, fulfillmentStatus: 'shipped', status: 'shipped', trackingNumber: '123456789012' };
    assert.deepEqual(withTrackingNumber(shipped, '123456789013'), { ...shipped, trackingNumber: '123456789013' });
});

test('the tracking number is saved together with Shipped, and shipping without one keeps the booking number', () => {
    const details = { fulfillmentStatus: 'ready', status: 'ready', bookingNumber: 'BK-1', customerName: 'Maria' };
    assert.deepEqual(shippedWith(details, '123456789012'),
        { ...details, trackingNumber: '123456789012', fulfillmentStatus: 'shipped', status: 'shipped' });
    assert.deepEqual(shippedWith({ ...details, trackingNumber: 'OLD-1' }, ''),
        { ...details, trackingNumber: 'OLD-1', fulfillmentStatus: 'shipped', status: 'shipped' });
    assert.deepEqual(shippedWith(details, ''), { ...details, fulfillmentStatus: 'shipped', status: 'shipped' });
    assert.deepEqual(SHIPPABLE_STATUSES, ['pending', 'in_progress', 'ready']);
});

test('customers follow a plain tracking code on LBC, or a saved courier link as it is', () => {
    assert.equal(parcelTrackingUrl('123456789012'), 'https://www.lbcexpress.com/track/?tracking_no=123456789012');
    assert.equal(parcelTrackingUrl(' 1224 8001-5678 '), 'https://www.lbcexpress.com/track/?tracking_no=122480015678');
    assert.equal(parcelTrackingUrl('https://www.lalamove.com/track?order=ABC'), 'https://www.lalamove.com/track?order=ABC');
    for (const value of ['', null, 'ABC', 'javascript:alert(1)', 'ftp://x.example/1', '0917 / Makati', 'https://a.example/with space']) {
        assert.equal(parcelTrackingUrl(value), null, JSON.stringify(value));
    }
});

test('booked, not shipped: a booking number on an order that can still ship, read once per grouped order', () => {
    const grouped = (fulfillmentStatus, bookingNumber, lines = 1) => ({ fulfillmentStatus,
        items: Array.from({ length: lines }, () => ({ details: { bookingNumber } })) });
    for (const status of SHIPPABLE_STATUSES) assert.equal(bookedNotShipped(grouped(status, 'BK-2026-0001')), true, status);
    for (const status of ['shipped', 'returned', 'cancelled']) assert.equal(bookedNotShipped(grouped(status, 'BK-2026-0001')), false, status);
    for (const missing of ['', '   ', undefined, null]) assert.equal(bookedNotShipped(grouped('ready', missing)), false, JSON.stringify(missing));
    // An order saved as two rows is one order: the count is per order, never per line.
    const orders = [grouped('ready', 'BK-1', 2), grouped('in_progress', 'BK-2'), grouped('shipped', 'BK-3', 3), grouped('ready', '')];
    assert.equal(orders.filter(bookedNotShipped).length, 2);
    assert.equal(bookedNotShipped(null), false);
    assert.equal(bookedNotShipped({ fulfillmentStatus: 'ready', items: [] }), false);
});

test('the booking number pasted where the tracking number goes is recognised however it is typed', () => {
    assert.equal(sameLbcCode('bk 2026 0001', 'BK-2026-0001'), true);
    assert.equal(sameLbcCode('1224-8001-5678', '1224 8001 5678'), true);
    assert.equal(sameLbcCode('1224 8001 5678', 'BK-2026-0001'), false);
    assert.equal(sameLbcCode('', ''), false);
    assert.equal(sameLbcCode(' - ', ''), false);
    assert.equal(sameLbcCode('123', undefined), false);
});
