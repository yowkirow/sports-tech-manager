import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { isReturnedSale } from '../lib/transactionStatus';
import { READ_ONLY_HINT } from './ui/ReadOnly';

const formatPeso = (amount) => `₱${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Stat = ({ title, amount, tone, sign = '' }) => (
    <div className="px-5 py-5 sm:px-6">
        <p className="text-sm text-ink-2">{title}</p>
        <p className={clsx('display num mt-1.5 text-[34px] leading-none sm:text-4xl', tone)}>
            {sign}{formatPeso(amount)}
        </p>
    </div>
);

const FILTERS = [
    { id: 'all', label: 'All Time' },
    { id: 'yearly', label: 'This Year' },
    { id: 'monthly', label: 'This Month' },
    { id: 'daily', label: 'Today' },
];

const DashboardStats = ({ transactions, onDeleteAll, readOnly = false }) => {
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
        .filter(t => t.type === 'sale' && !isReturnedSale(t))
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const totalExpenses = filtered
        .filter(t => t.type === 'expense')
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const netProfit = totalSales - totalExpenses;

    return (
        <section className="space-y-4" aria-labelledby="overview-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="overview-title" className="sr-only">Overview</h2>
                <div role="group" aria-label="Time period" className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
                    {FILTERS.map(option => (
                        <button key={option.id} type="button" className="chip" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
                            {option.label}
                        </button>
                    ))}
                </div>
                {onDeleteAll && (
                    <button type="button" onClick={onDeleteAll} disabled={readOnly} className="btn-danger min-h-10 px-4 text-sm"
                        title={readOnly ? READ_ONLY_HINT : 'Delete all transactions'}>
                        <Trash2 size={15} aria-hidden="true" />
                        Reset Data
                    </button>
                )}
            </div>

            <div className="surface grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Stat title="Total Sales" amount={totalSales} tone="text-ink" />
                <Stat title="Total Expenses" amount={totalExpenses} tone="text-ink" />
                <Stat title="Net Profit" amount={netProfit} sign={netProfit < 0 ? '−' : ''}
                    tone={netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            </div>
        </section>
    );
};

export default DashboardStats;
