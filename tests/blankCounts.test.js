import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BLANK_COUNT, blankTotals, countedWhen, currentBlankCount, readBlankCount, rowTotal, suggestedBlankColors
} from '../src/lib/blankCounts.js';

const sizes = (patch = {}) => ({ XS: 0, S: 6, M: 8, L: 15, XL: 6, '2XL': 9, ...patch });
const board = (patch = {}) => ({ rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }, { color: 'Kiwi', sizes: sizes({ S: 2, L: 0 }) }], ...patch });

test('a count is a whole board: each color once, every size XS to 2XL as a whole number', () => {
    assert.deepEqual(readBlankCount({ ...board({ note: ' After restock ' }), createdBy: 'owner@example.invalid' }), {
        rows: [{ color: 'Black', hex: '#000000', sizes: sizes() }, { color: 'Kiwi', hex: null, sizes: sizes({ S: 2, L: 0 }) }],
        note: 'After restock'
    });
    const row = patch => board({ rows: [{ color: 'Black', sizes: sizes(), ...patch }] });
    for (const [label, details] of [
        ['no colors', board({ rows: [] })],
        ['a color twice', board({ rows: [{ color: 'Black', sizes: sizes() }, { color: 'black', sizes: sizes() }] })],
        ['a missing size', row({ sizes: { XS: 0, S: 1, M: 1, L: 1, XL: 1 } })],
        ['an unknown size', row({ sizes: { ...sizes(), '3XL': 1 } })],
        ['a negative count', row({ sizes: sizes({ M: -1 }) })],
        ['a fraction', row({ sizes: sizes({ M: 1.5 }) })],
        ['a text number', row({ sizes: sizes({ M: '8' }) })],
        ['too many', row({ sizes: sizes({ M: 100_001 }) })],
        ['an untrimmed color', row({ color: ' Black' })],
        ['a bad swatch', row({ hex: 'black' })],
        ['an extra field', row({ cost: 70 })],
        ['a long note', board({ note: 'x'.repeat(201) })],
        ['61 colors', board({ rows: Array.from({ length: 61 }, (_, index) => ({ color: `Color ${index}`, sizes: sizes() })) })]
    ]) {
        assert.equal(readBlankCount(details), null, label);
    }
    assert.equal(readBlankCount(null), null);
});

test('the newest count in the feed is the board, with totals by color, by size and overall', () => {
    const feed = [
        { id: 'sale', type: 'sale', date: '2026-11-11T08:00:00Z', details: {} },
        { id: 'new', type: BLANK_COUNT, date: '2026-11-11T07:00:00Z', details: board() },
        { id: 'old', type: BLANK_COUNT, date: '2026-11-01T07:00:00Z', details: board({ rows: [{ color: 'White', sizes: sizes() }] }) }
    ];
    const count = currentBlankCount(feed);
    assert.equal(count.countedAt, '2026-11-11T07:00:00Z');
    assert.deepEqual(count.rows.map(row => [row.color, rowTotal(row)]), [['Black', 44], ['Kiwi', 25]]);
    assert.deepEqual(blankTotals(count.rows), { sizes: { XS: 0, S: 8, M: 16, L: 15, XL: 12, '2XL': 18 }, total: 69 });
    assert.equal(currentBlankCount([]), null);
});

test('when a count was saved reads in Philippine time', () => {
    const now = new Date('2026-11-11T15:30:00Z'); // 11:30 PM on Nov 11 in Manila
    assert.equal(countedWhen('2026-11-11T15:09:00Z', now), 'today at 11:09 PM');
    assert.equal(countedWhen('2026-11-10T16:00:00Z', now), 'today at 12:00 AM', 'midnight in Manila is still today');
    assert.equal(countedWhen('2026-11-10T15:59:00Z', now), 'yesterday at 11:59 PM');
    assert.equal(countedWhen('2026-11-03T04:00:00Z', now), 'Nov 3 (8 days ago)');
    assert.equal(countedWhen('2025-11-03T04:00:00Z', now), 'Nov 3, 2025 (373 days ago)');
    assert.equal(countedWhen('2026-11-12T01:00:00Z', now), 'today at 9:00 AM', 'a clock running behind is not a future day');
});

test('a first count starts from the colors the shop’s shirts use, most-used first', () => {
    const colors = [{ name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#000000' }, { name: 'Kiwi', hex: '#bef264' }, { name: 'Test', hex: 'oops' }];
    const products = [
        { linkedColor: 'White', category: 'shirts' }, { linkedColor: 'Black' }, { linkedColor: 'black', category: 'shirts' },
        { linkedColor: 'Black', category: 'accessories' }, { linkedColor: 'Peach', category: 'shirts' }, { linkedColor: ' ' }
    ];
    assert.deepEqual(suggestedBlankColors(products, colors), [
        { color: 'Black', hex: '#000000' }, { color: 'Peach', hex: null }, { color: 'White', hex: '#ffffff' }
    ]);
    assert.deepEqual(suggestedBlankColors([], colors).map(row => row.color), ['White', 'Black', 'Kiwi', 'Test']);
    assert.equal(suggestedBlankColors([], colors).at(-1).hex, null);
});
