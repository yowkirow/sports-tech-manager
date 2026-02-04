import React, { useState, useMemo } from 'react';
import { Search, Trash2, Calendar, DollarSign, Filter, Edit2, User, Coins } from 'lucide-react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import AddExpenseForm from './Expenses/AddExpenseForm'; // Reusing form for editing? Or create new?
// For Sales, better to just edit simple fields or redirect to Orders.
// User asked to "make it editable (Goal: summary of orders and amounts)"
// I'll implement a simple Edit Modal for Sales that allows changing: Date, Description (Customer), Amount (Override).

const EditSaleModal = ({ transaction, onUpdate, onClose }) => {
    const [date, setDate] = useState(transaction.date.split('T')[0]);
    const [amount, setAmount] = useState(transaction.amount);
    const [description, setDescription] = useState(transaction.description);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onUpdate(transaction.id, {
                date: new Date(`${date}T12:00:00`).toISOString(),
                amount: parseFloat(amount),
                description
            });
            onClose();
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-sm w-full shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">Edit Sale Record</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="text-sm text-slate-400">Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="glass-input w-full" />
                </div>
                <div>
                    <label className="text-sm text-slate-400">Description</label>
                    <input value={description} onChange={e => setDescription(e.target.value)} className="glass-input w-full" />
                </div>
                <div>
                    <label className="text-sm text-slate-400">Amount</label>
                    <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="glass-input w-full" />
                    <p className="text-[10px] text-red-400 mt-1">Warning: Changing amount here desyncs from order items.</p>
                </div>
                <div className="flex gap-2 pt-2">
                    <button type="button" onClick={onClose} className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400">Cancel</button>
                    <button type="submit" disabled={loading} className="flex-1 py-2 btn-primary">{loading ? 'Saving...' : 'Save'}</button>
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
            .filter(t => t.type === 'sale')
            .filter(t => {
                const matchesSearch =
                    t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (t.details?.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());
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
        <div className="space-y-6">
            {/* Stats Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="glass-panel p-6 rounded-2xl flex items-center gap-4">
                    <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-400">
                        <Coins size={32} />
                    </div>
                    <div>
                        <p className="text-sm text-slate-400">Total Sales</p>
                        <h3 className="text-2xl font-bold text-white">₱{totalSales.toLocaleString()}</h3>
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="glass-panel rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Calendar className="text-primary" /> Sales History
                    </h2>

                    <div className="flex gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search sales..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="glass-input pl-9 py-2 text-sm w-64"
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-slate-400 text-sm border-b border-white/5">
                                <th className="p-4 font-medium">Description</th>
                                <th className="p-4 font-medium">Customer</th>
                                <th className="p-4 font-medium">Date</th>
                                <th className="p-4 font-medium text-right">Amount</th>
                                <th className="p-4 font-medium text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {sales.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-500">
                                        No sales records found.
                                    </td>
                                </tr>
                            ) : (
                                sales.map(t => (
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
                                        <td className="p-4 text-slate-300">
                                            {t.details?.customerName || 'Unknown'}
                                        </td>
                                        <td className="p-4 text-slate-400">{formatDate(t.date)}</td>
                                        <td className="p-4 text-right text-emerald-400 font-bold">
                                            ₱{t.amount?.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex gap-2 justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setEditingTransaction(t)}
                                                    className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                                    title="Edit Record"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => onDeleteTransaction(t.id)}
                                                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                                    title="Delete Record"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Modal */}
            {editingTransaction && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <EditSaleModal
                        transaction={editingTransaction}
                        onUpdate={onUpdateTransaction}
                        onClose={() => setEditingTransaction(null)}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

export default Sales;
