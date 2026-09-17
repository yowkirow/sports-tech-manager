import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useBrands, useProducts } from '../src/hooks/useInventory.js';
import { reconstructBrands, reconstructProducts } from '../src/lib/publicCatalog.js';

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
