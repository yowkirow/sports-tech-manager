import React, { useState, useMemo } from 'react';
import { TrendingUp, DollarSign, Calendar, Target, Activity, PieChart } from 'lucide-react';
import clsx from 'clsx';
// Standard imports based on existing styles in DashboardStats.jsx

const StatCard = ({ title, amount, icon: Icon, colorClass, gradient, subtitle }) => (
    <div className="glass-card relative overflow-hidden group p-6">
        <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
            <Icon size={100} />
        </div>
        <div className="relative z-10 flex flex-col h-full justify-between">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm uppercase tracking-wider text-slate-400 font-bold">{title}</h3>
                <div className={clsx("p-2 rounded-xl bg-white/5", colorClass)}>
                    <Icon size={20} />
                </div>
            </div>
            <div>
                <div className="text-3xl font-black text-white tracking-tight flex items-baseline gap-1">
                    {title.includes('ROAS') ? '' : '₱'}
                    {typeof amount === 'number' ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : amount}
                    {title.includes('ROAS') && <span className="text-lg text-slate-400 font-medium ml-1">x</span>}
                </div>
                {subtitle && <p className="text-xs text-slate-500 font-bold mt-2">{subtitle}</p>}
            </div>
        </div>
        <div className={clsx("absolute bottom-0 left-0 w-full h-1", gradient)}></div>
    </div>
);

const FilterButton = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={clsx(
            "px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200",
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
        let totalAdSpend = 0;
        let otherExpenses = 0;
        const platformSpend = {};

        filtered.forEach(t => {
            const amount = Number(t.amount) || 0;
            if (t.type === 'sale') {
                totalSales += amount;
            } else if (t.type === 'expense') {
                // Check if it's an ad spend (using the new category logic)
                if (t.category === 'ads' || t.details?.subCategory === 'Marketing/Ads') {
                    totalAdSpend += amount;
                    const platform = t.details?.platform || 'Unspecified';
                    platformSpend[platform] = (platformSpend[platform] || 0) + amount;
                } else {
                    otherExpenses += amount;
                }
            }
        });

        const roas = totalAdSpend > 0 ? (totalSales / totalAdSpend) : 0;
        const netProfit = totalSales - totalAdSpend - otherExpenses;

        return {
            totalSales,
            totalAdSpend,
            otherExpenses,
            netProfit,
            roas,
            platformSpend
        };
    }, [transactions, filter]);

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
                <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Target className="text-primary" /> Ads vs Sales Report
                </h2>
                <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 p-1.5 rounded-xl border border-white/5 backdrop-blur-md">
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>This Year</FilterButton>
                    <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>This Month</FilterButton>
                    <FilterButton active={filter === 'weekly'} onClick={() => setFilter('weekly')}>Last 7 Days</FilterButton>
                    <FilterButton active={filter === 'daily'} onClick={() => setFilter('daily')}>Today</FilterButton>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                <StatCard
                    title="Total Sales"
                    amount={reportData.totalSales}
                    icon={TrendingUp}
                    colorClass="text-emerald-400 bg-emerald-500/10"
                    gradient="bg-gradient-to-r from-emerald-500 to-teal-500"
                />
                <StatCard
                    title="Ad Spend"
                    amount={reportData.totalAdSpend}
                    icon={Activity}
                    colorClass="text-rose-400 bg-rose-500/10"
                    gradient="bg-gradient-to-r from-rose-500 to-red-500"
                />
                <StatCard
                    title="ROAS (Return on Ad Spend)"
                    amount={reportData.roas}
                    icon={Target}
                    colorClass="text-indigo-400 bg-indigo-500/10"
                    gradient="bg-gradient-to-r from-indigo-500 to-purple-500"
                    subtitle={reportData.roas >= 3 ? "Excellent return! \ud83d\ude80" : reportData.roas >= 1 ? "Profitable \ud83d\udfe2" : "Running at a loss \ud83d\udd34"}
                />
                <StatCard
                    title="Net Profit (After Ads)"
                    amount={reportData.netProfit}
                    icon={DollarSign}
                    colorClass={reportData.netProfit >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}
                    gradient={reportData.netProfit >= 0 ? "bg-gradient-to-r from-emerald-500 to-cyan-500" : "bg-gradient-to-r from-rose-500 to-orange-500"}
                    subtitle={`Other Expenses: \u20B1${reportData.otherExpenses.toLocaleString()}`}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Platform Breakdown */}
                <div className="lg:col-span-1 glass-card p-6 flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <PieChart className="text-primary" size={20} /> Spend by Platform
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                        {Object.keys(reportData.platformSpend).length === 0 ? (
                            <div className="h-full flex items-center justify-center text-slate-500 text-sm font-medium">
                                No ad spend recorded for this period.
                            </div>
                        ) : (
                            Object.entries(reportData.platformSpend)
                                .sort(([, a], [, b]) => b - a)
                                .map(([platform, amount]) => {
                                    const percentage = ((amount / reportData.totalAdSpend) * 100).toFixed(0);
                                    return (
                                        <div key={platform} className="p-4 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="font-bold text-slate-200">{platform}</span>
                                                <span className="font-black text-white">₱{amount.toLocaleString()}</span>
                                            </div>
                                            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                <div
                                                    className="bg-primary h-1.5 rounded-full"
                                                    style={{ width: `${percentage}%` }}
                                                ></div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-bold mt-2 text-right">{percentage}% of budget</p>
                                        </div>
                                    )
                                })
                        )}
                    </div>
                </div>

                {/* Insight Panel / Placeholder for Chart */}
                <div className="lg:col-span-2 glass-card p-6 flex flex-col items-center justify-center text-center">
                    <div className="w-24 h-24 mb-6 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <TrendingUp size={48} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Performance Summary</h3>
                    <p className="text-slate-400 max-w-md">
                        For every ₱1.00 spent on advertising during this period, you generated <span className="text-white font-bold">₱{reportData.roas.toFixed(2)}</span> in sales revenue.
                    </p>

                    {reportData.totalAdSpend === 0 && (
                        <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-sm font-bold max-w-sm">
                            No ad spend detected. Add ad expenses in the Expenses tab to see your ROAS calculations.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdsReporting;
