import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Banknote, Calendar, Edit2, Filter, Loader2, Plus, Save, Search, Trash2, TrendingDown, Trophy } from 'lucide-react';
import { api } from '../lib/apiClient';
import { useToast } from './ui/Toast';
import Dialog from './ui/Dialog';
import { isReturnedSale } from '../lib/transactionStatus';
import { withLocalDate } from '../lib/transactionDate';

const CLUB_SLUG = 'downtown-dinks';
const INCOME_TYPES = [
    { value: 'open_plays', label: 'Open Plays' },
    { value: 'tournaments', label: 'Tournaments' }
];

const formatCurrency = (value) => `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;

const formatDate = (isoString) => {
    return new Date(isoString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const incomeTypeLabel = (value) => {
    return INCOME_TYPES.find(type => type.value === value)?.label || 'Open Plays';
};

const makeDateWithCurrentTime = (date) => {
    return withLocalDate(date);
};

const StatCard = ({ title, amount, icon: Icon, tone }) => (
    <div className="flex min-w-0 items-start gap-3 p-4 sm:p-5">
        <Icon size={20} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
        <div className="min-w-0">
            <p className="text-sm text-ink-2">{title}</p>
            <p className={clsx('display mt-2 truncate text-3xl num', tone)}>{formatCurrency(amount)}</p>
        </div>
    </div>
);

const EarningModal = ({ initialData, onAddTransaction, onUpdateTransaction, onClose }) => {
    const { showToast } = useToast();
    const [incomeType, setIncomeType] = useState(initialData?.details?.incomeType || 'open_plays');
    const [amount, setAmount] = useState(initialData?.amount || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [date, setDate] = useState(initialData?.date ? initialData.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const finalDescription = description.trim() || `${incomeTypeLabel(incomeType)} earning`;
            const nextDate = makeDateWithCurrentTime(date);
            const parsedAmount = parseFloat(amount);
            const user = await api.getCurrentUser();

            if (initialData) {
                await onUpdateTransaction(initialData.id, {
                    type: 'sale',
                    category: 'downtown_dinks',
                    amount: parsedAmount,
                    date: nextDate.toISOString(),
                    description: finalDescription,
                    details: {
                        ...initialData.details,
                        club: CLUB_SLUG,
                        incomeType,
                        updatedBy: user?.email || 'Unknown',
                        updatedAt: new Date().toISOString()
                    }
                });
                showToast('Downtown Dinks earning updated', 'success');
            } else {
                await onAddTransaction({
                    id: crypto.randomUUID(),
                    type: 'sale',
                    category: 'downtown_dinks',
                    amount: parsedAmount,
                    date: nextDate.toISOString(),
                    description: finalDescription,
                    details: {
                        club: CLUB_SLUG,
                        incomeType,
                        createdBy: user?.email || 'Unknown'
                    }
                });
                showToast('Downtown Dinks earning added', 'success');
            }

            onClose();
        } catch (error) {
            console.error(error);
            showToast(initialData ? 'Failed to update earning' : 'Failed to add earning', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog onClose={onClose} title={initialData ? 'Edit Earning' : 'Add Earning'} size="md" bodyClassName="p-5 sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="dinks-income-type" className="field-label">Income Type</label>
                    <select
                        id="dinks-income-type"
                        value={incomeType}
                        onChange={(e) => setIncomeType(e.target.value)}
                        className="field"
                        required
                    >
                        {INCOME_TYPES.map(type => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="dinks-amount" className="field-label">Amount (₱)</label>
                    <input
                        id="dinks-amount"
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="field num"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="dinks-description" className="field-label">Notes / Title</label>
                    <input
                        id="dinks-description"
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="field"
                        placeholder="e.g. Saturday open play"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="dinks-date" className="field-label">Date</label>
                    <input
                        id="dinks-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="field"
                        required
                    />
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full">
                    {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : (initialData ? <Save size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />)}
                    {loading ? 'Saving...' : (initialData ? 'Update Earning' : 'Add Earning')}
                </button>
            </form>
        </Dialog>
    );
};

export default function DowntownDinks({ transactions, onAddTransaction, onUpdateTransaction, onDeleteTransaction }) {
    const { showToast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [showModal, setShowModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState(null);

    const earnings = useMemo(() => {
        return transactions
            .filter(t => ['sale', 'club_income'].includes(t.type) && !isReturnedSale(t) && t.details?.club === CLUB_SLUG)
            .filter(t => {
                const matchesSearch = (t.description || '').toLowerCase().includes(searchTerm.toLowerCase());
                const matchesType = filterType === 'all' || t.details?.incomeType === filterType;
                return matchesSearch && matchesType;
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [transactions, searchTerm, filterType]);

    const allClubEarnings = useMemo(() => {
        return transactions.filter(t => ['sale', 'club_income'].includes(t.type) && !isReturnedSale(t) && t.details?.club === CLUB_SLUG);
    }, [transactions]);

    const allClubExpenses = useMemo(() => {
        return transactions.filter(t => t.type === 'expense' && t.details?.club === CLUB_SLUG);
    }, [transactions]);

    const totals = useMemo(() => {
        const incomeTotals = allClubEarnings.reduce((acc, earning) => {
            const amount = Number(earning.amount || 0);
            acc.total += amount;
            if (earning.details?.incomeType === 'tournaments') acc.tournaments += amount;
            else acc.openPlays += amount;
            return acc;
        }, { total: 0, openPlays: 0, tournaments: 0, expenses: 0, net: 0 });

        incomeTotals.expenses = allClubExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        incomeTotals.net = incomeTotals.total - incomeTotals.expenses;
        return incomeTotals;
    }, [allClubEarnings, allClubExpenses]);

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this Downtown Dinks earning?')) return;
        try {
            await onDeleteTransaction(id, true);
        } catch (error) {
            showToast(`Delete failed: ${error.message}`, 'error');
        }
    };

    const openCreateModal = () => {
        setEditingTransaction(null);
        setShowModal(true);
    };

    const openEditModal = (transaction) => {
        setEditingTransaction(transaction);
        setShowModal(true);
    };

    const renderTypeBadge = (incomeType) => (
        <span className={clsx(
            'badge',
            incomeType === 'tournaments'
                ? 'border-sky-500/40 text-sky-300'
                : 'border-emerald-500/40 text-emerald-300'
        )}>
            {incomeTypeLabel(incomeType)}
        </span>
    );

    const renderActions = (transaction, className = '') => (
        <div className={clsx('flex min-w-[88px] justify-end gap-1', className)}>
            <button
                type="button"
                onClick={() => openEditModal(transaction)}
                className="icon-btn size-10"
                aria-label="Edit"
            >
                <Edit2 size={16} aria-hidden="true" />
            </button>
            <button
                type="button"
                onClick={() => handleDelete(transaction.id)}
                className="icon-btn size-10 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                aria-label="Delete"
            >
                <Trash2 size={16} aria-hidden="true" />
            </button>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <h2 className="section-title flex items-center gap-2"><Trophy size={20} aria-hidden="true" className="text-ink-3" />Downtown Dinks</h2>
                    <p className="mt-1 text-sm text-ink-2">Club earnings from Open Plays and Tournaments</p>
                </div>
                <button type="button" onClick={openCreateModal} className="btn-primary whitespace-nowrap">
                    <Plus size={18} aria-hidden="true" /> Add Earning
                </button>
            </div>

            <div className="surface grid overflow-hidden sm:grid-cols-2 xl:grid-cols-5">
                <StatCard title="Total Earnings" amount={totals.total} icon={Banknote} tone="text-emerald-300" />
                <StatCard title="Club Expenses" amount={totals.expenses} icon={TrendingDown} tone="text-red-300" />
                <StatCard title="Net Earnings" amount={totals.net} icon={Banknote} tone={totals.net >= 0 ? 'text-emerald-300' : 'text-red-300'} />
                <StatCard title="Open Plays" amount={totals.openPlays} icon={Calendar} tone="text-ink" />
                <StatCard title="Tournaments" amount={totals.tournaments} icon={Trophy} tone="text-ink" />
            </div>

            <section className="surface p-4 sm:p-6" aria-labelledby="dinks-history-title">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <h3 id="dinks-history-title" className="section-title flex items-center gap-2">
                        <Calendar size={20} aria-hidden="true" className="text-ink-3" /> Earnings History
                    </h3>

                    <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                        <div className="relative flex-1 lg:w-72 lg:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                            <input
                                type="text"
                                aria-label="Search earnings"
                                placeholder="Search earnings..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="field pl-9 text-sm"
                            />
                        </div>
                        <div className="relative sm:w-48">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                            <select
                                aria-label="Filter income type"
                                value={filterType}
                                onChange={e => setFilterType(e.target.value)}
                                className="field pl-9 text-sm"
                            >
                                <option value="all">All Types</option>
                                {INCOME_TYPES.map(type => (
                                    <option key={type.value} value={type.value}>
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="divide-y divide-line sm:hidden">
                    {earnings.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-2">
                            No Downtown Dinks earnings found.
                        </div>
                    ) : (
                        earnings.map(earning => (
                            <div key={earning.id} className="py-4 first:pt-0 last:pb-0">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="break-words font-medium text-ink">{earning.description}</p>
                                        <div className="mt-2">{renderTypeBadge(earning.details?.incomeType)}</div>
                                    </div>
                                    <p className="num shrink-0 text-right font-semibold text-emerald-300">{formatCurrency(earning.amount)}</p>
                                </div>

                                <div className="mt-3 text-xs text-ink-2">
                                    {formatDate(earning.date)}
                                </div>

                                <div className="mt-3 flex justify-end border-t border-line pt-3">
                                    {renderActions(earning)}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left font-medium text-ink-2">
                                <th className="px-3 py-3 font-medium">Notes / Title</th>
                                <th className="px-3 py-3 font-medium">Type</th>
                                <th className="px-3 py-3 font-medium">Date</th>
                                <th className="px-3 py-3 text-right font-medium">Amount</th>
                                <th className="px-3 py-3 text-right font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {earnings.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-3 py-8 text-center text-ink-2">
                                        No Downtown Dinks earnings found.
                                    </td>
                                </tr>
                            ) : (
                                earnings.map(earning => (
                                    <tr key={earning.id} className="group border-b border-line transition-colors last:border-0 hover:bg-white/[0.04]">
                                        <td className="px-3 py-3 font-medium text-ink">{earning.description}</td>
                                        <td className="px-3 py-3">{renderTypeBadge(earning.details?.incomeType)}</td>
                                        <td className="px-3 py-3 text-ink-2">{formatDate(earning.date)}</td>
                                        <td className="num px-3 py-3 text-right font-semibold text-emerald-300">{formatCurrency(earning.amount)}</td>
                                        <td className="px-3 py-3 text-right">
                                            {renderActions(earning, 'opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100')}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {showModal && (
                <EarningModal
                    initialData={editingTransaction}
                    onAddTransaction={onAddTransaction}
                    onUpdateTransaction={onUpdateTransaction}
                    onClose={() => {
                        setShowModal(false);
                        setEditingTransaction(null);
                    }}
                />
            )}
        </div>
    );
}
