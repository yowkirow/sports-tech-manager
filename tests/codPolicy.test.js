import assert from 'node:assert/strict';
import test from 'node:test';
import { BULK_BALL_QUANTITY, getBallUnitPrice } from '../src/lib/orderPricing.js';
import { ballCount, codAllowed, codEditProblem, isBulkBallCount } from '../src/lib/codPolicy.js';

const shirt = quantity => ({ name: 'Team Shirt', category: 'shirts', quantity });
const ball = quantity => ({ name: 'Practice Ball', category: 'balls', quantity });
const stored = (id, category, quantity) => ({ id, details: { itemName: category === 'balls' ? 'Practice Ball' : 'Team Shirt', category, quantity } });

test('bulk starts where the ball bulk price does, at 21 balls', () => {
    assert.equal(BULK_BALL_QUANTITY, 21);
    assert.equal(getBallUnitPrice(20), 100);
    assert.equal(getBallUnitPrice(21), 90);
    assert.equal(isBulkBallCount(20), false);
    assert.equal(isBulkBallCount(21), true);
});

test('only balls count, from either a line or a stored order line, and bad quantities count as none', () => {
    assert.equal(ballCount([shirt(30), ball(12), ball(9)]), 21);
    assert.equal(ballCount([stored('a', 'balls', 7), stored('b', 'shirts', 50)]), 7);
    assert.equal(ballCount([ball(0), ball(-4), ball(2.5), ball('x'), ball(undefined)]), 0);
    assert.equal(ballCount(null), 0);
    assert.equal(codAllowed([shirt(100), ball(20)]), true);
    assert.equal(codAllowed([shirt(1), ball(15), ball(6)]), false, 'balls add up across lines');
});

test('editing a cash on delivery order may not grow it to 21 or more balls', () => {
    const order = paymentMode => ({ paymentMode, items: [stored('a', 'shirts', 2), stored('b', 'balls', 20)] });
    assert.equal(codEditProblem(order('COD'), [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 20 }]), null);
    assert.ok(codEditProblem(order('COD'), [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 21 }]));
    assert.equal(codEditProblem(order('Gcash'), [{ id: 'b', quantity: 99 }]), null, 'other payments are not limited');
    assert.equal(codEditProblem(order('COD'), [{ id: 'a', quantity: 2 }]), null, 'a removed line counts as none');

    const old = { paymentMode: 'COD', items: [stored('b', 'balls', 30)] };
    assert.equal(codEditProblem(old, [{ id: 'b', quantity: 30 }]), null, 'an older bulk order can keep its size');
    assert.equal(codEditProblem(old, [{ id: 'b', quantity: 25 }]), null, 'or shrink');
    assert.ok(codEditProblem(old, [{ id: 'b', quantity: 31 }]), 'but not grow');
});
