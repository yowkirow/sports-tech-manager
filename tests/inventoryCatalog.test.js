import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useBrands, useProducts } from '../src/hooks/useInventory.js';
import { reconstructBrands, reconstructProducts } from '../src/lib/publicCatalog.js';
import { getInventoryRows, getStockCounts } from '../src/lib/inventory.js';

test('management hooks and the public catalog reconstruct identical product and brand histories', () => {
    const history = [
        { id: 'new-shirt', type: 'define_product', details: { name: ' Court Shirt ', price: 400, order: null, brand: 'Court' } },
        { id: 'remove-cap', type: 'delete_product', details: { name: 'CAP' } },
        { id: 'brand', type: 'define_brand', details: { name: 'Court' } },
        { id: 'old-shirt', type: 'define_product', details: { name: 'court shirt', price: 350 } },
        { id: 'old-cap', type: 'define_product', details: { name: 'Cap', price: 150 } }
    ];
    let actual;
    function Probe() {
        actual = { products: useProducts(history), brands: useBrands(history) };
        return null;
    }
    renderToString(React.createElement(Probe));
    assert.deepEqual(actual, { products: reconstructProducts(history), brands: reconstructBrands(history) });
    assert.equal(actual.products.length, 1);
    assert.equal(actual.products[0].id, 'new-shirt');
    assert.equal(actual.products[0].order, null);
    assert.equal(actual.products[0].price, 400);
    assert.deepEqual(actual.brands, [{ name: 'Sypik' }, { name: 'Court' }]);
});

test('lightweight stock counts match full history normalization across legacy field precedence', () => {
    const rows = [];
    let state = 19231;
    const pick = values => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return values[state % values.length];
    };
    for (let index = 0; index < 600; index++) {
        const details = {
            category: pick(['shirts', 'blanks', 'sales', 'general', 'accessories', 'ads', 'club', 'balls', '']),
            name: pick(['Court shirt', 'Ball  Pack', '', undefined]),
            itemName: pick(['Court shirt', 'Practice Ball', '', undefined]),
            subCategory: pick(['Spare balls', '', undefined]),
            brand: pick(['Sypik', '  Six  Zero ', '', undefined]),
            size: pick(['M', ' L ', 'N/A', '', undefined]),
            color: pick(['Black', ' WHITE ', '', undefined]),
            linkedColor: pick(['Blue', '', undefined]),
            quantity: pick([0, 1, 12, '3', '', null, undefined, 'bad']),
            club: pick(['downtown-dinks', '', undefined]),
            removedFromOrder: pick([false, undefined, true])
        };
        const parent = JSON.parse(JSON.stringify(details));
        if (index % 3 === 0) {
            parent.items = [{
                name: 'Nested shirt', category: 'shirts', size: 'M', quantity: 2,
                color: 'Red', linkedColor: 'Pink', subCategory: 'Nested category', removedFromOrder: index % 2 === 0
            }, { details: { name: 'Nested ball', category: 'balls', quantity: 3 } }];
        }
        rows.push({
            id: `fixture-${index}`, type: pick(['sale', 'expense', 'update_stock', 'define_product']),
            category: pick(['shirts', 'blanks', 'general', 'sales', 'accessories']),
            amount: 1500, description: 'Fallback item', details: parent
        });
    }
    const expected = Object.fromEntries(getInventoryRows(rows).map(row => [row.id, row.count]));
    assert.deepEqual(getStockCounts(rows), expected);
});
