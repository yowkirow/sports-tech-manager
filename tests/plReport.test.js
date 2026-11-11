import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlReport, expenseGroup } from '../src/lib/plReport.js';
import { STAFF_PAY_CATEGORY } from '../src/lib/staffPay.js';
import { isReturnedSale, isVoidedSale } from '../src/lib/transactionStatus.js';

const sale = (id, amount, shirts, details = {}) => ({
    id, type: 'sale', category: 'shirts', amount, date: '2026-10-01T02:00:00Z',
    details: { orderId: id, category: 'shirts', size: 'M', quantity: shirts, fulfillmentStatus: 'shipped', ...details }
});
const expense = (amount, category, subCategory, details = {}) => ({
    id: `${category}-${subCategory}-${amount}`, type: 'expense', category, amount, date: '2026-10-02T02:00:00Z',
    details: { subCategory, ...details }
});

test('returned and cancelled orders are voided sales, in any case and on legacy rows', () => {
    assert.equal(isVoidedSale(sale('a', 1, 1, { fulfillmentStatus: 'returned' })), true);
    assert.equal(isVoidedSale(sale('b', 1, 1, { fulfillmentStatus: 'Cancelled' })), true);
    assert.equal(isVoidedSale(sale('c', 1, 1, { fulfillmentStatus: undefined, status: 'cancelled' })), true);
    assert.equal(isVoidedSale(sale('d', 1, 1, { fulfillmentStatus: 'ready' })), false);
    assert.equal(isVoidedSale({ type: 'expense', details: { status: 'cancelled' } }), false);
    assert.equal(isReturnedSale(sale('e', 1, 1, { fulfillmentStatus: 'cancelled' })), false);
});

test('the P&L counts neither returned nor cancelled orders, nor Downtown Dinks, as sales', () => {
    const report = buildPlReport([
        sale('kept', 1000, 2),
        sale('cancelled', 500, 1, { fulfillmentStatus: 'cancelled' }),
        sale('returned', 700, 1, { fulfillmentStatus: 'returned' }),
        sale('club', 300, 1, { club: 'downtown-dinks' })
    ], 'all');
    assert.equal(report.totalSales, 1000);
    assert.equal(report.totalShirtsSold, 2);
    assert.equal(report.totalSalesPerUnit, 500);
});

test('DTF printing and LBC shipping are production costs, and advertising is always ads', () => {
    const groups = [
        expense(300, 'general', 'DTF'),
        expense(200, 'general', 'LBC'),
        expense(100, 'general', 'shirt'),
        expense(50, 'blanks', ''),
        expense(400, 'ads', 'Marketing/Ads'),
        expense(25, 'general', 'Marketing/Ads'),
        expense(60, 'accessories', 'Facebook advertisement'),
        expense(1000, 'general', 'Rent'),
        expense(80, 'general', 'Bank charge')
    ].map(expenseGroup);
    assert.deepEqual(groups, ['production', 'production', 'production', 'production', 'ads', 'ads', 'ads', 'other', 'other']);
});

test('print staff pay from Production payouts is a production cost, like the print itself', () => {
    assert.equal(expenseGroup(expense(2000, 'general', STAFF_PAY_CATEGORY)), 'production');
});

test('the P&L totals each cost group per shirt and leaves Downtown Dinks expenses out', () => {
    const report = buildPlReport([
        sale('kept', 2000, 4),
        expense(300, 'general', 'DTF'),
        expense(100, 'general', 'LBC'),
        expense(400, 'ads', 'Marketing/Ads'),
        expense(200, 'general', 'Rent'),
        expense(999, 'general', 'Rent', { club: 'downtown-dinks' })
    ], 'all');
    assert.equal(report.totalProductionExpense, 400);
    assert.equal(report.productionPerUnit, 100);
    assert.equal(report.totalAdSpend, 400);
    assert.equal(report.adSpendPerUnit, 100);
    assert.equal(report.otherExpenses, 200);
    assert.equal(report.salesAfterShirtCost, 1600);
    assert.equal(report.netProfit, 1000);
    assert.equal(report.netProfitPerUnit, 250);
});

test('the period filter keeps only rows inside it', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const report = buildPlReport([
        { ...sale('recent', 900, 3), date: '2026-10-08T12:00:00Z' },
        { ...sale('old', 500, 1), date: '2026-09-01T12:00:00Z' },
        { ...sale('undated', 400, 1), date: '' }
    ], 'weekly', now);
    assert.equal(report.totalSales, 900);
    assert.equal(report.totalShirtsSold, 3);
    assert.equal(buildPlReport([sale('none', 0, 0)], 'all').totalSalesPerUnit, 0);
});
