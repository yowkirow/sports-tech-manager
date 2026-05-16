import React, { useState, useMemo } from 'react';
import { Search, Trash2, Calendar, DollarSign, Filter, Plus, User, Edit2, Check } from 'lucide-react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import AddExpenseForm from './Expenses/AddExpenseForm';

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
                const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
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
                    <span className="px-2 py-1 rounded-md text-[10px] bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider">
                        Reimbursed
                    </span>
                );
            } else if (rAmt > 0) {
                return (
                    <span className="px-2 py-1 rounded-md text-[10px] bg-amber-500/20 text-amber-400 font-bold uppercase tracking-wider">
                        Partial (₱{rAmt.toLocaleString()})
                    </span>
                );
            }
        } else if (transaction.details?.reimbursed) {
            return (
                <span className="px-2 py-1 rounded-md text-[10px] bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider">
                    Reimbursed
                </span>
            );
        }

        return (
            <span className="px-2 py-1 rounded-md text-[10px] bg-slate-500/20 text-slate-500 font-bold uppercase tracking-wider">
                Pending
            </span>
        );
    };

    const renderActions = (transaction, className = '') => (
        <div className={clsx("flex min-w-[120px] gap-2 justify-center", className)}>
            <button
                onClick={() => toggleReimbursed(transaction)}
                className={clsx(
                    "p-2 rounded-lg transition-colors",
                    isFullyReimbursed(transaction) ? "text-emerald-400 hover:bg-emerald-500/10" : "text-slate-400 hover:text-white hover:bg-white/10"
                )}
                title={isFullyReimbursed(transaction) ? "Unmark Reimbursed" : "Mark as Fully Reimbursed"}
            >
                <Check size={16} />
            </button>
            <button
                onClick={() => {
                    setEditingTransaction(transaction);
                    setShowAddModal(true);
                }}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Edit"
            >
                <Edit2 size={16} />
            </button>
            <button
                onClick={() => onDeleteTransaction(transaction.id)}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                title="Delete"
            >
                <Trash2 size={16} />
            </button>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Stats Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="glass-panel p-6 rounded-2xl flex items-center gap-4">
                    <div className="p-4 rounded-xl bg-orange-500/10 text-orange-400">
                        <DollarSign size={32} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-400">Total Expenses</p>
                        <h3 className="text-2xl font-bold text-white">₱{totalExpenses.toLocaleString()}</h3>
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="glass-panel rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Calendar className="text-primary" /> Expense History
                    </h2>

                    <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row">
                        <div className="relative flex-1 sm:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search expenses..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="glass-input pl-9 py-2 text-sm"
                            />
                        </div>
                        <select
                            value={filterCategory}
                            onChange={e => setFilterCategory(e.target.value)}
                            className="glass-input py-2 text-sm w-32"
                        >
                            <option value="all" className="bg-slate-900">All Types</option>
                            <option value="blanks" className="bg-slate-900">Blanks</option>
                            <option value="accessories" className="bg-slate-900">Accessories</option>
                            <option value="general" className="bg-slate-900">General</option>
                        </select>
                        <button
                            onClick={() => { setEditingTransaction(null); setShowAddModal(true); }}
                            className="btn-primary py-2 px-4 text-sm whitespace-nowrap flex items-center gap-2"
                        >
                            <Plus size={16} /> Add Expense
                        </button>
                    </div>
                </div>

                <div className="space-y-3 sm:hidden">
                    {expenses.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            No expenses found.
                        </div>
                    ) : (
                        expenses.map(t => (
                            <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="break-words font-medium text-slate-100">{t.description}</p>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <span className={clsx(
                                                "px-2 py-1 rounded-md text-xs capitalize",
                                                t.category === 'blanks' ? "bg-indigo-500/20 text-indigo-300" :
                                                    t.category === 'general' ? "bg-rose-500/20 text-rose-300" : "bg-orange-500/20 text-orange-300"
                                            )}>
                                                {t.category}
                                            </span>
                                            {renderStatus(t)}
                                        </div>
                                    </div>
                                    <p className="shrink-0 text-right font-bold text-rose-400">₱{t.amount?.toLocaleString()}</p>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>{formatDate(t.date)}</span>
                                    {t.details?.quantity && <span>QTY: {t.details.quantity}</span>}
                                    {t.details?.createdBy && (
                                        <span className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                                            <User size={10} /> {t.details.createdBy.split('@')[0]}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
                                    {renderActions(t)}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[780px] text-left border-collapse">
                        <thead>
                            <tr className="text-slate-400 text-sm border-b border-white/5">
                                <th className="p-4 font-medium">Description</th>
                                <th className="p-4 font-medium">Category</th>
                                <th className="p-4 font-medium">Date</th>
                                <th className="p-4 font-medium text-center">Status</th>
                                <th className="p-4 font-medium text-right">Amount</th>
                                <th className="sticky right-0 z-10 bg-slate-900/95 p-4 font-medium text-center backdrop-blur">Action</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {expenses.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-slate-500">
                                        No expenses found.
                                    </td>
                                </tr>
                            ) : (
                                expenses.map(t => (
                                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                        <td className="p-4 text-slate-200 font-medium">
                                            {t.description}
                                            <div className="flex items-center gap-2 mt-1">
                                                {t.details?.quantity && <span className="text-xs text-slate-500">QTY: {t.details.quantity}</span>}
                                                {t.details?.createdBy && (
                                                    <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-slate-400 flex items-center gap-1">
                                                        <User size={10} /> {t.details.createdBy.split('@')[0]}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={clsx(
                                                "px-2 py-1 rounded-md text-xs capitalize",
                                                t.category === 'blanks' ? "bg-indigo-500/20 text-indigo-300" :
                                                    t.category === 'general' ? "bg-rose-500/20 text-rose-300" : "bg-orange-500/20 text-orange-300"
                                            )}>
                                                {t.category}
                                            </span>
                                        </td>
                                        <td className="p-4 text-slate-400">{formatDate(t.date)}</td>
                                        <td className="p-4 text-center">
                                            {renderStatus(t)}
                                        </td>
                                        <td className="p-4 text-right text-rose-400 font-bold">
                                            ₱{t.amount?.toLocaleString()}
                                        </td>
                                        <td className="sticky right-0 z-10 bg-slate-900/95 p-4 text-center backdrop-blur group-hover:bg-slate-800/95">
                                            {renderActions(t, "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100")}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add/Edit Expense Modal */}
            {showAddModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <AddExpenseForm
                        onAddTransaction={onAddTransaction}
                        onUpdateTransaction={onUpdateTransaction}
                        initialData={editingTransaction}
                        onClose={() => { setShowAddModal(false); setEditingTransaction(null); }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

export default Expenses;
