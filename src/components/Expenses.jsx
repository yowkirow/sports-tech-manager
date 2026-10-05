import React, { useState, useMemo } from 'react';
import { Search, Trash2, Calendar, Plus, User, Edit2, Check } from 'lucide-react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import AddExpenseForm from './Expenses/AddExpenseForm';

const CLUB_SLUG = 'downtown-dinks';

const FILTERS = [
    { value: 'all', label: 'All Types' },
    { value: 'blanks', label: 'Blanks' },
    { value: 'accessories', label: 'Accessories' },
    { value: 'general', label: 'General' },
    { value: 'downtown_dinks', label: 'Downtown Dinks' }
];

const Expenses = ({ transactions, onDeleteTransaction, onAddTransaction, onUpdateTransaction }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState(null);

    // Filter only expense transactions
    const expenses = useMemo(() => {
        return transactions
            .filter(t => t.type === 'expense')
            .filter(t => {
                const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesCategory = filterCategory === 'all' ||
                    (filterCategory === 'downtown_dinks' ? t.details?.club === CLUB_SLUG : t.category === filterCategory);
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [transactions, searchTerm, filterCategory]);

    const totalExpenses = expenses.reduce((sum, t) => sum + (t.amount || 0), 0);

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const isFullyReimbursed = (transaction) => {
        const rAmt = transaction.details?.reimbursedAmount;
        const amount = transaction.amount || 0;
        return (rAmt !== undefined && rAmt >= amount) || (rAmt === undefined && transaction.details?.reimbursed);
    };

    const toggleReimbursed = async (transaction) => {
        const amount = transaction.amount || 0;
        const newReimbursedAmount = isFullyReimbursed(transaction) ? 0 : amount;

        await onUpdateTransaction(transaction.id, {
            details: {
                ...transaction.details,
                reimbursedAmount: newReimbursedAmount,
                reimbursed: newReimbursedAmount > 0
            }
        });
    };

    const renderStatus = (transaction) => {
        const rAmt = transaction.details?.reimbursedAmount;
        const amount = transaction.amount || 0;

        if (rAmt !== undefined) {
            if (rAmt >= amount) {
                return (
                    <span className="badge border-emerald-500/40 text-emerald-300">
                        Reimbursed
                    </span>
                );
            } else if (rAmt > 0) {
                return (
                    <span className="badge border-amber-500/40 text-amber-300 num">
                        Partial (₱{rAmt.toLocaleString()})
                    </span>
                );
            }
        } else if (transaction.details?.reimbursed) {
            return (
                <span className="badge border-emerald-500/40 text-emerald-300">
                    Reimbursed
                </span>
            );
        }

        return (
            <span className="badge border-slate-600 text-ink-2">
                Pending
            </span>
        );
    };

    const renderCategory = (transaction) => {
        const label = transaction.details?.club === CLUB_SLUG ? 'Downtown Dinks' : transaction.category;
        const tone = transaction.details?.club === CLUB_SLUG
            ? 'border-emerald-500/40 text-emerald-300'
            : transaction.category === 'general'
                ? 'border-amber-500/40 text-amber-300'
                : 'border-slate-600 text-ink-2';

        return <span className={clsx('badge capitalize', tone)}>{label}</span>;
    };

    const renderActions = (transaction, className = '') => (
        <div className={clsx("flex min-w-[132px] justify-center gap-1", className)}>
            <button
                type="button"
                onClick={() => toggleReimbursed(transaction)}
                className={clsx(
                    "icon-btn",
                    isFullyReimbursed(transaction) ? "text-emerald-300" : "text-ink-2"
                )}
                title={isFullyReimbursed(transaction) ? "Unmark Reimbursed" : "Mark as Fully Reimbursed"}
                aria-label={isFullyReimbursed(transaction) ? "Unmark Reimbursed" : "Mark as Fully Reimbursed"}
            >
                <Check size={16} aria-hidden="true" />
            </button>
            <button
                type="button"
                onClick={() => {
                    setEditingTransaction(transaction);
                    setShowAddModal(true);
                }}
                className="icon-btn"
                title="Edit"
                aria-label="Edit"
            >
                <Edit2 size={16} aria-hidden="true" />
            </button>
            <button
                type="button"
                onClick={() => onDeleteTransaction(transaction.id)}
                className="icon-btn hover:text-red-300"
                title="Delete"
                aria-label="Delete"
            >
                <Trash2 size={16} aria-hidden="true" />
            </button>
        </div>
    );

    return (
        <div className="space-y-5">
            <div className="surface grid grid-cols-1 divide-y divide-line overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Total Expenses</p>
                    <p className="display mt-2 text-3xl text-red-400 num">₱{totalExpenses.toLocaleString()}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Records</p>
                    <p className="display mt-2 text-3xl num">{expenses.length}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Reimbursed</p>
                    <p className="display mt-2 text-3xl num">{expenses.filter(isFullyReimbursed).length}</p>
                </div>
            </div>

            <section className="surface overflow-hidden">
                <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="section-title flex items-center gap-2">
                            <Calendar size={20} className="text-ink-3" aria-hidden="true" /> Expense History
                        </h2>

                        <button
                            type="button"
                            onClick={() => { setEditingTransaction(null); setShowAddModal(true); }}
                            className="btn-primary w-full whitespace-nowrap sm:w-auto"
                        >
                            <Plus size={16} aria-hidden="true" /> Add Expense
                        </button>
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative min-w-0 lg:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                            <input
                                type="text"
                                aria-label="Search expenses"
                                placeholder="Search expenses..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="field pl-9 text-sm"
                            />
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Expense filters">
                            {FILTERS.map(filter => (
                                <button
                                    key={filter.value}
                                    type="button"
                                    onClick={() => setFilterCategory(filter.value)}
                                    className="chip"
                                    aria-pressed={filterCategory === filter.value}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="sm:hidden">
                    {expenses.length === 0 ? (
                        <div className="m-4 rounded-2xl border border-dashed border-line px-4 py-12 text-center text-ink-2">
                            No expenses found.
                        </div>
                    ) : (
                        <div className="divide-y divide-line">
                            {expenses.map(t => (
                                <div key={t.id} className="p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="break-words font-medium text-ink">{t.description}</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                {renderCategory(t)}
                                                {renderStatus(t)}
                                            </div>
                                        </div>
                                        <p className="shrink-0 text-right font-semibold text-red-400 num">₱{t.amount?.toLocaleString()}</p>
                                    </div>

                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                                        <span>{formatDate(t.date)}</span>
                                        {t.details?.quantity && <span className="num">QTY: {t.details.quantity}</span>}
                                        {t.details?.createdBy && (
                                            <span className="badge border-line text-ink-2">
                                                <User size={12} aria-hidden="true" /> {t.details.createdBy.split('@')[0]}
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-4 flex justify-end border-t border-line pt-3">
                                        {renderActions(t, 'justify-end')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[780px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-ink-2">
                                <th className="px-3 py-3 font-medium">Description</th>
                                <th className="px-3 py-3 font-medium">Category</th>
                                <th className="px-3 py-3 font-medium">Date</th>
                                <th className="px-3 py-3 text-center font-medium">Status</th>
                                <th className="px-3 py-3 text-right font-medium">Amount</th>
                                <th className="sticky right-0 z-10 bg-surface px-3 py-3 text-center font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-3 py-12 text-center text-ink-2">
                                        No expenses found.
                                    </td>
                                </tr>
                            ) : (
                                expenses.map(t => (
                                    <tr key={t.id} className="group border-b border-line transition-colors last:border-0 hover:bg-white/[0.04]">
                                        <td className="px-3 py-3 font-medium text-ink">
                                            {t.description}
                                            <div className="mt-1 flex items-center gap-2">
                                                {t.details?.quantity && <span className="text-xs text-ink-2 num">QTY: {t.details.quantity}</span>}
                                                {t.details?.createdBy && (
                                                    <span className="badge border-line text-ink-2">
                                                        <User size={12} aria-hidden="true" /> {t.details.createdBy.split('@')[0]}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            {renderCategory(t)}
                                        </td>
                                        <td className="px-3 py-3 text-ink-2">{formatDate(t.date)}</td>
                                        <td className="px-3 py-3 text-center">
                                            {renderStatus(t)}
                                        </td>
                                        <td className="px-3 py-3 text-right font-semibold text-red-400 num">
                                            ₱{t.amount?.toLocaleString()}
                                        </td>
                                        <td className="sticky right-0 z-10 bg-surface px-3 py-3 text-center group-hover:bg-[#171719]">
                                            {renderActions(t, "opacity-100")}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Add/Edit Expense Modal */}
            {showAddModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 sm:items-center sm:p-6">
                    <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-2xl">
                        <AddExpenseForm
                            onAddTransaction={onAddTransaction}
                            onUpdateTransaction={onUpdateTransaction}
                            initialData={editingTransaction}
                            onClose={() => { setShowAddModal(false); setEditingTransaction(null); }}
                        />
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Expenses;
