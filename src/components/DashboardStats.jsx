import React, { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Calendar, Trash2 } from 'lucide-react';
import clsx from 'clsx';

const StatCard = ({ title, amount, icon: Icon, colorClass, gradient }) => (
    <div className="glass-card relative overflow-hidden group">
        <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
            <Icon size={100} />
        </div>
        <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm uppercase tracking-wider text-slate-400 font-medium">{title}</h3>
                <div className={clsx("p-2 rounded-lg bg-white/5", colorClass)}>
                    <Icon size={20} />
                </div>
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">
                ₱ {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
        </div>
        <div className={clsx("absolute bottom-0 left-0 w-full h-1", gradient)}></div>
    </div>
);

const FilterButton = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={clsx(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            active
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
        )}
    >
        {children}
    </button>
);

const DashboardStats = ({ transactions, onDeleteAll }) => {
    const [filter, setFilter] = useState('all'); // all, daily, monthly, yearly

    const getFilteredTransactions = () => {
        const now = new Date();
        return transactions.filter(t => {
            const tDate = new Date(t.date);
            if (filter === 'all') return true;
            if (filter === 'daily') {
                return tDate.toDateString() === now.toDateString();
            }
            if (filter === 'monthly') {
                return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            }
            if (filter === 'yearly') {
                return tDate.getFullYear() === now.getFullYear();
            }
            return true;
        });
    };

    const filtered = getFilteredTransactions();

    const totalSales = filtered
        .filter(t => t.type === 'sale')
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const totalExpenses = filtered
        .filter(t => t.type === 'expense')
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const netProfit = totalSales - totalExpenses;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-xl font-bold text-white hidden md:block">Overview</h2>
                <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 p-1.5 rounded-xl border border-white/5 backdrop-blur-md">
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>This Year</FilterButton>
                    <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>This Month</FilterButton>
                    <FilterButton active={filter === 'daily'} onClick={() => setFilter('daily')}>Today</FilterButton>
                </div>

                {onDeleteAll && (
                    <button
                        onClick={onDeleteAll}
                        className="btn-danger py-2 px-4 text-sm flex items-center gap-2 ml-auto md:ml-0"
                        title="Delete all transactions"
                    >
                        <Trash2 size={14} />
                        Reset Data
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Sales"
                    amount={totalSales}
                    icon={TrendingUp}
                    colorClass="text-emerald-400"
                    gradient="bg-gradient-to-r from-emerald-500 to-teal-500"
                />
                <StatCard
                    title="Total Expenses"
                    amount={totalExpenses}
                    icon={TrendingDown}
                    colorClass="text-rose-400"
                    gradient="bg-gradient-to-r from-rose-500 to-red-500"
                />
                <StatCard
                    title="Net Profit"
                    amount={netProfit}
                    icon={DollarSign}
                    colorClass={netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                    gradient={netProfit >= 0 ? "bg-gradient-to-r from-emerald-500 to-cyan-500" : "bg-gradient-to-r from-rose-500 to-orange-500"}
                />
            </div>
        </div>
    );
};

export default DashboardStats;
