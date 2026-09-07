import assert from 'node:assert/strict';
import test from 'node:test';
import { getInventoryRows, getStockKey } from '../src/lib/inventory.js';

const stockById = (transactions) => Object.fromEntries(
    getInventoryRows(transactions).map(row => [row.id, row])
);

test('normalizes nested and flat stock movements with canonical keys', () => {
    const rows = stockById([
        {
            id: 'sale-flat',
            type: 'sale',
            category: 'shirts',
            amount: 350,
            date: '2026-09-01T10:00:00Z',
            details: {
                itemName: 'Court Shirt',
                brand: '  SyPik ',
                linkedColor: ' White ',
                size: ' M ',
                quantity: '1'
            }
        },
        {
            id: 'expense-flat',
            type: 'expense',
            category: 'blanks',
            amount: 140,
            date: '2026-09-01T09:00:00Z',
            details: {
                brand: 'sypik',
                linkedColor: 'white',
                size: 'm',
                quantity: '3'
            }
        }
    ]);

    assert.equal(rows['shirt-sypik-white-m'].count, 2);
    assert.deepEqual(rows['shirt-sypik-white-m'].transactionIds.sort(), ['expense-flat', 'sale-flat']);
});

test('counts nested shirts and accessories while preserving zero and string quantities', () => {
    const rows = stockById([
        {
            id: 'stock-balls',
            type: 'expense',
            category: 'accessories',
            amount: 500,
            date: '2026-09-01T08:00:00Z',
            details: { subCategory: '  Paddle Balls  ', quantity: '10' }
        },
        {
            id: 'stock-zero',
            type: 'update_stock',
            category: 'blanks',
            amount: 0,
            date: '2026-09-01T08:30:00Z',
            details: { brand: 'Sypik', linkedColor: 'Black', size: 'L', quantity: '0' }
        },
        {
            id: 'sale-pos',
            type: 'sale',
            category: 'Sales',
            amount: 800,
            date: '2026-09-01T10:00:00Z',
            details: {
                customerName: 'Buyer',
                items: [
                    { itemName: 'Court Shirt', brand: 'Sypik', category: 'shirts', linkedColor: 'Black', size: 'L', quantity: '2' },
                    { itemName: 'Paddle Balls', category: 'balls', quantity: '3', price: 100 }
                ]
            }
        }
    ]);

    assert.equal(rows['shirt-sypik-black-l'].count, -2);
    assert.equal(rows['acc-paddle-balls'].count, 7);
});

test('ignores system and service events while keeping returned sale stock unchanged', () => {
    const rows = stockById([
        {
            id: 'stock-shirt',
            type: 'expense',
            category: 'blanks',
            amount: 70,
            date: '2026-09-01T08:00:00Z',
            details: { brand: 'Sypik', linkedColor: 'Kiwi', size: 'S', quantity: 1 }
        },
        {
            id: 'system-event',
            type: 'define_product',
            category: 'system',
            amount: 0,
            date: '2026-09-01T08:30:00Z',
            details: { name: 'Ignore Me' }
        },
        {
            id: 'ads-event',
            type: 'expense',
            category: 'ads',
            amount: 120,
            date: '2026-09-01T08:40:00Z',
            details: { subCategory: 'Marketing/Ads', quantity: 99 }
        },
        {
            id: 'return-tag',
            type: 'sale',
            category: 'shirts',
            amount: 350,
            date: '2026-09-01T10:00:00Z',
            details: {
                fulfillmentStatus: 'returned',
                itemName: 'Court Shirt',
                brand: 'Sypik',
                linkedColor: 'Kiwi',
                size: 'S',
                quantity: 1
            }
        },
        {
            id: 'legacy-return-event',
            type: 'return',
            category: 'return',
            amount: 0,
            date: '2026-09-01T11:00:00Z',
            details: {
                itemName: 'Court Shirt',
                brand: 'Sypik',
                linkedColor: 'Kiwi',
                size: 'S',
                quantity: 5
            }
        }
    ]);

    assert.equal(rows['shirt-sypik-kiwi-s'].count, 0);
    assert.equal(rows['acc-marketing/ads'], undefined);
});

test('ignores removed lines from mixed order sources', () => {
    const rows = stockById([
        {
            id: 'stock-shirt',
            type: 'expense',
            category: 'blanks',
            amount: 140,
            date: '2026-09-01T08:00:00Z',
            details: { brand: 'Sypik', linkedColor: 'Black', size: 'M', quantity: 2 }
        },
        {
            id: 'sale-mixed',
            type: 'sale',
            category: 'Sales',
            amount: 700,
            date: '2026-09-01T10:00:00Z',
            details: {
                customerName: 'Buyer',
                items: [
                    { itemName: 'Active Shirt', brand: 'Sypik', category: 'shirts', linkedColor: 'Black', size: 'M', quantity: 1 },
                    { itemName: 'Removed Shirt', brand: 'Sypik', category: 'shirts', linkedColor: 'Black', size: 'M', quantity: 1, removedFromOrder: true }
                ]
            }
        }
    ]);

    assert.equal(rows['shirt-sypik-black-m'].count, 1);
});

test('marks multi-sku source history as non-deletable without affecting single-sku rows', () => {
    const rows = stockById([
        {
            id: 'stock-shirt',
            type: 'expense',
            category: 'blanks',
            amount: 140,
            date: '2026-09-01T08:00:00Z',
            details: { brand: 'Sypik', linkedColor: 'Black', size: 'M', quantity: 2 }
        },
        {
            id: 'stock-balls',
            type: 'expense',
            category: 'accessories',
            amount: 100,
            date: '2026-09-01T08:10:00Z',
            details: { subCategory: 'Paddle Balls', quantity: 5 }
        },
        {
            id: 'sale-mixed',
            type: 'sale',
            category: 'Sales',
            amount: 550,
            date: '2026-09-01T10:00:00Z',
            details: {
                items: [
                    { itemName: 'Court Shirt', brand: 'Sypik', category: 'shirts', linkedColor: 'Black', size: 'M', quantity: 1 },
                    { itemName: 'Paddle Balls', category: 'balls', quantity: 2, price: 100 }
                ]
            }
        },
        {
            id: 'sale-single',
            type: 'sale',
            category: 'shirts',
            amount: 350,
            date: '2026-09-01T11:00:00Z',
            details: {
                itemName: 'Court Shirt',
                brand: 'Sypik',
                linkedColor: 'White',
                size: 'L',
                quantity: 1
            }
        }
    ]);

    assert.equal(rows['shirt-sypik-black-m'].canDeleteHistory, false);
    assert.equal(rows['acc-paddle-balls'].canDeleteHistory, false);
    assert.equal(rows['shirt-sypik-white-l'].canDeleteHistory, true);
    assert.deepEqual(rows['shirt-sypik-black-m'].transactionIds.sort(), ['sale-mixed', 'stock-shirt']);
});

test('builds canonical stock keys for shirts and accessories', () => {
    assert.equal(
        getStockKey({ details: { category: 'shirts', brand: ' Sypik ', linkedColor: ' Baby Blue ', size: ' XL ' } }, 'shirts'),
        'shirt-sypik-baby blue-xl'
    );
    assert.equal(
        getStockKey({ details: { category: 'balls', itemName: ' Paddle Balls ' } }, 'balls'),
        'acc-paddle-balls'
    );
});
