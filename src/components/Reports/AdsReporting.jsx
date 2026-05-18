import React, { useState, useMemo } from 'react';
import { Target } from 'lucide-react';
import clsx from 'clsx';

const FilterButton = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={clsx(
            "px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 whitespace-nowrap",
            active
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
        )}
    >
        {children}
    </button>
);

const AdsReporting = ({ transactions }) => {
    const [filter, setFilter] = useState('monthly'); // all, daily, weekly, monthly, yearly

    // Group & Filter Data
    const reportData = useMemo(() => {
        const now = new Date();

        // Filter transactions by date range
        const filtered = transactions.filter(t => {
            if (!t.date) return false;
            const tDate = new Date(t.date);

            if (filter === 'all') return true;
            if (filter === 'daily') return tDate.toDateString() === now.toDateString();
            if (filter === 'monthly') return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            if (filter === 'yearly') return tDate.getFullYear() === now.getFullYear();

            // Weekly logic: last 7 days
            if (filter === 'weekly') {
                const sevenDaysAgo = new Date(now);
                sevenDaysAgo.setDate(now.getDate() - 7);
                return tDate >= sevenDaysAgo && tDate <= now;
            }
            return true;
        });

        // Calculate Metrics
        let totalSales = 0;
        let totalShirtsSold = 0;
        let totalAdSpend = 0;
        let totalProductionExpense = 0;
        let otherExpenses = 0;

        // Keywords that identify production or shipping costs
        const productionKeywords = ['blanks', 'packaging', 'transportation', 'lalamove', 'print', 'printing', 'shirt', 'shipping'];

        filtered.forEach(t => {
            const amount = Number(t.amount) || 0;
            if (t.type === 'sale' && t.details?.club !== 'downtown-dinks') {
                totalSales += amount;

                // Count quantity of items sold
                if (t.details?.items && Array.isArray(t.details.items)) {
                    // POS Format
                    t.details.items.forEach(item => {
                        totalShirtsSold += Number(item.quantity) || 0;
                    });
                } else {
                    // Storefront / Legacy format
                    totalShirtsSold += Number(t.details?.quantity) || 1;
                }
            } else if (t.type === 'expense') {
                const cat = (t.category || '').toLowerCase();
                const subCat = (t.details?.subCategory || '').toLowerCase();

                if (cat === 'ads' || subCat === 'marketing/ads') {
                    totalAdSpend += amount;
                } else {
                    // Check if it matches a production category
                    const isProduction = productionKeywords.some(kw => cat.includes(kw) || subCat.includes(kw));

                    if (isProduction) {
                        totalProductionExpense += amount;
                    } else {
                        otherExpenses += amount;
                    }
                }
            }
        });

        // Computed Rows
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

    // Helper for formatting currency
    const formatCurrency = (amount) => {
        return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
                <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Target className="text-primary" /> Reports P&L
                </h2>
                <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 p-1.5 rounded-xl border border-white/5 backdrop-blur-md">
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>This Year</FilterButton>
                    <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>This Month</FilterButton>
                    <FilterButton active={filter === 'weekly'} onClick={() => setFilter('weekly')}>Last 7 Days</FilterButton>
                    <FilterButton active={filter === 'daily'} onClick={() => setFilter('daily')}>Today</FilterButton>
                </div>
            </div>

            {/* P&L Table */}
            <div className="glass-card overflow-hidden shrink-0 flex flex-col max-w-5xl mx-auto w-full">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr className="border-b border-white/10 bg-white/5">
                                <th className="p-5 font-bold text-slate-300 w-1/2 text-lg">
                                    <span className="text-white">{reportData.totalShirtsSold}</span> shirts*({filter})
                                </th>
                                <th className="p-5 font-bold text-slate-300 w-1/4 text-lg border-l border-white/5 text-right">
                                    TOTAL AMOUNT
                                </th>
                                <th className="p-5 font-bold text-slate-300 w-1/4 text-lg border-l border-white/5 text-right">
                                    PER SHIRT UNIT
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {/* Row 1: Gross Sales */}
                            <tr className="hover:bg-white/5 transition-colors">
                                <td className="p-5 text-slate-200 text-lg">Gross sales</td>
                                <td className="p-5 font-medium text-emerald-400 text-right border-l border-white/5 text-lg">
                                    {formatCurrency(reportData.totalSales)}
                                </td>
                                <td className="p-5 font-medium text-emerald-400 text-right border-l border-white/5 text-lg">
                                    {formatCurrency(reportData.totalSalesPerUnit)}
                                </td>
                            </tr>

                            {/* Row 2: Cost of Goods */}
                            <tr className="hover:bg-white/5 transition-colors">
                                <td className="p-5 text-slate-400">Less (Blank shirt, Lalamove, Print)</td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.totalProductionExpense)}
                                </td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.productionPerUnit)}
                                </td>
                            </tr>

                            {/* Row 3: Gross Profit limit/Subtotal */}
                            <tr className="hover:bg-white/5 transition-colors bg-white/5 border-t border-b border-white/10">
                                <td className="p-5 font-bold text-white text-xl">Sales after Shirt Cost</td>
                                <td className="p-5 font-black text-white text-right text-xl border-l border-white/5">
                                    {formatCurrency(reportData.salesAfterShirtCost)}
                                </td>
                                <td className="p-5 font-black text-white text-right text-xl border-l border-white/5">
                                    {formatCurrency(reportData.salesAfterShirtCostPerUnit)}
                                </td>
                            </tr>

                            {/* Row 4: Advertisement */}
                            <tr className="hover:bg-white/5 transition-colors">
                                <td className="p-5 text-slate-400">Less advertisement</td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.totalAdSpend)}
                                </td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.adSpendPerUnit)}
                                </td>
                            </tr>

                            {/* Row 5: Other Costs */}
                            <tr className="hover:bg-white/5 transition-colors">
                                <td className="p-5 text-slate-400">Less other costs</td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.otherExpenses)}
                                </td>
                                <td className="p-5 font-medium text-rose-400 text-right border-l border-white/5">
                                    {formatCurrency(reportData.otherExpensesPerUnit)}
                                </td>
                            </tr>

                            {/* Row 6: Net Profit */}
                            <tr className="bg-gradient-to-r from-slate-800 to-slate-900 border-t border-t-primary/30 shadow-inner">
                                <td className="p-6 font-black text-white text-2xl rounded-bl-xl">Sales after all costs</td>
                                <td className={clsx(
                                    "p-6 font-black text-2xl text-right border-l border-white/5",
                                    reportData.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {formatCurrency(reportData.netProfit)}
                                </td>
                                <td className={clsx(
                                    "p-6 font-black text-2xl text-right rounded-br-xl border-l border-white/5",
                                    reportData.netProfitPerUnit >= 0 ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {formatCurrency(reportData.netProfitPerUnit)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Context Notice */}
            <div className="max-w-5xl mx-auto w-full">
                <p className="text-sm text-slate-500 font-medium bg-white/5 p-4 rounded-xl border border-white/5">
                    <strong>Note:</strong> Production costs are dynamically grouped based on your expense categories and descriptions (e.g., matching keywords like "blanks", "printing", "packaging", "lalamove", "transportation"). All other tracked administrative expenses fall under "other costs".
                </p>
            </div>
        </div>
    );
};

export default AdsReporting;
