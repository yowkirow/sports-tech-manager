import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FLAT_SHIPPING, MAX_BALL_TIERS, ballFee, ballShippingTiers, currentBallTiers, savedShippingPlan, shippingFor, shippingPlan
} from '../src/lib/shippingRates.js';

// Synthetic rates, not the shop's.
const RATES = { balls: [{ from: 21, mm: 220, provincial: 340 }, { from: 1, mm: 150, provincial: 260 }, { from: 50, mm: 300, provincial: 450 }] };
const shirt = quantity => ({ name: 'Team Shirt', category: 'shirts', quantity });
const ball = quantity => ({ name: 'Practice Ball', category: 'balls', quantity });

test('ball rates read sorted from the first ball, and anything malformed reads as no rates', () => {
    assert.deepEqual(ballShippingTiers(RATES), [
        { from: 1, mm: 150, provincial: 260 }, { from: 21, mm: 220, provincial: 340 }, { from: 50, mm: 300, provincial: 450 }
    ]);
    const malformed = [
        null, {}, { balls: [] }, { balls: 'x' },
        { balls: [{ from: 2, mm: 100, provincial: 100 }] },
        { balls: [{ from: 1, mm: 100, provincial: 100 }, { from: 1, mm: 120, provincial: 120 }] },
        { balls: [{ from: 1, mm: 99.5, provincial: 100 }] },
        { balls: [{ from: 1, mm: -1, provincial: 100 }] },
        { balls: [{ from: 1, mm: '100', provincial: 100 }] },
        { balls: [{ from: 1, mm: 100, provincial: 100_001 }] },
        { balls: [{ from: 1.5, mm: 100, provincial: 100 }] },
        { balls: Array.from({ length: MAX_BALL_TIERS + 1 }, (_, index) => ({ from: index + 1, mm: 100, provincial: 100 })) }
    ];
    for (const details of malformed) assert.deepEqual(ballShippingTiers(details), [], JSON.stringify(details));
});

test('the newest shipping_rates record is the one in force, and an empty one turns ball rates off', () => {
    const feed = [
        { type: 'sale', details: {} },
        { type: 'shipping_rates', details: RATES },
        { type: 'shipping_rates', details: { balls: [{ from: 1, mm: 1, provincial: 1 }] } }
    ];
    assert.equal(currentBallTiers(feed).length, 3);
    assert.deepEqual(currentBallTiers([{ type: 'shipping_rates', details: { balls: [] } }, ...feed]), []);
    assert.deepEqual(currentBallTiers([]), []);
});

test('each area has its own flat fee and ball fees, and a count pays the last tier it reaches', () => {
    const tiers = ballShippingTiers(RATES);
    assert.deepEqual(shippingPlan(tiers, 'MM'), { flatFee: 100, ballTiers: [{ from: 1, fee: 150 }, { from: 21, fee: 220 }, { from: 50, fee: 300 }] });
    assert.equal(shippingPlan(tiers, 'Provincial').flatFee, FLAT_SHIPPING.Provincial);
    assert.throws(() => shippingPlan(tiers, 'Visayas'), /region/);
    const { ballTiers } = shippingPlan(tiers, 'Provincial');
    assert.deepEqual([1, 20, 21, 49, 50, 500].map(count => ballFee(ballTiers, count)), [260, 260, 340, 340, 450, 450]);
});

test('balls pay their own shipping on top of the flat fee for the rest; with no rates the flat fee covers all', () => {
    const plan = shippingPlan(ballShippingTiers(RATES), 'MM');
    assert.deepEqual(shippingFor([shirt(2)], plan), { flat: 100, balls: 0, ballCount: 0, total: 100 });
    assert.deepEqual(shippingFor([ball(12)], plan), { flat: 0, balls: 150, ballCount: 12, total: 150 }, 'only balls: only ball shipping');
    assert.deepEqual(shippingFor([shirt(1), ball(10), ball(15)], plan), { flat: 100, balls: 220, ballCount: 25, total: 320 });
    assert.deepEqual(shippingFor([], plan), { flat: 0, balls: 0, ballCount: 0, total: 0 });
    const flat = shippingPlan([], 'Provincial');
    assert.deepEqual(shippingFor([ball(100)], flat), { flat: 200, balls: 0, ballCount: 0, total: 200 }, 'no rates: the flat fee, as before');
    assert.equal(shippingFor([shirt(1), ball(3)], flat).total, 200);
});

test('a plan saved with an order reads back only when it holds together', () => {
    const plan = shippingPlan(ballShippingTiers(RATES), 'Provincial');
    assert.deepEqual(savedShippingPlan(JSON.parse(JSON.stringify(plan))), plan);
    assert.deepEqual(savedShippingPlan({ flatFee: 200, ballTiers: [{ from: 21, fee: 340 }, { from: 1, fee: 260 }] }).ballTiers.map(tier => tier.from), [1, 21]);
    for (const value of [undefined, null, 'x', { flatFee: 200, ballTiers: [] }, { flatFee: -1, ballTiers: plan.ballTiers },
        { flatFee: 200, ballTiers: [{ from: 2, fee: 1 }] }, { flatFee: 200, ballTiers: [{ from: 1, fee: 1.5 }] }]) {
        assert.equal(savedShippingPlan(value), null, JSON.stringify(value));
    }
});
