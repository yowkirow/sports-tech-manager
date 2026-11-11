import assert from 'node:assert/strict';
import test from 'node:test';
import {
    addMonths, chargeDaysThrough, firstChargeProblem, manilaToday, monthlyCost, nextChargeDay, readSubscription, scheduleText
} from '../src/lib/recurringExpenses.js';

const subscription = patch => ({
    name: 'Design app', amount: 499, subCategory: 'Software/Subscriptions', frequency: 'monthly', startsOn: '2026-01-31', club: null, ...patch
});

test('monthly charges keep the first charge day, or the month’s last day when shorter', () => {
    assert.deepEqual(chargeDaysThrough(subscription(), '2026-05-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    assert.deepEqual(chargeDaysThrough(subscription({ startsOn: '2027-12-31' }), '2028-02-29'), ['2027-12-31', '2028-01-31', '2028-02-29']);
    assert.deepEqual(chargeDaysThrough(subscription({ startsOn: '2026-12-01' }), '2026-11-30'), [], 'nothing before the first charge');
    assert.equal(nextChargeDay(subscription(), '2026-02-28'), '2026-03-31', 'the next charge is after today');
    assert.equal(addMonths('2026-03-31', -13), '2025-02-28');
});

test('yearly charges fall on the same date, and Feb 29 on Feb 28 in other years', () => {
    const leap = subscription({ frequency: 'yearly', startsOn: '2028-02-29' });
    assert.deepEqual(chargeDaysThrough(leap, '2032-03-01'), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    assert.equal(scheduleText(leap), 'Yearly on Feb 29 (Feb 28 in other years)');
    assert.equal(scheduleText(subscription({ frequency: 'yearly', startsOn: '2026-03-15' })), 'Yearly on Mar 15');
    assert.equal(scheduleText(subscription()), 'Monthly on the 31st (or the month’s last day)');
    assert.deepEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-11', '2026-01-12', '2026-01-22'].map(startsOn => scheduleText(subscription({ startsOn }))),
        ['Monthly on the 1st', 'Monthly on the 2nd', 'Monthly on the 3rd', 'Monthly on the 11th', 'Monthly on the 12th', 'Monthly on the 22nd']);
});

test('a subscription is complete or not one at all', () => {
    assert.deepEqual(readSubscription(subscription({ amount: 19.99, club: 'downtown-dinks' })), subscription({ amount: 19.99, club: 'downtown-dinks' }));
    for (const patch of [{ name: ' ' }, { amount: 0 }, { amount: 1.005 }, { amount: '499' }, { amount: 1_000_001 }, { frequency: 'weekly' },
        { startsOn: '2026-02-30' }, { startsOn: '1999-12-01' }, { subCategory: '' }, { club: 'other-club' }]) {
        assert.equal(readSubscription(subscription(patch)), null, JSON.stringify(patch));
    }
    assert.equal(readSubscription(null), null);
});

test('the first charge is within a year of today, so a typo can’t record years of charges', () => {
    assert.equal(firstChargeProblem('2025-11-11', '2026-11-11'), '');
    assert.equal(firstChargeProblem('2027-11-11', '2026-11-11'), '');
    assert.match(firstChargeProblem('2025-11-10', '2026-11-11'), /at most a year ago/);
    assert.match(firstChargeProblem('2027-11-12', '2026-11-11'), /at most a year from today/);
    assert.match(firstChargeProblem('', '2026-11-11'), /Choose the day/);
});

test('today is the Philippine date, and yearly costs spread over twelve months', () => {
    assert.equal(manilaToday(new Date('2026-11-11T15:59:59Z')), '2026-11-11');
    assert.equal(manilaToday(new Date('2026-11-11T16:00:00Z')), '2026-11-12');
    assert.equal(monthlyCost([subscription(), subscription({ amount: 1200, frequency: 'yearly' })]), 599);
});
