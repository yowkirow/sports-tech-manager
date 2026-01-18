import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, User, Search, Edit2, Save, X, Trash2 } from 'lucide-react';
import { useToast } from '../ui/Toast';

import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['paid', 'ready', 'shipped'];

export default function OrderManagement({ transactions, onAddTransaction, onDeleteTransaction }) {
    const { showToast } = useToast();
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    // Edit State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [loading, setLoading] = useState(false);

    // Filter only Sales
    const orders = useMemo(() => {
        return transactions.filter(t => t.type === 'sale')
            .filter(t => {
                const status = t.details?.status || 'paid';
                const matchesStatus = filterStatus === 'all' || status === filterStatus;
                const matchesSearch =
                    t.details?.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    t.description?.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesStatus && matchesSearch;
            });
    }, [transactions, filterStatus, searchTerm]);

    const startEditing = (order) => {
        setEditingId(order.id);
        setEditForm({
            customerName: order.details?.customerName || '',
            status: order.details?.status || 'paid'
        });
    };

    const handleSave = async (orderId) => {
        setLoading(true);
        try {
            // We need to update the specific transaction.
            // Since our `useSupabaseTransactions` adds new rows, we might need a way to UPDATE.
            // The current hook `addTransaction` uses INSERT.
            // We need a direct update using supabase here or extend the hook.
            // For now, I'll use supabase directly here for the update to keep it self-contained
            // effectively patching the record.

            // 1. Fetch original to preserve other details
            const original = transactions.find(t => t.id === orderId);
            if (!original) throw new Error("Order not found");

            const updatedDetails = {
                ...original.details,
                customerName: editForm.customerName,
                status: editForm.status
            };

            const { error } = await supabase
                .from('transactions')
                .update({
                    details: updatedDetails,
                    description: original.description.replace(original.details.customerName, editForm.customerName) // Attempt to keep desc synced
                })
                .eq('id', orderId);

            if (error) throw error;

            // Trigger a UI refresh if possible (the hook refetches on mount, but maybe we need a force refresh)
            // Ideally `onAddTransaction` handles state updates, but it's for ADD only.
            // We should probably expose `refetch` or just reload the page for now or rely on realtime if enabled.
            // For a smoother UX, I'll manually trigger a "fake" update via the prop if it supported update, 
            // but since it doesn't, I'll assume the parent component might need a way to refresh.
            // Actually, simplest way: Just reload or use a callback if provided.

            // Hack for immediate UI update if parent doesn't auto-refresh:
            window.location.reload(); // Simple but effective for this prototype phase

            showToast('Order updated!', 'success');
            setEditingId(null);
        } catch (err) {
            console.error(err);
            showToast('Failed to update order', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Package className="text-primary" /> Order Management
                </h2>

                <div className="flex gap-2 bg-white/5 p-1 rounded-xl">
                    {['all', ...STATUSES].map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${filterStatus === status
                                ? 'bg-primary text-white shadow-lg'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                    type="text"
                    placeholder="Search by customer name..."
                    className="glass-input pl-12"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                <AnimatePresence>
                    {orders.map(order => (
                        <motion.div
                            key={order.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass-card p-6 flex flex-col md:flex-row gap-6 md:items-center group"
                        >
                            {/* Status Icon */}
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                                {order.details?.status === 'shipped' ? <Truck className="text-blue-400" /> :
                                    order.details?.status === 'ready' ? <CheckCircle className="text-green-400" /> :
                                        <Clock className="text-orange-400" />
                                }
                            </div>

                            <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 text-slate-400 text-xs">
                                    <span>{new Date(order.date).toLocaleDateString()}</span>
                                    <span>•</span>
                                    <span className="font-mono custom-id-font">{order.id.slice(0, 8)}</span>
                                </div>

                                {editingId === order.id ? (
                                    <div className="flex items-center gap-2 mt-1">
                                        <User size={16} className="text-slate-500" />
                                        <input
                                            className="glass-input py-1 px-2 text-sm max-w-[200px]"
                                            value={editForm.customerName}
                                            onChange={e => setEditForm({ ...editForm, customerName: e.target.value })}
                                        />
                                    </div>
                                ) : (
                                    <h3 className="font-bold text-white text-lg">{order.details?.customerName}</h3>
                                )}

                                <p className="text-primary text-sm font-medium">
                                    {order.description}
                                </p>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <span className="text-xl font-bold text-white">₱{order.amount.toLocaleString()}</span>

                                {editingId === order.id ? (
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={editForm.status}
                                            onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                                            className="glass-input py-1 px-2 text-xs capitalize"
                                        >
                                            {STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                        </select>
                                        <button
                                            onClick={() => handleSave(order.id)}
                                            disabled={loading}
                                            className="p-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30"
                                        >
                                            <Save size={16} />
                                        </button>
                                        <button
                                            onClick={() => setEditingId(null)}
                                            className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize border ${order.details?.status === 'shipped' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                            order.details?.status === 'ready' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                                                'bg-orange-500/10 border-orange-500/20 text-orange-400'
                                            }`}>
                                            {order.details?.status || 'paid'}
                                        </span>
                                        <button
                                            onClick={() => {
                                                if (confirm('Are you sure you want to delete this order?')) {
                                                    onDeleteTransaction(order.id);
                                                }
                                            }}
                                            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                            title="Delete Order"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => startEditing(order)}
                                            className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                    {orders.length === 0 && (
                        <div className="text-center text-slate-500 mt-20">
                            <Package size={48} className="mx-auto mb-4 opacity-50" />
                            <p>No orders found</p>
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
