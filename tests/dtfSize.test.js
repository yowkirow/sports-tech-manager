import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_HEIGHT_IN, MAX_WIDTH_IN, MIN_SIZE_IN, clampWidth, sizeProblem, widthLimits } from '../src/lib/dtfSize.js';

// The sheet's own rounding of a height for a width (src/components/Dtf/fields.jsx heightOf).
const heightAt = (widthIn, ratio) => Math.round(widthIn * ratio * 1000) / 1000;

test('a design\'s width range follows from its shape, so neither side leaves the gallery\'s limits', () => {
    assert.deepEqual(widthLimits(1), { min: MIN_SIZE_IN, max: MAX_WIDTH_IN });
    // Four times as tall as wide: 120 in tall caps the width at 30 in.
    assert.deepEqual(widthLimits(4), { min: MIN_SIZE_IN, max: MAX_HEIGHT_IN / 4 });
    // A quarter as tall as wide: 0.1 in tall needs 0.4 in of width.
    assert.deepEqual(widthLimits(0.25), { min: 0.4, max: MAX_WIDTH_IN });
    assert.deepEqual(widthLimits(1000), { min: MIN_SIZE_IN, max: 0.12 });
    for (const ratio of [2000, 0.0001, 0, -1, NaN, Infinity]) assert.equal(widthLimits(ratio), null, String(ratio));
});

test('any width inside the range gives a size the gallery takes, at either end and in between', () => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let run = 0; run < 2000; run++) {
        const ratio = Math.exp((random() - 0.5) * 14);
        const limits = widthLimits(ratio);
        if (!limits) continue;
        for (const widthIn of [limits.min, limits.max, limits.min + (limits.max - limits.min) * random()]) {
            assert.equal(sizeProblem(widthIn, heightAt(widthIn, ratio)), null, `ratio ${ratio}, width ${widthIn}`);
        }
    }
});

test('a width outside its range is moved to the nearest end', () => {
    assert.equal(clampWidth(80, 1), MAX_WIDTH_IN);
    assert.equal(clampWidth(0.05, 1), MIN_SIZE_IN);
    assert.equal(clampWidth(40, 4), 30);
    assert.equal(clampWidth(0.2, 0.25), 0.4);
    assert.equal(clampWidth(3.5, 0.5), 3.5);
    assert.equal(clampWidth(3.5, 2000), 3.5, 'nothing fits, so nothing moves');
});

test('sizes are checked in whole thousandths of an inch, as the server stores them', () => {
    assert.equal(sizeProblem(3.5, 2.1), null);
    assert.equal(sizeProblem(0.0995, 1), null, 'rounds up to 0.1 in');
    assert.match(sizeProblem(0.0994, 1), /too thin/);
    assert.match(sizeProblem(2, 0.05), /too thin/);
    assert.match(sizeProblem(60.001, 1), /wider than 60 in/);
    assert.equal(sizeProblem(60.0004, 120.0004), null);
    assert.match(sizeProblem(10, 120.001), /taller than 120 in/);
    assert.match(sizeProblem(NaN, 1), /too thin/);
});
