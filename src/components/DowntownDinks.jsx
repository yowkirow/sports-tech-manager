import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Banknote, Calendar, Edit2, Filter, Loader2, Plus, Save, Search, Trash2, TrendingDown, Trophy, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from './ui/Toast';
import { isReturnedSale } from '../lib/transactionStatus';

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
    const [y, m, d] = date.split('-').map(Number);
    const nextDate = new Date();
    nextDate.setFullYear(y);
    nextDate.setMonth(m - 1);
    nextDate.setDate(d);
    return nextDate;
};

const StatCard = ({ title, amount, icon: Icon, tone }) => (
    <div className="glass-panel rounded-2xl p-6 flex items-center gap-4">
        <div className={clsx("p-4 rounded-xl", tone)}>
            <Icon size={30} />
        </div>
        <div className="min-w-0">
            <p className="text-sm text-slate-400">{title}</p>
            <h3 className="text-2xl font-bold text-white truncate">{formatCurrency(amount)}</h3>
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
            const { data: { user } } = await supabase.auth.getUser();

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
        <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full mx-auto shadow-2xl relative flex flex-col">
            <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                <h2 className="text-xl font-bold text-white">{initialData ? 'Edit Earning' : 'Add Earning'}</h2>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white transition-colors bg-white/5 p-2 rounded-lg hover:bg-white/10"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Income Type</label>
                        <select
                            value={incomeType}
                            onChange={(e) => setIncomeType(e.target.value)}
                            className="glass-input appearance-none"
                            required
                        >
                            {INCOME_TYPES.map(type => (
                                <option key={type.value} value={type.value} className="bg-slate-900">
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Amount (₱)</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="glass-input"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Notes / Title</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="glass-input"
                            placeholder="e.g. Saturday open play"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="glass-input appearance-none w-full"
                            required
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full py-3"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : (initialData ? <Save size={18} /> : <Plus size={18} />)}
                            {loading ? 'Saving...' : (initialData ? 'Update Earning' : 'Add Earning')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default function DowntownDinks({ transactions, onAddTransaction, onUpdateTransaction, onDeleteTransaction }) {
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
        await onDeleteTransaction(id, true);
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
            "px-2 py-1 rounded-md text-xs font-bold",
            incomeType === 'tournaments'
                ? "bg-purple-500/20 text-purple-300"
                : "bg-emerald-500/20 text-emerald-300"
        )}>
            {incomeTypeLabel(incomeType)}
        </span>
    );

    const renderActions = (transaction, className = '') => (
        <div className={clsx("flex min-w-[84px] gap-2 justify-center", className)}>
            <button
                onClick={() => openEditModal(transaction)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Edit"
            >
                <Edit2 size={16} />
            </button>
            <button
                onClick={() => handleDelete(transaction.id)}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                title="Delete"
            >
                <Trash2 size={16} />
            </button>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-500/20 rounded-xl text-emerald-400">
                        <Trophy size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Downtown Dinks</h2>
                        <p className="text-sm text-slate-400">Club earnings from Open Plays and Tournaments</p>
                    </div>
                </div>
                <button
                    onClick={openCreateModal}
                    className="btn-primary py-3 px-4 text-sm whitespace-nowrap"
                >
                    <Plus size={18} /> Add Earning
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
                <StatCard title="Total Earnings" amount={totals.total} icon={Banknote} tone="bg-emerald-500/10 text-emerald-400" />
                <StatCard title="Club Expenses" amount={totals.expenses} icon={TrendingDown} tone="bg-rose-500/10 text-rose-400" />
                <StatCard title="Net Earnings" amount={totals.net} icon={Banknote} tone={totals.net >= 0 ? "bg-cyan-500/10 text-cyan-400" : "bg-rose-500/10 text-rose-400"} />
                <StatCard title="Open Plays" amount={totals.openPlays} icon={Calendar} tone="bg-cyan-500/10 text-cyan-400" />
                <StatCard title="Tournaments" amount={totals.tournaments} icon={Trophy} tone="bg-purple-500/10 text-purple-400" />
            </div>

            <div className="glass-panel rounded-2xl p-4 sm:p-6">
                <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Calendar className="text-primary" /> Earnings History
                    </h3>

                    <div className="flex flex-col gap-2 w-full sm:flex-row lg:w-auto">
                        <div className="relative flex-1 lg:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search earnings..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="glass-input pl-9 py-2 text-sm"
                            />
                        </div>
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select
                                value={filterType}
                                onChange={e => setFilterType(e.target.value)}
                                className="glass-input pl-9 py-2 text-sm min-w-40 appearance-none"
                            >
                                <option value="all" className="bg-slate-900">All Types</option>
                                {INCOME_TYPES.map(type => (
                                    <option key={type.value} value={type.value} className="bg-slate-900">
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="space-y-3 sm:hidden">
                    {earnings.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            No Downtown Dinks earnings found.
                        </div>
                    ) : (
                        earnings.map(earning => (
                            <div key={earning.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="break-words font-medium text-slate-100">{earning.description}</p>
                                        <div className="mt-2">{renderTypeBadge(earning.details?.incomeType)}</div>
                                    </div>
                                    <p className="shrink-0 text-right font-bold text-emerald-400">{formatCurrency(earning.amount)}</p>
                                </div>

                                <div className="mt-3 text-xs text-slate-500">
                                    {formatDate(earning.date)}
                                </div>

                                <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
                                    {renderActions(earning)}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[720px] text-left border-collapse">
                        <thead>
                            <tr className="text-slate-400 text-sm border-b border-white/5">
                                <th className="p-4 font-medium">Notes / Title</th>
                                <th className="p-4 font-medium">Type</th>
                                <th className="p-4 font-medium">Date</th>
                                <th className="p-4 font-medium text-right">Amount</th>
                                <th className="p-4 font-medium text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {earnings.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-500">
                                        No Downtown Dinks earnings found.
                                    </td>
                                </tr>
                            ) : (
                                earnings.map(earning => (
                                    <tr key={earning.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                        <td className="p-4 text-slate-200 font-medium">{earning.description}</td>
                                        <td className="p-4">{renderTypeBadge(earning.details?.incomeType)}</td>
                                        <td className="p-4 text-slate-400">{formatDate(earning.date)}</td>
                                        <td className="p-4 text-right text-emerald-400 font-bold">{formatCurrency(earning.amount)}</td>
                                        <td className="p-4 text-center">
                                            {renderActions(earning, "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100")}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <EarningModal
                        initialData={editingTransaction}
                        onAddTransaction={onAddTransaction}
                        onUpdateTransaction={onUpdateTransaction}
                        onClose={() => {
                            setShowModal(false);
                            setEditingTransaction(null);
                        }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
}
