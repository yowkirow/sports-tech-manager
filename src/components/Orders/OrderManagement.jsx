import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, User, Search, Edit2, Save, X, Trash2, Layers } from 'lucide-react';
import { useToast } from '../ui/Toast';

import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['paid', 'ready', 'shipped'];

export default function OrderManagement({ transactions, onAddTransaction, onDeleteTransaction, refetch }) {
    const { showToast } = useToast();
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    // Edit State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [loading, setLoading] = useState(false);

    // Bulk Selection State
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

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

    const toggleSelection = (id) => {
        const newSet = new Set(selectedOrderIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedOrderIds(newSet);
    };

    const handleBulkStatusUpdate = async (newStatus) => {
        if (!window.confirm(`Update status to "${newStatus}" for ${selectedOrderIds.size} orders?`)) return;
        setLoading(true);
        try {
            // Process each selected order
            for (const id of selectedOrderIds) {
                const original = transactions.find(t => t.id === id);
                if (!original) continue;

                const updatedDetails = { ...original.details, status: newStatus };
                const { error } = await supabase
                    .from('transactions')
                    .update({ details: updatedDetails })
                    .eq('id', id);
                if (error) throw error;
            }
            showToast('Bulk update complete', 'success');
            setIsSelectionMode(false);
            setSelectedOrderIds(new Set());
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Bulk update failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (!window.confirm(`Delete ${selectedOrderIds.size} orders? This cannot be undone.`)) return;
        setLoading(true);
        try {
            for (const id of selectedOrderIds) {
                await onDeleteTransaction(id);
            }
            showToast('Bulk delete complete', 'success');
            setIsSelectionMode(false);
            setSelectedOrderIds(new Set());
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Bulk delete partially failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (orderId) => {
        setLoading(true);
        try {
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
                    description: original.description.replace(original.details.customerName, editForm.customerName)
                })
                .eq('id', orderId);

            if (error) throw error;

            showToast('Order updated!', 'success');
            setEditingId(null);

            // Soft Refresh
            if (refetch) {
                await refetch();
            } else {
                // Fallback if refetch isn't available
                window.location.reload();
            }

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

            <div className="relative flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by customer name..."
                        className="glass-input pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {isSelectionMode ? (
                    <div className="flex gap-2 animate-fade-in">
                        <div className="flex bg-white/5 rounded-xl overflow-hidden divide-x divide-white/10 border border-white/10">
                            {STATUSES.map(s => (
                                <button
                                    key={s}
                                    onClick={() => handleBulkStatusUpdate(s)}
                                    className="px-3 py-2 text-xs font-bold text-slate-300 hover:bg-primary hover:text-white transition-colors capitalize"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={handleBulkDelete}
                            className="bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-colors"
                        >
                            <Trash2 size={20} />
                        </button>
                        <button
                            onClick={() => { setIsSelectionMode(false); setSelectedOrderIds(new Set()); }}
                            className="bg-white/10 text-slate-300 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setIsSelectionMode(true)}
                        className="btn-secondary whitespace-nowrap"
                    >
                        <Layers size={20} /> Multi-Select
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                <AnimatePresence>
                    {orders.map(order => (
                        <motion.div
                            key={order.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            onClick={() => isSelectionMode && toggleSelection(order.id)}
                            className={`glass-card p-6 flex flex-col md:flex-row gap-6 md:items-center group transition-all duration-200 cursor-pointer ${isSelectionMode && selectedOrderIds.has(order.id)
                                    ? 'ring-2 ring-primary bg-primary/5'
                                    : ''
                                }`}
                        >
                            {/* Checkbox for Selection Mode */}
                            {isSelectionMode && (
                                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selectedOrderIds.has(order.id)
                                        ? 'bg-primary border-primary'
                                        : 'border-white/20 bg-black/20'
                                    }`}>
                                    {selectedOrderIds.has(order.id) && <CheckCircle size={14} className="text-white" />}
                                </div>
                            )}

                            {/* Status Icon */}
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                                {order.details?.status === 'shipped' ? <Truck className="text-blue-400" /> :
                                    order.details?.status === 'ready' ? <CheckCircle className="text-green-400" /> :
                                        <Clock className="text-orange-400" />
                                }
                            </div>

                            <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 text-slate-400 text-xs">
                                    <span>{new Date(order.date).toLocaleDateString()} const</span>
                                    <span>•</span>
                                    <span className="font-mono custom-id-font">{order.id.slice(0, 8)}</span>
                                </div>

                                {editingId === order.id ? (
                                    <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                                        <User size={16} className="text-slate-500" />
                                        <input
                                            className="glass-input py-1 px-2 text-sm max-w-[200px]"
                                            value={editForm.customerName}
                                            onChange={e => setEditForm({ ...editForm, customerName: e.target.value })}
                                            autoFocus
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
                                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
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
                                        {!isSelectionMode && (
                                            <>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm('Are you sure you want to delete this order?')) {
                                                            onDeleteTransaction(order.id);
                                                            // For single delete, onDeleteTransaction usually updates state or reload happens via prop
                                                        }
                                                    }}
                                                    className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Delete Order"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEditing(order); }}
                                                    className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                            </>
                                        )}
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
