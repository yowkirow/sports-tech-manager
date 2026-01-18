import React, { useState, useMemo } from 'react';
import { Search, Trash2, Calendar, DollarSign, Filter, Plus } from 'lucide-react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import AddExpenseForm from './Expenses/AddExpenseForm';

const Expenses = ({ transactions, onDeleteTransaction, onAddTransaction }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [showAddModal, setShowAddModal] = useState(false);

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

                    <div className="flex gap-2 w-full sm:w-auto">
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
                            onClick={() => setShowAddModal(true)}
                            className="btn-primary py-2 px-4 text-sm whitespace-nowrap flex items-center gap-2"
                        >
                            <Plus size={16} /> Add Expense
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-slate-400 text-sm border-b border-white/5">
                                <th className="p-4 font-medium">Description</th>
                                <th className="p-4 font-medium">Category</th>
                                <th className="p-4 font-medium">Date</th>
                                <th className="p-4 font-medium text-right">Amount</th>
                                <th className="p-4 font-medium text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {expenses.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-500">
                                        No expenses found.
                                    </td>
                                </tr>
                            ) : (
                                expenses.map(t => (
                                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                        <td className="p-4 text-slate-200 font-medium">
                                            {t.description}
                                            {t.details?.quantity && <span className="text-xs text-slate-500 block">QTY: {t.details.quantity}</span>}
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
                                        <td className="p-4 text-right text-rose-400 font-bold">
                                            ₱{t.amount?.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => onDeleteTransaction(t.id)}
                                                className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                title="Delete Transaction"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Expense Modal */}
            {showAddModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <AddExpenseForm
                        onAddTransaction={onAddTransaction}
                        onClose={() => setShowAddModal(false)}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

export default Expenses;
