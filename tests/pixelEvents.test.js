import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bagContents, bagEvent, catalogIds, productView } from '../src/lib/pixelEvents.js';
import { productSlugs } from '../src/lib/productLinks.js';

const slugs = new Map([['12. White Sypik Philippines', 'white-sypik-philippines'], ['Nelson CZ-40 Pickleball', 'nelson-cz-40-pickleball']]);
const slugFor = item => slugs.get(item.name);
// Everything a cart line or checkout carries that must never reach Meta.
const buyer = { customerName: 'Juan Dela Cruz', contactNumber: '09171234567', customerEmail: 'juan@example.com',
    shippingDetails: { address: '12 Rizal St.' }, orderId: 'ST-1A2B3C4D5E6F' };

test('ViewContent names the product by its catalog slug, with its peso price', () => {
    assert.deepEqual(productView({ name: '12. White Sypik Philippines', price: '550', cost: 120, ...buyer }, 'white-sypik-philippines'), {
        content_ids: ['white-sypik-philippines'], content_type: 'product', content_name: '12. White Sypik Philippines',
        value: 550, currency: 'PHP'
    });
    assert.equal(productView({ name: 'No price' }, 'no-price').value, 0);
});

test('bag events merge sizes of one design and carry only lines, count and value', () => {
    const cart = [
        { name: '12. White Sypik Philippines', size: 'M', quantity: 2, ...buyer },
        { name: '12. White Sypik Philippines', size: 'L', quantity: 1 },
        { name: 'Nelson CZ-40 Pickleball', size: 'N/A', quantity: 20 },
        { name: 'Removed product', size: 'M', quantity: 1 },
        { name: 'Nelson CZ-40 Pickleball', size: 'N/A', quantity: 0 }
    ];
    const event = bagEvent(cart, slugFor, '2549.999');
    assert.deepEqual(event, {
        content_ids: ['white-sypik-philippines', 'nelson-cz-40-pickleball'], content_type: 'product',
        contents: [{ id: 'white-sypik-philippines', quantity: 3 }, { id: 'nelson-cz-40-pickleball', quantity: 20 }],
        num_items: 23, value: 2550, currency: 'PHP'
    });
    const sent = JSON.stringify(event);
    for (const value of ['Juan', '0917', 'juan@example.com', 'Rizal', 'ST-1A2B3C4D5E6F', 'size']) assert.ok(!sent.includes(value), value);
    assert.deepEqual(bagContents(undefined, slugFor), []);
    assert.deepEqual(bagEvent([], slugFor, Number.NaN), {
        content_ids: [], content_type: 'product', contents: [], num_items: 0, value: 0, currency: 'PHP'
    });
});

test('catalog IDs are link slugs, and the ball’s bulk-price listings count as the main ball', () => {
    // The live shop's names (2026-11-05): the Meta catalog has the ball but not its "per piece" listings.
    const products = [
        { name: 'Nelson CZ-40 Pickleball', category: 'accessories', price: 100 },
        { name: 'Nelson Balls (50-99) (Php 80 per piece)', category: 'accessories', price: 80 },
        { name: 'Nelson Balls (21-49) (Php 90 per piece)', category: 'accessories', price: 90 },
        { name: 'Nelson Balls (at least 100) (Php 70 per piece)', category: 'accessories', price: 70 },
        { name: '27 Teal Logo on Black Shirt', category: 'shirts', price: 550 }
    ];
    const ids = catalogIds(products, productSlugs(products));
    assert.deepEqual(Object.fromEntries(ids), {
        'Nelson CZ-40 Pickleball': 'nelson-cz-40-pickleball',
        'Nelson Balls (50-99) (Php 80 per piece)': 'nelson-cz-40-pickleball',
        'Nelson Balls (21-49) (Php 90 per piece)': 'nelson-cz-40-pickleball',
        'Nelson Balls (at least 100) (Php 70 per piece)': 'nelson-cz-40-pickleball',
        '27 Teal Logo on Black Shirt': 'teal-logo-on-black-shirt'
    });
    // Without a main ball listing, each listing keeps its own link slug.
    const tiersOnly = products.slice(1, 3);
    assert.deepEqual([...catalogIds(tiersOnly, productSlugs(tiersOnly)).values()], [...productSlugs(tiersOnly).values()]);
    assert.deepEqual(catalogIds(undefined, new Map()), new Map());
});
