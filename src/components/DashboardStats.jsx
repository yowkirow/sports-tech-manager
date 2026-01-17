import React, { useState } from 'react';
import Card from './ui/Card';
import { TrendingUp, TrendingDown, DollarSign, Calendar } from 'lucide-react';

const StatCard = ({ title, amount, icon: Icon, colorClass }) => (
    <Card className="flex flex-col justify-between h-full">
        <div className="flex-between" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem', textTransform: 'uppercase' }}>{title}</h3>
            <div style={{ padding: '0.5rem', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }}>
                <Icon size={20} className={colorClass} />
            </div>
        </div>
        <div style={{ fontSize: '2rem', fontWeight: '700' }}>
            ₱ {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
    </Card>
);

const FilterButton = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        style={{
            background: active ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
            border: 'none',
            color: active ? 'white' : 'var(--text-muted)',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: active ? '600' : '400',
            transition: 'all 0.2s'
        }}
    >
        {children}
    </button>
);

const DashboardStats = ({ transactions }) => {
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
        <div style={{ marginBottom: '2rem' }}>
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Dashboard</h2>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '10px' }}>
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>This Year</FilterButton>
                    <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>This Month</FilterButton>
                    <FilterButton active={filter === 'daily'} onClick={() => setFilter('daily')}>Today</FilterButton>
                </div>
            </div>

            <div className="grid-cols-3">
                <StatCard
                    title="Total Sales"
                    amount={totalSales}
                    icon={TrendingUp}
                    colorClass="text-success"
                />
                <StatCard
                    title="Total Expenses"
                    amount={totalExpenses}
                    icon={TrendingDown}
                    colorClass="text-danger"
                />
                <StatCard
                    title="Net Profit"
                    amount={netProfit}
                    icon={DollarSign}
                    colorClass={netProfit >= 0 ? 'text-success' : 'text-danger'}
                />
            </div>
        </div>
    );
};

export default DashboardStats;
