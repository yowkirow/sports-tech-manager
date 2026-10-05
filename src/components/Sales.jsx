import React, { useMemo, useState } from 'react';
import { Search, Trash2, Calendar, Edit2, User, Coins, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { isReturnedSale } from '../lib/transactionStatus';
import { withLocalDate } from '../lib/transactionDate';
import { useToast } from './ui/Toast';
// For Sales, better to just edit simple fields or redirect to Orders.
// User asked to "make it editable (Goal: summary of orders and amounts)"
// I'll implement a simple Edit Modal for Sales that allows changing: Date, Description (Customer), Amount (Override).

const EditSaleModal = ({ transaction, onUpdate, onClose }) => {
    const { showToast } = useToast();
    const [date, setDate] = useState(transaction.date.split('T')[0]);
    const [amount, setAmount] = useState(transaction.amount);
    const [description, setDescription] = useState(transaction.description);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const newDate = withLocalDate(date);

            await onUpdate(transaction.id, {
                date: newDate.toISOString(),
                amount: parseFloat(amount),
                description
            });
            showToast('Sale updated.', 'success');
            onClose();
        } catch (err) {
            console.error(err);
            showToast(`Could not save sale: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mx-auto flex max-h-[92dvh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sheet">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
                <h3 className="display text-2xl">Edit Sale Record</h3>
                <button type="button" onClick={onClose} className="icon-btn -mr-2 -mt-1" aria-label="Close">
                    <X size={22} aria-hidden="true" />
                </button>
            </div>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                    <div>
                        <label htmlFor="sale-edit-date" className="field-label">Date</label>
                        <input id="sale-edit-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="field w-full" />
                    </div>
                    <div>
                        <label htmlFor="sale-edit-description" className="field-label">Description</label>
                        <input id="sale-edit-description" value={description} onChange={e => setDescription(e.target.value)} className="field w-full" />
                    </div>
                    <div>
                        <label htmlFor="sale-edit-amount" className="field-label">Amount</label>
                        <input id="sale-edit-amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="field w-full num" />
                        <p className="mt-1.5 text-xs text-ink-2">Amount changes are retained as price adjustments when the order is edited.</p>
                    </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                    <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving...' : 'Save'}</button>
                </div>
            </form>
        </div>
    );
};

const Sales = ({ transactions, onDeleteTransaction, onUpdateTransaction }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [editingTransaction, setEditingTransaction] = useState(null);

    // Filter only sale transactions
    const sales = useMemo(() => {
        return transactions
            .filter(t => (t.type === 'sale' && !isReturnedSale(t) && !t.details?.removedFromOrder) || t.type === 'club_income')
            .filter(t => {
                const matchesSearch =
                    (t.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (t.details?.customerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (t.details?.club || '').toLowerCase().includes(searchTerm.toLowerCase());
                return matchesSearch;
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [transactions, searchTerm]);

    const totalSales = sales.reduce((sum, t) => sum + (t.amount || 0), 0);

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="space-y-5">
            <div className="surface grid grid-cols-1 divide-y divide-line overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Total Sales</p>
                    <p className="display mt-2 text-3xl text-emerald-300 num">₱{totalSales.toLocaleString()}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Records</p>
                    <p className="display mt-2 text-3xl num">{sales.length}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Average sale</p>
                    <p className="display mt-2 text-3xl num">₱{(sales.length ? totalSales / sales.length : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
            </div>

            <section className="surface overflow-hidden">
                <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <h2 className="section-title flex items-center gap-2">
                        <Calendar size={20} className="text-ink-3" aria-hidden="true" /> Sales History
                    </h2>

                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                        <input
                            type="text"
                            aria-label="Search sales"
                            placeholder="Search sales..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="field pl-9 text-sm"
                        />
                    </div>
                </div>

                <div className="sm:hidden">
                    {sales.length === 0 ? (
                        <div className="m-4 rounded-2xl border border-dashed border-line px-4 py-12 text-center text-ink-2">
                            No sales records found.
                        </div>
                    ) : (
                        <div className="divide-y divide-line">
                            {sales.map(t => (
                                <div key={t.id} className="p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="break-words font-medium text-ink">{t.description}</p>
                                            <p className="mt-1 text-sm text-ink-2">
                                                {t.details?.club === 'downtown-dinks' ? 'Downtown Dinks' : (t.details?.customerName || 'Unknown')}
                                            </p>
                                        </div>
                                        <p className="shrink-0 text-right font-semibold text-emerald-300 num">₱{t.amount?.toLocaleString()}</p>
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
                                    <div className="mt-4 flex justify-end gap-1 border-t border-line pt-3">
                                        <button
                                            type="button"
                                            onClick={() => setEditingTransaction(t)}
                                            className="icon-btn"
                                            title="Edit Record"
                                            aria-label="Edit Record"
                                        >
                                            <Edit2 size={16} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDeleteTransaction(t.id)}
                                            className="icon-btn hover:text-red-300"
                                            title="Delete Record"
                                            aria-label="Delete Record"
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-ink-2">
                                <th className="px-3 py-3 font-medium">Description</th>
                                <th className="px-3 py-3 font-medium">Customer</th>
                                <th className="px-3 py-3 font-medium">Date</th>
                                <th className="px-3 py-3 text-right font-medium">Amount</th>
                                <th className="px-3 py-3 text-center font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sales.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-3 py-12 text-center text-ink-2">
                                        No sales records found.
                                    </td>
                                </tr>
                            ) : (
                                sales.map(t => (
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
                                        <td className="px-3 py-3 text-ink-2">
                                            {t.details?.club === 'downtown-dinks' ? 'Downtown Dinks' : (t.details?.customerName || 'Unknown')}
                                        </td>
                                        <td className="px-3 py-3 text-ink-2">{formatDate(t.date)}</td>
                                        <td className="px-3 py-3 text-right font-semibold text-emerald-300 num">
                                            ₱{t.amount?.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <div className="flex justify-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingTransaction(t)}
                                                    className="icon-btn"
                                                    title="Edit Record"
                                                    aria-label="Edit Record"
                                                >
                                                    <Edit2 size={16} aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteTransaction(t.id)}
                                                    className="icon-btn hover:text-red-300"
                                                    title="Delete Record"
                                                    aria-label="Delete Record"
                                                >
                                                    <Trash2 size={16} aria-hidden="true" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Edit Modal */}
            {editingTransaction && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 sm:items-center sm:p-6">
                    <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl sm:rounded-2xl">
                        <EditSaleModal
                            transaction={editingTransaction}
                            onUpdate={onUpdateTransaction}
                            onClose={() => setEditingTransaction(null)}
                        />
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Sales;
