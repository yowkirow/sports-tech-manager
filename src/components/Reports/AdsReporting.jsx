import React, { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import clsx from 'clsx';
import { isReturnedSale } from '../../lib/transactionStatus';
import { getSaleItems } from '../../lib/orderItems.js';

const FilterButton = ({ active, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="chip"
    >
        {children}
    </button>
);

const AdsReporting = ({ transactions }) => {
    const [filter, setFilter] = useState('monthly');

    const reportData = useMemo(() => {
        const now = new Date();

        const filtered = transactions.filter(t => {
            if (!t.date) return false;
            const tDate = new Date(t.date);

            if (filter === 'all') return true;
            if (filter === 'daily') return tDate.toDateString() === now.toDateString();
            if (filter === 'monthly') return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            if (filter === 'yearly') return tDate.getFullYear() === now.getFullYear();

            if (filter === 'weekly') {
                const sevenDaysAgo = new Date(now);
                sevenDaysAgo.setDate(now.getDate() - 7);
                return tDate >= sevenDaysAgo && tDate <= now;
            }
            return true;
        });

        let totalSales = 0;
        let totalShirtsSold = 0;
        let totalAdSpend = 0;
        let totalProductionExpense = 0;
        let otherExpenses = 0;

        const productionKeywords = ['blanks', 'packaging', 'transportation', 'lalamove', 'print', 'printing', 'shirt', 'shipping'];

        filtered.forEach(t => {
            const amount = Number(t.amount) || 0;
            if (t.type === 'sale' && !isReturnedSale(t) && t.details?.club !== 'downtown-dinks') {
                totalSales += amount;
                totalShirtsSold += getSaleItems(t)
                    .filter(item => item.details?.category === 'shirts')
                    .reduce((sum, item) => sum + (Number(item.details?.quantity) || 0), 0);
            } else if (t.type === 'expense') {
                if (t.details?.club === 'downtown-dinks') return;

                const cat = (t.category || '').toLowerCase();
                const subCat = (t.details?.subCategory || '').toLowerCase();

                if (cat === 'ads' || subCat === 'marketing/ads') {
                    totalAdSpend += amount;
                } else {
                    const isProduction = productionKeywords.some(kw => cat.includes(kw) || subCat.includes(kw));

                    if (isProduction) {
                        totalProductionExpense += amount;
                    } else {
                        otherExpenses += amount;
                    }
                }
            }
        });

        const salesAfterShirtCost = totalSales - totalProductionExpense;
        const netProfit = salesAfterShirtCost - totalAdSpend - otherExpenses;

        const perShirt = (val) => totalShirtsSold > 0 ? (val / totalShirtsSold) : 0;

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
    }, [transactions, filter]);

    const formatCurrency = (amount) => {
        return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    return (
        <div className="flex h-full flex-col gap-6">
            <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h2 className="section-title flex items-center gap-2">
                    <Target className="text-ink-3" size={20} aria-hidden="true" /> Reports P&amp;L
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>This Year</FilterButton>
                    <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>This Month</FilterButton>
                    <FilterButton active={filter === 'weekly'} onClick={() => setFilter('weekly')}>Last 7 Days</FilterButton>
                    <FilterButton active={filter === 'daily'} onClick={() => setFilter('daily')}>Today</FilterButton>
                </div>
            </div>

            <section className="surface w-full max-w-5xl shrink-0 overflow-hidden" aria-labelledby="ads-pl-title">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-ink-2">
                                <th id="ads-pl-title" className="px-5 py-4 text-base font-semibold text-ink">
                                    <span className="num display mr-2 text-3xl align-middle">{reportData.totalShirtsSold}</span> shirts*({filter})
                                </th>
                                <th className="border-l border-line px-5 py-4 text-right font-medium">
                                    Total amount
                                </th>
                                <th className="border-l border-line px-5 py-4 text-right font-medium">
                                    Per shirt unit
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-line transition-colors hover:bg-white/[0.04]">
                                <td className="px-5 py-4 text-base text-ink">Gross sales</td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-emerald-300">
                                    ₱{formatCurrency(reportData.totalSales)}
                                </td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-emerald-300">
                                    ₱{formatCurrency(reportData.totalSalesPerUnit)}
                                </td>
                            </tr>

                            <tr className="border-b border-line transition-colors hover:bg-white/[0.04]">
                                <td className="px-5 py-4 text-ink-2">Less (Blank shirt, Lalamove, Print)</td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.totalProductionExpense)}
                                </td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.productionPerUnit)}
                                </td>
                            </tr>

                            <tr className="border-b border-line bg-raised">
                                <td className="px-5 py-4 text-lg font-semibold text-ink">Sales after Shirt Cost</td>
                                <td className="num border-l border-line px-5 py-4 text-right text-lg font-semibold text-ink">
                                    ₱{formatCurrency(reportData.salesAfterShirtCost)}
                                </td>
                                <td className="num border-l border-line px-5 py-4 text-right text-lg font-semibold text-ink">
                                    ₱{formatCurrency(reportData.salesAfterShirtCostPerUnit)}
                                </td>
                            </tr>

                            <tr className="border-b border-line transition-colors hover:bg-white/[0.04]">
                                <td className="px-5 py-4 text-ink-2">Less advertisement</td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.totalAdSpend)}
                                </td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.adSpendPerUnit)}
                                </td>
                            </tr>

                            <tr className="border-b border-line transition-colors hover:bg-white/[0.04]">
                                <td className="px-5 py-4 text-ink-2">Less other costs</td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.otherExpenses)}
                                </td>
                                <td className="num border-l border-line px-5 py-4 text-right font-semibold text-red-300">
                                    ₱{formatCurrency(reportData.otherExpensesPerUnit)}
                                </td>
                            </tr>

                            <tr className="bg-raised">
                                <td className="px-5 py-5 text-xl font-semibold text-ink">Sales after all costs</td>
                                <td className={clsx(
                                    'num border-l border-line px-5 py-5 text-right text-xl font-semibold',
                                    reportData.netProfit >= 0 ? 'text-emerald-300' : 'text-red-300'
                                )}>
                                    ₱{formatCurrency(reportData.netProfit)}
                                </td>
                                <td className={clsx(
                                    'num border-l border-line px-5 py-5 text-right text-xl font-semibold',
                                    reportData.netProfitPerUnit >= 0 ? 'text-emerald-300' : 'text-red-300'
                                )}>
                                    ₱{formatCurrency(reportData.netProfitPerUnit)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="w-full max-w-5xl">
                <p className="rounded-xl border border-line bg-raised p-4 text-sm text-ink-2">
                    <strong className="font-semibold text-ink">Note:</strong> Production costs are dynamically grouped based on your expense categories and descriptions (e.g., matching keywords like "blanks", "printing", "packaging", "lalamove", "transportation"). All other tracked administrative expenses fall under "other costs".
                </p>
            </div>
        </div>
    );
};

export default AdsReporting;
