import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, User, Search, Edit2, Save, X, Trash2, Layers, ChevronDown, ChevronUp, ShoppingBag, Loader2 } from 'lucide-react';
import { useToast } from '../ui/Toast';

import { supabase } from '../../lib/supabaseClient';

const STATUSES = ['paid', 'in_progress', 'ready', 'shipped'];
const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];

export default function OrderManagement({ transactions, onAddTransaction, onDeleteTransaction, refetch }) {
    const { showToast } = useToast();
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    // Group Expansion State
    const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());

    // Edit State
    const [editingId, setEditingId] = useState(null); // Values: 'orderId'
    const [editForm, setEditForm] = useState({});
    const [loading, setLoading] = useState(false);

    // Bulk Selection State
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false);

    // 1. Group Transactions into Orders
    const groupedOrders = useMemo(() => {
        const sales = transactions.filter(t => t.type === 'sale');
        const groups = {};

        sales.forEach(t => {
            // Determine grouping key: Use orderId if available, else fallback to Customer + Minute
            let key = t.details?.orderId;
            if (!key) {
                // Fallback for legacy: Group by Customer + Date (Minute precision)
                const dateKey = new Date(t.date).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
                key = `${t.details?.customerName || 'Unknown'}-${dateKey}`;
            }

            if (!groups[key]) {
                groups[key] = {
                    id: key, // This is the virtual Order ID
                    date: t.date,
                    customerName: t.details?.customerName || 'Unknown',
                    customerName: t.details?.customerName || 'Unknown',
                    status: t.details?.status || 'paid', // Use status from first item
                    paymentMode: t.details?.paymentMode || 'Cash', // Use MOP from first item
                    items: [], // Individual transactions
                    totalAmount: 0
                };
            }

            groups[key].items.push(t);
            groups[key].totalAmount += t.amount;
        });

        // Convert to array and sort by date desc
        return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));

    }, [transactions]);

    // 2. Filter Groups
    const filteredOrders = useMemo(() => {
        return groupedOrders.filter(order => {
            const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
            const matchesSearch =
                order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.id.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesStatus && matchesSearch;
        });
    }, [groupedOrders, filterStatus, searchTerm]);


    const toggleExpansion = (orderId) => {
        const newSet = new Set(expandedOrderIds);
        if (newSet.has(orderId)) newSet.delete(orderId);
        else newSet.add(orderId);
        setExpandedOrderIds(newSet);
    };

    const toggleSelection = (id) => {
        const newSet = new Set(selectedOrderIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedOrderIds(newSet);
    };

    const startEditing = (order) => {
        setEditingId(order.id);
        setEditForm({
            customerName: order.customerName,
            status: order.status,
            paymentMode: order.paymentMode || 'Cash'
        });
    };

    const handleSave = async (orderId) => {
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) throw new Error("Order not found");

            // Update ALL transactions in this group
            const updates = order.items.map(async (t) => {
                const updatedDetails = {
                    ...t.details,
                    customerName: editForm.customerName,
                    status: editForm.status,
                    paymentMode: editForm.paymentMode
                };

                const { error } = await supabase
                    .from('transactions')
                    .update({
                        details: updatedDetails,
                        description: t.description.replace(t.details.customerName, editForm.customerName) // Attempt to sync desc
                    })
                    .eq('id', t.id);
                if (error) throw error;
            });

            await Promise.all(updates);

            showToast('Order updated!', 'success');
            setEditingId(null);
            if (refetch) await refetch();

        } catch (err) {
            console.error(err);
            showToast('Failed to update order', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteOrder = async (orderId) => {
        if (!confirm('Delete this entire order? This removes all items in it.')) return;
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) return;

            // Delete all transactions in group
            for (const item of order.items) {
                await onDeleteTransaction(item.id);
            }

            showToast('Order deleted', 'success');
            if (refetch) await refetch();
        } catch (err) {
            showToast('Delete failed', 'error');
        } finally {
            setLoading(false);
        }
    }

    // Bulk Actions (Operating on Order Groups)
    const handleBulkStatusUpdate = async (newStatus, newPaymentMode = null) => {
        const action = newStatus ? `Update status to "${newStatus}"` : `Update payment to "${newPaymentMode}"`;
        if (!confirm(`${action} for ${selectedOrderIds.size} orders?`)) return;
        setLoading(true);
        try {
            for (const orderId of selectedOrderIds) {
                const order = groupedOrders.find(o => o.id === orderId);
                if (!order) continue;

                // Update all items in this order
                const updates = order.items.map(item => {
                    const updateData = {};
                    if (newStatus) updateData.status = newStatus;
                    if (newPaymentMode) updateData.paymentMode = newPaymentMode;

                    return supabase.from('transactions')
                        .update({ details: { ...item.details, ...updateData } })
                        .eq('id', item.id)
                });
                await Promise.all(updates);
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
        if (!confirm(`Delete ${selectedOrderIds.size} orders?`)) return;
        setLoading(true);
        try {
            for (const orderId of selectedOrderIds) {
                const order = groupedOrders.find(o => o.id === orderId);
                if (!order) continue;

                for (const item of order.items) {
                    await onDeleteTransaction(item.id);
                }
            }
            showToast('Bulk delete complete', 'success');
            setIsSelectionMode(false);
            setSelectedOrderIds(new Set());
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Bulk delete failed', 'error');
        } finally {
            setLoading(false);
        }
    }


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
                                    {s.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowBulkPaymentModal(true)}
                            className="bg-white/10 text-slate-300 hover:bg-white/20 px-4 py-2 rounded-xl transition-colors text-xs font-bold whitespace-nowrap"
                        >
                            Edit Payment
                        </button>
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
                    {filteredOrders.map(order => (
                        <motion.div
                            key={order.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`glass-card overflow-hidden transition-all duration-200 ${isSelectionMode && selectedOrderIds.has(order.id) ? 'ring-2 ring-primary bg-primary/5' : ''
                                }`}
                        >
                            {/* Main Order Header */}
                            <div
                                className="p-6 flex flex-col md:flex-row gap-6 md:items-center cursor-pointer group"
                                onClick={() => {
                                    if (isSelectionMode) toggleSelection(order.id);
                                    else toggleExpansion(order.id);
                                }}
                            >
                                {/* Checkbox */}
                                {isSelectionMode && (
                                    <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selectedOrderIds.has(order.id)
                                        ? 'bg-primary border-primary'
                                        : 'border-white/20 bg-black/20'
                                        }`}>
                                        {selectedOrderIds.has(order.id) && <CheckCircle size={14} className="text-white" />}
                                    </div>
                                )}

                                {/* Status Icon */}
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${order.status === 'shipped' ? 'bg-blue-500/10 text-blue-400' :
                                    order.status === 'ready' ? 'bg-purple-500/10 text-purple-400' :
                                        order.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
                                            order.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                                                'bg-orange-500/10 text-orange-400'
                                    }`}>
                                    {order.status === 'shipped' ? <Truck size={20} /> :
                                        order.status === 'ready' ? <Package size={20} /> :
                                            order.status === 'in_progress' ? <Loader2 size={20} className="animate-spin" /> :
                                                order.status === 'paid' ? <CheckCircle size={20} /> :
                                                    <Clock size={20} />
                                    }
                                </div>

                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                                        <span>{new Date(order.date).toLocaleDateString()}</span>
                                        <span>•</span>
                                        <span className="font-mono custom-id-font">{order.items.length} Items</span>
                                        <span>•</span>
                                        <span className="text-primary">{order.paymentMode}</span>
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
                                        <h3 className="font-bold text-white text-lg">{order.customerName}</h3>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                    <span className="text-xl font-bold text-white">₱{order.totalAmount.toLocaleString()}</span>

                                    {editingId === order.id ? (
                                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                            <select
                                                value={editForm.paymentMode}
                                                onChange={e => setEditForm({ ...editForm, paymentMode: e.target.value })}
                                                className="glass-input py-1 px-2 text-xs"
                                            >
                                                {PAYMENT_MODES.map(m => <option key={m} value={m} className="bg-slate-900">{m}</option>)}
                                            </select>
                                            <select
                                                value={editForm.status}
                                                onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                                                className="glass-input py-1 px-2 text-xs capitalize"
                                            >
                                                {STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s.replace('_', ' ')}</option>)}
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
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize border ${order.status === 'shipped' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                                order.status === 'ready' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                                                    'bg-orange-500/10 border-orange-500/20 text-orange-400'
                                                }`}>
                                                {order.status.replace('_', ' ')}
                                            </span>

                                            {!isSelectionMode && (
                                                <>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteOrder(order.id);
                                                        }}
                                                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); startEditing(order); }}
                                                        className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        className="p-2 text-slate-500 hover:text-white transition-colors"
                                                    >
                                                        {expandedOrderIds.has(order.id) ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Expanded Items */}
                            <AnimatePresence>
                                {expandedOrderIds.has(order.id) && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="border-t border-white/5 bg-white/5"
                                    >
                                        <div className="p-4 space-y-2">
                                            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2 px-2">Order Items</p>
                                            {order.items.map(item => (
                                                <div key={item.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                                                            <ShoppingBag size={14} />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm text-slate-200 font-medium">{item.details?.itemName || 'Unknown Item'}</p>
                                                            <p className="text-xs text-slate-500">
                                                                {item.details?.size && `Size: ${item.details.size}`}
                                                                {item.details?.color && ` • ${item.details.color}`}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm text-white">₱{(item.amount).toLocaleString()}</p>
                                                        <p className="text-xs text-slate-500">Qty: {item.details?.quantity || 1}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    ))}
                    {filteredOrders.length === 0 && (
                        <div className="text-center text-slate-500 mt-20">
                            <Package size={48} className="mx-auto mb-4 opacity-50" />
                            <p>No orders found</p>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bulk Payment Modal */}
            <AnimatePresence>
                {showBulkPaymentModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="glass-panel p-6 max-w-sm w-full"
                        >
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xl font-bold text-white">Bulk Edit Payment</h3>
                                <button onClick={() => setShowBulkPaymentModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
                            </div>
                            <p className="text-sm text-slate-400 mb-4">Select new payment mode for {selectedOrderIds.size} orders:</p>
                            <div className="grid grid-cols-2 gap-2">
                                {PAYMENT_MODES.map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => {
                                            handleBulkStatusUpdate(null, mode);
                                            setShowBulkPaymentModal(false);
                                        }}
                                        className="p-3 rounded-lg bg-white/5 hover:bg-primary/20 hover:text-primary transition-colors text-sm font-bold text-slate-200 border border-white/5 hover:border-primary/50"
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
