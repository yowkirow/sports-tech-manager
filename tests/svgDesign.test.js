import assert from 'node:assert/strict';
import test from 'node:test';
import {
    designNameFromFile, externalUrl, heightFor, lengthInInches, parseLength, parseViewBox, renameReferences, specificity,
    splitSelectors, trimViewBox, visibleBounds
} from '../src/lib/svgDesign.js';
import { layoutSheets } from '../src/lib/dtfLayout.js';
import { sheetFileName, sheetPixels, stripSvg } from '../src/lib/dtfExport.js';

test('an SVG\'s width converts to inches from any real unit; plain numbers are CSS pixels', () => {
    for (const [text, expected] of [['3in', 3], ['25.4mm', 1], ['2.54cm', 1], ['101.6q', 1], ['72pt', 1], ['6pc', 1],
        ['96px', 1], ['96', 1], [' 192 ', 2], ['1e2', 100 / 96], ['.5in', 0.5]]) {
        assert.ok(Math.abs(lengthInInches(text) - expected) < 1e-12, `${text} → ${lengthInInches(text)}`);
    }
    for (const text of ['50%', '1em', '2ex', '-3in', '0', '', null, 'auto', '3 in in']) assert.equal(lengthInInches(text), null, String(text));
    assert.deepEqual(parseLength('12.5MM'), { number: 12.5, unit: 'mm' });
});

test('a viewBox has four numbers and a positive size', () => {
    assert.deepEqual(parseViewBox('0 0 100 50'), [0, 0, 100, 50]);
    assert.deepEqual(parseViewBox(' 10,20  30 , 40 '), [10, 20, 30, 40]);
    for (const text of ['0 0 0 5', '0 0 -1 5', '0 0 5', 'a b c d', '', null, '0 0 1 1 1']) assert.equal(parseViewBox(text), null, String(text));
});

test('trimming keeps the visible artwork plus one pixel, inside the original box', () => {
    const raster = { width: 1024, height: 512 };
    assert.deepEqual(trimViewBox([0, 0, 200, 100], { left: 100, top: 50, right: 924, bottom: 462 }, raster),
        [19.3359375, 9.5703125, 161.328125, 80.859375]);
    assert.deepEqual(trimViewBox([5, -5, 200, 100], { left: 0, top: 0, right: 1024, bottom: 512 }, raster), [5, -5, 200, 100]);
    const pixels = new Uint8ClampedArray(4 * 3 * 4);
    assert.equal(visibleBounds(pixels, 4, 3), null);
    pixels[(1 * 4 + 2) * 4 + 3] = 1;
    assert.deepEqual(visibleBounds(pixels, 4, 3), { left: 2, top: 1, right: 3, bottom: 2 });
    pixels[(2 * 4 + 0) * 4 + 3] = 255;
    assert.deepEqual(visibleBounds(pixels, 4, 3), { left: 0, top: 1, right: 3, bottom: 3 });
});

test('the print height follows the design\'s shape, and names come from the file', () => {
    assert.equal(heightFor(3.5, [0, 0, 350, 210]), 2.1);
    assert.equal(heightFor(10, [0, 0, 3, 1]), 3.333);
    assert.equal(designNameFromFile('front-logo_v2.svg'), 'front logo v2');
    assert.equal(designNameFromFile('  Crest.SVG'), 'Crest');
    assert.equal(designNameFromFile('.svg'), 'Design');
    assert.equal(designNameFromFile(`${'x'.repeat(200)}.svg`).length, 120);
});

test('a design\'s CSS is ranked like the browser would', () => {
    assert.deepEqual(splitSelectors('.a, .b:not(.c, .d), [x="1,2"] , path'), ['.a', '.b:not(.c, .d)', '[x="1,2"]', 'path']);
    assert.deepEqual(specificity('.cls-1'), [0, 1, 0]);
    assert.deepEqual(specificity('g.cls-1'), [0, 1, 1]);
    assert.deepEqual(specificity('#a .b > path::before'), [1, 1, 2]);
    assert.deepEqual(specificity('rect:first-child[fill="a.b"]'), [0, 2, 1]);
    assert.deepEqual(specificity('*'), [0, 0, 0]);
    const rename = new Map([['a', 'd1-a'], ['b', 'd1-b']]);
    assert.equal(renameReferences('fill:url(#a);stroke:url( "#b" );mask:url(#z)', rename), 'fill:url(#d1-a);stroke:url(#d1-b);mask:url(#z)');
});

test('a link inside the file is kept however it is quoted; a link to another file is caught', () => {
    // The browser writes back every link it read from a stylesheet as url("#id"), so the quotes must not hide the #.
    for (const value of ['fill:url(#a)', 'fill:url("#a")', "fill:url('#a')", 'clip-path:url( "#clip-path" )', 'fill:url("#a") rgb(225, 29, 72)']) {
        assert.equal(externalUrl(value), false, value);
    }
    for (const value of ['fill:url(https://example.invalid/p.svg#a)', 'fill:url("https://example.invalid/p")', "mask:url('other.svg#m')",
        'fill:url("#a");stroke:url(//example.invalid/b)', 'fill:URL( "data:image/png;base64,AAAA" )']) {
        assert.equal(externalUrl(value), true, value);
    }
});

test('a sheet file is named by date, sheet number and size', () => {
    const date = new Date(2026, 10, 9);
    assert.equal(sheetFileName({ date, index: 0, count: 2, widthIn: 22, lengthIn: 39 }), 'dtf-2026-11-09-sheet-1-of-2-22x39in.png');
    assert.equal(sheetFileName({ date, index: 2, count: 3, widthIn: 22.5, lengthIn: 19.505 }), 'dtf-2026-11-09-sheet-3-of-3-22.5x19.51in.png');
});

test('a 22 x 39 in sheet is 6600 x 11700 px at 300 DPI, and each strip holds only the designs that reach into it', () => {
    const layout = layoutSheets([{ key: 'crest', designId: 'crest', name: 'Crest', widthIn: 3.5, heightIn: 2, quantity: 6 }]);
    const pixels = sheetPixels(layout.sheets[0], layout.settings);
    assert.deepEqual([pixels.width, pixels.height], [6600, 11700]);
    assert.deepEqual(pixels.placements[0], { designId: 'crest', x: 225, y: 3500, width: 1050, height: 600 });
    const parts = new Map([['crest', { viewBox: [0, 0, 350, 200], inner: '<g xmlns="http://www.w3.org/2000/svg"><rect width="350" height="200"/></g>' }]]);
    const empty = stripSvg({ width: 6600, top: 0, height: 512, placements: pixels.placements, parts });
    assert.equal(empty.count, 0);
    assert.equal(empty.svg, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="6600" height="512" viewBox="0 0 6600 512"></svg>');
    const strip = stripSvg({ width: 6600, top: 3584, height: 512, placements: pixels.placements, parts });
    assert.equal(strip.count, 5, 'the first row of five reaches into this strip');
    assert.match(strip.svg, /^<svg [^>]*width="6600" height="512" viewBox="0 3584 6600 512">/);
    assert.match(strip.svg, /<svg x="225" y="3500" width="1050" height="600" viewBox="0 0 350 200" preserveAspectRatio="xMidYMid meet"><g /);
    assert.equal(stripSvg({ width: 6600, top: 3000, height: 500, placements: pixels.placements, parts }).count, 0, 'ends exactly where the row starts');
    assert.throws(() => stripSvg({ width: 6600, top: 3584, height: 512, placements: pixels.placements, parts: new Map() }), /missing/);
});
