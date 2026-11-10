import assert from 'node:assert/strict';
import test from 'node:test';
import { INCHES_PER_METER, SHEET_DEFAULTS, layoutSheets, sheetSettings, spread } from '../src/lib/dtfLayout.js';

const EPS = 1e-6;
const pick = (key, widthIn, heightIn, quantity, name = key) => ({ key, designId: `design-${key}`, name, widthIn, heightIn, quantity });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} != ${expected}`);

/** Everything the owner relies on when cutting, checked on any layout. */
function assertCuttable(layout) {
    const { widthIn, lengthIn, marginIn, gapIn } = layout.settings;
    for (const sheet of layout.sheets) {
        const items = sheet.placements;
        for (const item of items) {
            assert.ok(item.x >= marginIn - EPS && item.y >= marginIn - EPS, `inside the top-left margin: ${JSON.stringify(item)}`);
            assert.ok(item.x + item.widthIn <= widthIn - marginIn + EPS && item.y + item.heightIn <= lengthIn - marginIn + EPS,
                `inside the bottom-right margin: ${JSON.stringify(item)}`);
            const band = sheet.rows[item.row];
            assert.ok(item.y >= band.y - EPS && item.y + item.heightIn <= band.y + band.height + EPS, 'inside its row');
        }
        for (let a = 0; a < items.length; a++) {
            for (let b = a + 1; b < items.length; b++) {
                const [p, q] = [items[a], items[b]];
                const apart = Math.max(q.x - (p.x + p.widthIn), p.x - (q.x + q.widthIn), q.y - (p.y + p.heightIn), p.y - (q.y + q.heightIn));
                assert.ok(apart >= gapIn - EPS, `designs at least the minimum gap apart (${apart} < ${gapIn})`);
            }
        }
        sheet.rows.slice(1).forEach((band, index) => {
            const previous = sheet.rows[index];
            assert.ok(band.y >= previous.y + previous.height + gapIn - EPS, 'rows stack with the minimum gap');
        });
        // Every cut is a straight line that crosses no design.
        for (const cut of sheet.cuts) {
            for (const item of items) {
                if (cut.y1 === cut.y2) {
                    assert.ok(cut.y1 <= item.y + EPS || cut.y1 >= item.y + item.heightIn - EPS, 'a cut across the sheet misses every design');
                } else if (Math.max(cut.y1, item.y) < Math.min(cut.y2, item.y + item.heightIn) - EPS) {
                    assert.ok(cut.x1 <= item.x + EPS || cut.x1 >= item.x + item.widthIn - EPS, 'a cut inside a row misses every design');
                }
            }
        }
    }
}

/** The spacing is shared out evenly: equal gaps in a row, and between rows. */
function assertSpread(layout) {
    const { widthIn, lengthIn, marginIn, gapIn } = layout.settings;
    const evenOrPushed = (edges, inner, full, label) => {
        const [first, last] = edges;
        near(first, last, `${label}: both ends get the same space`);
        for (const gap of inner) near(gap, inner[0], `${label}: equal gaps`);
        if (inner.length) {
            const even = Math.abs(first - inner[0]) < 1e-6;
            const pushed = Math.abs(first - marginIn) < 1e-6 && inner[0] >= gapIn - EPS;
            assert.ok(even || pushed, `${label}: gaps equal the space to the edge, or the ends sit at the margin`);
        }
    };
    for (const sheet of layout.sheets) {
        sheet.rows.forEach((band, rowIndex) => {
            const items = sheet.placements.filter(item => item.row === rowIndex).sort((a, b) => a.x - b.x);
            const inner = items.slice(1).map((item, index) => item.x - (items[index].x + items[index].widthIn));
            evenOrPushed([items[0].x, widthIn - (items.at(-1).x + items.at(-1).widthIn)], inner, widthIn, `row ${rowIndex}`);
            for (const item of items) near(item.y - band.y, band.y + band.height - (item.y + item.heightIn), 'centered in its row');
        });
        const rows = sheet.rows;
        const inner = rows.slice(1).map((band, index) => band.y - (rows[index].y + rows[index].height));
        evenOrPushed([rows[0].y, lengthIn - (rows.at(-1).y + rows.at(-1).height)], inner, lengthIn, `sheet ${sheet.index}`);
    }
}

test('a few designs spread evenly over the whole 22 x 39 in sheet, in straight rows', () => {
    const layout = layoutSheets([pick('crest', 3.5, 2, 6)]);
    assert.deepEqual(layout.settings, SHEET_DEFAULTS);
    assert.equal(layout.sheets.length, 1);
    assert.equal(layout.meters, 1);
    const [sheet] = layout.sheets;
    assert.deepEqual(sheet.rows.map(row => row.count), [5, 1], 'five fit across 21.5 in with 0.5 in gaps');
    // Two 2 in rows share 35 in of film: 35/3 above, between and below them, the margin included.
    near(sheet.rows[0].y, 35 / 3);
    near(sheet.rows[1].y, 35 / 3 * 2 + 2);
    near(sheet.rowGapIn, 35 / 3);
    // Across: 4 in left over plus the two margins, shared by six gaps.
    assert.deepEqual(sheet.placements.filter(item => item.row === 0).map(item => +item.x.toFixed(4)), [0.75, 5, 9.25, 13.5, 17.75]);
    near(sheet.rows[0].gapIn, 0.75);
    near(sheet.placements.find(item => item.row === 1).x, 9.25, 'a lone design is centered');
    near(sheet.smallestGapIn, 0.75);
    near(sheet.usedPercent, (6 * 7) / (22 * 39) * 100);
    assertCuttable(layout);
    assertSpread(layout);
});

test('a full row keeps the minimum gap between designs and moves the outer ones to the margin', () => {
    const layout = layoutSheets([pick('back', 10.5, 12, 2)]);
    const items = layout.sheets[0].placements;
    assert.deepEqual(items.map(item => item.x), [0.25, 11.25]);
    near(layout.sheets[0].rows[0].gapIn, 0.5);
    assert.deepEqual(spread(2, 21, 22, 0.25, 0.5), { start: 0.25, gap: 0.5 });
    assert.deepEqual(spread(3, 3, 22, 0.25, 0.5), { start: 4.75, gap: 4.75 });
    assert.deepEqual(spread(1, 4, 22, 0.25, 0.5), { start: 9, gap: 0 });
    assert.deepEqual(spread(0, 0, 22, 0.25, 0.5), { start: 0.25, gap: 0 });
    assertCuttable(layout);
});

test('designs that do not fit add another one-meter sheet, with the rows balanced between sheets', () => {
    // 80.5 in of rows and gaps: more than two 38.5 in sheets hold.
    const layout = layoutSheets([pick('front', 10, 12, 10), pick('crest', 3.5, 3, 20), pick('sleeve', 3, 1, 15)]);
    assert.equal(layout.copies, 45);
    assert.equal(layout.sheets.length, 3);
    assert.equal(layout.meters, 3);
    assert.deepEqual(layout.sheets.map(sheet => sheet.rows.filter(row => row.height === 12).length), [2, 2, 1],
        'packed full, the first sheet would take three fronts and leave the last one nearly empty');
    const fills = layout.sheets.map(sheet => sheet.rows.reduce((sum, row) => sum + row.height, 0) + (sheet.rows.length - 1) * 0.5);
    assert.deepEqual(fills, [24.5, 24.5, 30.5]);
    assert.ok(layout.sheets.every(sheet => sheet.rowGapIn > 0.5), 'every sheet has more than the minimum gap between rows');
    // Copies stay together, tallest first, in pick order on the sheets.
    const order = layout.sheets.flatMap(sheet => sheet.placements.map(item => item.key));
    assert.deepEqual([...new Set(order)], ['front', 'crest', 'sleeve']);
    assert.deepEqual(order.filter(key => key === 'crest').length, 20);
    assertCuttable(layout);
    assertSpread(layout);
});

test('a design too big for the sheet is reported and left out; nothing to place gives no sheet', () => {
    const layout = layoutSheets([pick('wide', 21.6, 2, 1), pick('long', 5, 38.6, 2), pick('ok', 21.5, 38.5, 1), pick('none', 3, 3, 0), pick('bad', 0, 3, 4)]);
    assert.deepEqual(layout.tooBig.map(item => [item.key, item.reason, item.quantity]), [['wide', 'width', 1], ['long', 'length', 2]]);
    assert.equal(layout.copies, 1);
    assert.deepEqual(layout.sheets[0].placements.map(item => [item.x, item.y]), [[0.25, 0.25]]);
    assert.equal(layout.sheets[0].smallestGapIn, null);
    const empty = layoutSheets([]);
    assert.deepEqual([empty.sheets.length, empty.meters, empty.copies, empty.smallestGapIn], [0, 0, 0, null]);
});

test('the same design at two sizes is two picks, and ties are ordered by name', () => {
    const layout = layoutSheets([pick('logo-big', 10, 6, 1, 'Logo'), pick('logo-small', 3.5, 2.1, 2, 'Logo'),
        pick('b', 4, 4, 1, 'Bravo'), pick('a', 4, 4, 1, 'alpha')]);
    const keys = layout.sheets[0].placements.map(item => item.key);
    assert.deepEqual(keys, ['logo-big', 'a', 'b', 'logo-small', 'logo-small']);
    assert.ok(layout.sheets[0].placements.every(item => item.designId === `design-${item.key}`));
    assertCuttable(layout);
});

test('cut guides run across the sheet between rows, and down the middle of each gap in a row', () => {
    const layout = layoutSheets([pick('crest', 3.5, 2, 6)]);
    const [sheet] = layout.sheets;
    const across = sheet.cuts.filter(cut => cut.y1 === cut.y2);
    assert.equal(across.length, 1);
    near(across[0].y1, sheet.rows[0].y + 2 + sheet.rowGapIn / 2);
    assert.deepEqual([across[0].x1, across[0].x2], [0, 22]);
    const down = sheet.cuts.filter(cut => cut.x1 === cut.x2);
    assert.equal(down.length, 4, 'four cuts between five designs; none in the lone row');
    assert.ok(down.every(cut => cut.y1 === 0 && Math.abs(cut.y2 - across[0].y1) < EPS));
    near(down[0].x1, 0.75 + 3.5 + 0.375);
});

test('sheet settings fall back to the 22 x 39 in sheet and stay in bounds', () => {
    assert.deepEqual(sheetSettings(), { widthIn: 22, lengthIn: 39, marginIn: 0.25, gapIn: 0.5 });
    assert.deepEqual(sheetSettings({ widthIn: '24', lengthIn: '', marginIn: 'x', gapIn: -1 }), { widthIn: 24, lengthIn: 39, marginIn: 0.25, gapIn: 0 });
    assert.deepEqual(sheetSettings({ widthIn: 1, lengthIn: 999, marginIn: 9, gapIn: 9 }), { widthIn: 2, lengthIn: 400, marginIn: 0.5, gapIn: 6 });
    const half = layoutSheets([pick('crest', 3.5, 2, 1)], { lengthIn: INCHES_PER_METER / 2 });
    assert.equal(half.meters, 0.5);
});

test('any mix of sizes, sheets, margins and gaps stays cuttable and evenly spread', () => {
    // mulberry32: 32-bit integer math, so every run differs.
    let state = 20261109;
    const random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (low, high) => low + random() * (high - low);
    let multiSheet = 0;
    for (let run = 0; run < 250; run++) {
        const settings = { widthIn: between(8, 30), lengthIn: between(8, 60), marginIn: between(0, 1), gapIn: between(0, 1.5) };
        const picks = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) =>
            pick(`d${index}`, +between(0.4, 16).toFixed(3), +between(0.4, 20).toFixed(3), Math.floor(random() * 25)));
        const layout = layoutSheets(picks, settings);
        const usable = [layout.settings.widthIn - 2 * layout.settings.marginIn, layout.settings.lengthIn - 2 * layout.settings.marginIn];
        const placeable = picks.filter(item => item.quantity > 0 && item.widthIn <= usable[0] + EPS && item.heightIn <= usable[1] + EPS);
        assert.equal(layout.copies, placeable.reduce((sum, item) => sum + item.quantity, 0), `run ${run}: every copy placed`);
        assert.equal(layout.tooBig.length, picks.filter(item => item.quantity > 0).length - placeable.length);
        assertCuttable(layout);
        assertSpread(layout);
        // Balancing never costs a sheet: the count matches packing every sheet full.
        const heights = layout.sheets.flatMap(sheet => sheet.rows.map(row => row.height));
        let fewest = 0;
        let used = Infinity;
        for (const height of heights) {
            if (used + layout.settings.gapIn + height > usable[1] + EPS) { fewest += 1; used = height; }
            else used += layout.settings.gapIn + height;
        }
        assert.equal(layout.sheets.length, fewest, `run ${run}: fewest sheets`);
        if (layout.sheets.length > 1) multiSheet += 1;
    }
    assert.ok(multiSheet >= 50, `only ${multiSheet} runs needed more than one sheet`);
});
