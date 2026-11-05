import { getSaleItems } from './orderItems.js';
import { isVoidedSale } from './transactionStatus.js';

const CLUB_SLUG = 'downtown-dinks';

// Matched inside the expense category and sub-category. DTF is the shirt print, and LBC ships the orders.
const PRODUCTION_KEYWORDS = ['blanks', 'packaging', 'transportation', 'lalamove', 'print', 'printing', 'shirt', 'shipping', 'dtf', 'lbc'];

const isAdLabel = (label) => label === 'ads' || label === 'marketing/ads' || label.includes('advertis');

export const expenseGroup = (transaction) => {
    const labels = [transaction.category, transaction.details?.subCategory].map(label => (label || '').toLowerCase());
    if (labels.some(isAdLabel)) return 'ads';
    return labels.some(label => PRODUCTION_KEYWORDS.some(keyword => label.includes(keyword))) ? 'production' : 'other';
};

const inPeriod = (value, filter, now) => {
    if (!value) return false;
    const date = new Date(value);
    if (filter === 'all') return true;
    if (filter === 'daily') return date.toDateString() === now.toDateString();
    if (filter === 'monthly') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    if (filter === 'yearly') return date.getFullYear() === now.getFullYear();
    if (filter === 'weekly') {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        return date >= sevenDaysAgo && date <= now;
    }
    return true;
};

export function buildPlReport(transactions, filter = 'monthly', now = new Date()) {
    let totalSales = 0;
    let totalShirtsSold = 0;
    let totalAdSpend = 0;
    let totalProductionExpense = 0;
    let otherExpenses = 0;

    for (const transaction of transactions) {
        if (!inPeriod(transaction.date, filter, now)) continue;
        const amount = Number(transaction.amount) || 0;
        if (transaction.type === 'sale' && !isVoidedSale(transaction) && transaction.details?.club !== CLUB_SLUG) {
            totalSales += amount;
            totalShirtsSold += getSaleItems(transaction)
                .filter(item => item.details?.category === 'shirts')
                .reduce((sum, item) => sum + (Number(item.details?.quantity) || 0), 0);
        } else if (transaction.type === 'expense' && transaction.details?.club !== CLUB_SLUG) {
            const group = expenseGroup(transaction);
            if (group === 'ads') totalAdSpend += amount;
            else if (group === 'production') totalProductionExpense += amount;
            else otherExpenses += amount;
        }
    }

    const salesAfterShirtCost = totalSales - totalProductionExpense;
    const netProfit = salesAfterShirtCost - totalAdSpend - otherExpenses;
    const perShirt = (value) => totalShirtsSold > 0 ? value / totalShirtsSold : 0;

    return {
        totalShirtsSold,
        totalSales,
        totalSalesPerUnit: perShirt(totalSales),
        totalProductionExpense,
        productionPerUnit: perShirt(totalProductionExpense),
        salesAfterShirtCost,
        salesAfterShirtCostPerUnit: perShirt(salesAfterShirtCost),
        totalAdSpend,
        adSpendPerUnit: perShirt(totalAdSpend),
        otherExpenses,
        otherExpensesPerUnit: perShirt(otherExpenses),
        netProfit,
        netProfitPerUnit: perShirt(netProfit)
    };
}
