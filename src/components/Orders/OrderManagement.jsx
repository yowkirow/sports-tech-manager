import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, User, Search, Edit2, Save, X, Trash2, Layers, ChevronDown, ChevronUp, ShoppingBag, Loader2, AlertCircle, Banknote, Filter } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { supabase } from '../../lib/supabaseClient';

const FULFILLMENT_STATUSES = ['pending', 'in_progress', 'ready', 'shipped', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid'];
const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];

export default function OrderManagement({ transactions, onAddTransaction, onDeleteTransaction, refetch, userRole }) {
    const { showToast } = useToast();
    const isReseller = userRole === 'reseller';
    const [filterFulfillment, setFilterFulfillment] = useState('all');
    const [filterPayment, setFilterPayment] = useState('all'); // 'all', 'paid', 'unpaid'
    const [searchTerm, setSearchTerm] = useState('');

    // Group Expansion State
    const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());

    // Edit State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [loading, setLoading] = useState(false);

    // Bulk Actions
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [showBulkEditModal, setShowBulkEditModal] = useState(false);

    // 1. Group Transactions & Migrate Data
    const groupedOrders = useMemo(() => {
        const sales = transactions.filter(t => t.type === 'sale');
        const groups = {};

        sales.forEach(t => {
            let key = t.details?.orderId;
            if (!key) {
                const dateKey = new Date(t.date).toISOString().slice(0, 16);
                key = `${t.details?.customerName || 'Unknown'}-${dateKey}`;
            }

            if (!groups[key]) {
                // --- MIGRATION LOGIC ---
                let fulfillment = t.details?.fulfillmentStatus;
                let payment = t.details?.paymentStatus;

                if (!fulfillment || !payment) {
                    // Fallback for old data
                    const legacyStatus = t.details?.status || 'paid';
                    if (legacyStatus === 'paid') {
                        fulfillment = 'pending';
                        payment = 'paid';
                    } else {
                        fulfillment = legacyStatus; // in_progress, ready, shipped
                        // If it's shipped/ready, we don't strictly know if it's paid, 
                        // but typically 'shipped' implies paid or COD. 
                        // Safest default is 'unpaid' so user checks it, OR 'paid' if COD.
                        // Let's default to 'unpaid' for safety unless it was implicitly 'paid'.
                        payment = 'unpaid';
                    }
                }

                groups[key] = {
                    id: key,
                    date: t.date,
                    customerName: t.details?.customerName || 'Unknown',
                    fulfillmentStatus: fulfillment,
                    paymentStatus: payment,
                    paymentMode: t.details?.paymentMode || 'Cash',
                    isOnlineOrder: t.details?.isOnlineOrder || false,
                    items: [],
                    totalAmount: 0
                };
            }

            if (t.details?.isOnlineOrder) groups[key].isOnlineOrder = true; // Ensure flag is set if any item has it

            groups[key].items.push(t);
            groups[key].totalAmount += t.amount;
        });

        return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [transactions]);

    // 2. Filter Groups
    const filteredOrders = useMemo(() => {
        return groupedOrders.filter(order => {
            const matchesFulfillment = filterFulfillment === 'all' || order.fulfillmentStatus === filterFulfillment;
            const matchesPayment = filterPayment === 'all' || order.paymentStatus === filterPayment;
            const matchesSearch =
                order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.id.toLowerCase().includes(searchTerm.toLowerCase());

            return matchesFulfillment && matchesPayment && matchesSearch;
        });
    }, [groupedOrders, filterFulfillment, filterPayment, searchTerm]);


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
            fulfillmentStatus: order.fulfillmentStatus,
            paymentStatus: order.paymentStatus,
            paymentMode: order.paymentMode,
            trackingNumber: order.items[0]?.details?.trackingNumber || '',
            date: new Date(order.date).toISOString().split('T')[0] // Initialize date
        });
    };

    const handleSave = async (orderId) => {
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) throw new Error("Order not found");

            const [y, m, d] = editForm.date.split('-').map(Number);
            const newDate = new Date();
            newDate.setFullYear(y);
            newDate.setMonth(m - 1);
            newDate.setDate(d);
            const isoDate = newDate.toISOString();

            const updates = order.items.map(async (t) => {
                const updatedDetails = {
                    ...t.details,
                    customerName: editForm.customerName,
                    fulfillmentStatus: editForm.fulfillmentStatus,
                    paymentStatus: editForm.paymentStatus,
                    paymentMode: editForm.paymentMode,
                    trackingNumber: editForm.trackingNumber,
                    // Remove legacy status to avoid confusion, or keep it synced to fulfillment?
                    // Let's keep it synced to fulfillment for safety if other components read it
                    status: editForm.fulfillmentStatus
                };

                const { error } = await supabase
                    .from('transactions')
                    .update({
                        details: updatedDetails,
                        description: t.description.replace(t.details.customerName, editForm.customerName),
                        date: isoDate // Explicit Time (Now)
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

    const handleQuickTracking = async (orderId, trackingNumber) => {
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) return;

            const updates = order.items.map(async (t) => {
                const updatedDetails = {
                    ...t.details,
                    trackingNumber,
                    fulfillmentStatus: trackingNumber ? 'shipped' : t.details.fulfillmentStatus, // Only auto-ship if adding number
                    status: trackingNumber ? 'shipped' : t.details.status
                };

                const { error } = await supabase.from('transactions').update({ details: updatedDetails }).eq('id', t.id);
                if (error) throw error;
            });

            await Promise.all(updates);

            showToast('Tracking updated', 'success');

            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Update failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteOrder = async (orderId) => {
        if (!confirm('Delete this entire order?')) return;
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) return;
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

    const handleBulkUpdate = async (updates) => {
        if (!confirm(`Update ${selectedOrderIds.size} orders?`)) return;
        setLoading(true);
        try {
            for (const orderId of selectedOrderIds) {
                const order = groupedOrders.find(o => o.id === orderId);
                if (!order) continue;

                const dbUpdates = order.items.map(item => {
                    const newDetails = { ...item.details, ...updates };
                    // Sync legacy field
                    if (updates.fulfillmentStatus) newDetails.status = updates.fulfillmentStatus;

                    return supabase.from('transactions')
                        .update({ details: newDetails })
                        .eq('id', item.id)
                });
                await Promise.all(dbUpdates);
            }
            showToast('Bulk update complete', 'success');
            setIsSelectionMode(false);
            setSelectedOrderIds(new Set());
            setShowBulkEditModal(false);
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Bulk update failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                <div className="flex items-center gap-4 w-full xl:w-auto">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2 whitespace-nowrap">
                        <Package className="text-primary" /> Order Management
                    </h2>
                </div>

                <div className="flex flex-wrap gap-2 w-full xl:w-auto">
                    {/* Fulfillment Filter */}
                    <div className="flex bg-white/5 p-1 rounded-xl overflow-x-auto">
                        {['all', ...FULFILLMENT_STATUSES].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterFulfillment(status)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all ${filterFulfillment === status
                                    ? 'bg-primary text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {status.replace('_', ' ')}
                            </button>
                        ))}
                    </div>

                    {/* Payment Filter */}
                    <div className="flex bg-white/5 p-1 rounded-xl">
                        {['all', 'paid', 'unpaid'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterPayment(status)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all ${filterPayment === status
                                    ? 'bg-emerald-600 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="relative flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search customer or ID..."
                        className="glass-input pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {isSelectionMode ? (
                    <div className="flex gap-2 animate-fade-in">
                        <button
                            onClick={() => setShowBulkEditModal(true)}
                            className="bg-primary text-white hover:bg-primary-hover px-4 py-2 rounded-xl transition-colors text-sm font-bold whitespace-nowrap flex items-center gap-2"
                        >
                            <Edit2 size={16} /> Bulk Edit
                        </button>
                        <button
                            onClick={async () => {
                                if (confirm(`Delete ${selectedOrderIds.size} orders?`)) {
                                    setLoading(true);
                                    try {
                                        for (const orderId of selectedOrderIds) {
                                            const order = groupedOrders.find(o => o.id === orderId);
                                            if (order) {
                                                for (const item of order.items) await onDeleteTransaction(item.id);
                                            }
                                        }
                                        setIsSelectionMode(false);
                                        setSelectedOrderIds(new Set());
                                        if (refetch) await refetch();
                                        showToast('Deleted', 'success');
                                    } finally { setLoading(false); }
                                }
                            }}
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
                            className={`glass-card overflow-hidden transition-all duration-200 ${isSelectionMode && selectedOrderIds.has(order.id) ? 'ring-2 ring-primary bg-primary/5' : ''}`}
                        >
                            {/* Order Header */}
                            <div
                                className="p-4 lg:p-6 flex flex-col md:flex-row gap-4 md:items-center cursor-pointer group"
                                onClick={() => {
                                    if (isSelectionMode) toggleSelection(order.id);
                                    else toggleExpansion(order.id);
                                }}
                            >
                                {isSelectionMode && (
                                    <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${selectedOrderIds.has(order.id)
                                        ? 'bg-primary border-primary'
                                        : 'border-white/20 bg-black/20'
                                        }`}>
                                        {selectedOrderIds.has(order.id) && <CheckCircle size={14} className="text-white" />}
                                    </div>
                                )}

                                {/* Status Icon (Fulfillment) */}
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${order.fulfillmentStatus === 'shipped' ? 'bg-blue-500/10 text-blue-400' :
                                    order.fulfillmentStatus === 'ready' ? 'bg-purple-500/10 text-purple-400' :
                                        order.fulfillmentStatus === 'in_progress' ? 'bg-orange-500/10 text-orange-400' :
                                            order.fulfillmentStatus === 'cancelled' ? 'bg-red-500/10 text-red-400' :
                                                'bg-slate-500/10 text-slate-400'
                                    }`}>
                                    {order.fulfillmentStatus === 'shipped' ? <Truck size={20} /> :
                                        order.fulfillmentStatus === 'ready' ? <Package size={20} /> :
                                            order.fulfillmentStatus === 'in_progress' ? <Loader2 size={20} className="animate-spin" /> :
                                                order.fulfillmentStatus === 'cancelled' ? <X size={20} /> :
                                                    <Clock size={20} />
                                    }
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
                                        {editingId === order.id ? (
                                            <input
                                                className="glass-input py-1 px-2 text-lg font-bold w-full max-w-[200px]"
                                                value={editForm.customerName}
                                                onChange={e => setEditForm({ ...editForm, customerName: e.target.value })}
                                                onClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <h3 className="font-bold text-white text-lg truncate">{order.customerName}</h3>
                                        )}

                                        {/* Badges */}
                                        <div className="flex items-center gap-2">
                                            {order.isOnlineOrder && order.fulfillmentStatus === 'pending' && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-500/20 text-blue-400 border border-blue-500/20 animate-pulse">
                                                    *New
                                                </span>
                                            )}
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${order.paymentStatus === 'paid'
                                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                                                }`}>
                                                {order.paymentStatus}
                                            </span>
                                            {/* ID showing for admins only? or everyone? Let's keep it */}
                                            <span className="text-xs text-slate-500 font-mono hidden sm:inline">{order.id.slice(-6)}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 text-slate-400 text-xs">
                                        <span>{new Date(order.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        <span>•</span>
                                        <span>{order.items.length} Items</span>
                                        <span>•</span>
                                        <span className="text-primary flex items-center gap-1">
                                            <Banknote size={12} /> {order.paymentMode}
                                        </span>
                                        {order.items[0]?.details?.createdBy && (
                                            <>
                                                <span>•</span>
                                                <span className="flex items-center gap-1 text-slate-500">
                                                    <User size={12} /> {order.items[0].details.createdBy.split('@')[0]}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-2 shrink-0">
                                    <span className="text-xl font-bold text-white">₱{order.totalAmount.toLocaleString()}</span>

                                    {editingId === order.id ? (
                                        <div className="flex flex-col gap-2 items-end bg-black/40 p-3 rounded-xl border border-white/10 shadow-xl z-10" onClick={e => e.stopPropagation()}>
                                            <div className="grid grid-cols-2 gap-2 w-full max-w-[300px]">
                                                {/* Date Input */}
                                                <div className="col-span-2">
                                                    <label className="text-[10px] text-slate-500 font-bold uppercase ml-1">Order Date</label>
                                                    <input
                                                        type="date"
                                                        value={editForm.date || ''}
                                                        onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                                                        className="glass-input py-1.5 text-xs w-full"
                                                    />
                                                </div>

                                                {/* Tracking Number Input */}
                                                <div className="col-span-2 relative">
                                                    <Truck className="absolute left-2 top-[60%] -translate-y-1/2 text-slate-500" size={14} />
                                                    <input
                                                        placeholder="Tracking Number"
                                                        value={editForm.trackingNumber || ''}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setEditForm(prev => ({
                                                                ...prev,
                                                                trackingNumber: val,
                                                                fulfillmentStatus: val ? 'shipped' : prev.fulfillmentStatus
                                                            }));
                                                        }}
                                                        className="glass-input pl-8 py-1.5 text-xs w-full"
                                                    />
                                                </div>

                                                {!isReseller && (
                                                    <select
                                                        value={editForm.fulfillmentStatus}
                                                        onChange={e => setEditForm({ ...editForm, fulfillmentStatus: e.target.value })}
                                                        className="glass-input py-1 px-2 text-xs capitalize"
                                                    >
                                                        {FULFILLMENT_STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s.replace('_', ' ')}</option>)}
                                                    </select>
                                                )}
                                                <select
                                                    value={editForm.paymentStatus}
                                                    onChange={e => setEditForm({ ...editForm, paymentStatus: e.target.value })}
                                                    className="glass-input py-1 px-2 text-xs capitalize"
                                                >
                                                    {PAYMENT_STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                                </select>
                                                <select
                                                    value={editForm.paymentMode}
                                                    onChange={e => setEditForm({ ...editForm, paymentMode: e.target.value })}
                                                    className="glass-input py-1 px-2 text-xs col-span-2"
                                                >
                                                    {PAYMENT_MODES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex gap-2 w-full">
                                                <button onClick={() => handleSave(order.id)} className="flex-1 bg-green-600/20 text-green-400 py-1.5 rounded hover:bg-green-600/40 font-bold text-xs"><Save size={14} className="mx-auto" /></button>
                                                <button onClick={() => setEditingId(null)} className="flex-1 bg-red-600/20 text-red-400 py-1.5 rounded hover:bg-red-600/40 text-xs"><X size={14} className="mx-auto" /></button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="flex items-center gap-2">
                                                {/* Quick Tracking Input */}
                                                <div className="relative group/tracking z-20" onClick={e => e.stopPropagation()}>
                                                    <Truck size={14} className={`absolute left-2 top-1/2 -translate-y-1/2 ${order.items[0]?.details?.trackingNumber ? 'text-primary' : 'text-slate-500'}`} />
                                                    <input
                                                        defaultValue={order.items[0]?.details?.trackingNumber || ''}
                                                        placeholder="Add Tracking"
                                                        className={`py-1.5 pl-8 pr-2 text-xs w-32 focus:w-48 transition-all rounded-lg border outline-none ${order.items[0]?.details?.trackingNumber
                                                            ? 'bg-primary/10 border-primary/30 text-primary font-mono font-bold'
                                                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 focus:bg-white/10 focus:border-white/20'
                                                            }`}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.target.blur();
                                                            }
                                                        }}
                                                        onBlur={(e) => {
                                                            const val = e.target.value.trim();
                                                            const current = order.items[0]?.details?.trackingNumber || '';
                                                            if (val !== current) {
                                                                handleQuickTracking(order.id, val);
                                                            }
                                                        }}
                                                    />
                                                </div>

                                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize border ${order.fulfillmentStatus === 'shipped' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                                    order.fulfillmentStatus === 'ready' ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' :
                                                        order.fulfillmentStatus === 'in_progress' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                                                            order.fulfillmentStatus === 'cancelled' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                                                'bg-slate-500/10 border-slate-500/20 text-slate-400'
                                                    }`}>
                                                    {order.fulfillmentStatus.replace('_', ' ')}
                                                </span>
                                                {!isSelectionMode && (
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={(e) => { e.stopPropagation(); startEditing(order); }} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><Edit2 size={16} /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order.id); }} className="p-2 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400"><Trash2 size={16} /></button>
                                                    </div>
                                                )}
                                                <div className="p-2 text-slate-500">
                                                    {expandedOrderIds.has(order.id) ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                                </div>
                                            </div>


                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Expanded Items */}
                            <AnimatePresence>
                                {expandedOrderIds.has(order.id) && (
                                    <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: 'auto' }}
                                        exit={{ height: 0 }}
                                        className="bg-white/5 border-t border-white/5"
                                    >
                                        <div className="p-4 space-y-2">
                                            {order.items.map(item => (
                                                <div key={item.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-white/5 text-sm">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                                                            <ShoppingBag size={14} />
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-200">{item.details?.itemName}</p>
                                                            <p className="text-xs text-slate-500">{item.details?.size} • {item.details?.color}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-mono text-white">₱{item.amount.toLocaleString()}</p>
                                                        <p className="text-xs text-slate-500">x{item.details?.quantity}</p>
                                                    </div>
                                                </div>
                                            ))}
                                            {/* Shipping Information for POS and Online Orders */}
                                            {(order.items[0]?.details?.shippingDetails || order.items[0]?.details?.customerProvince) && (
                                                <div className="mt-4 p-3 bg-white/5 rounded-xl border border-white/5">
                                                    <p className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2"><Truck size={12} /> Shipping Information</p>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                        <div>
                                                            <p className="text-slate-400 text-xs text-uppercase font-bold mb-1">Address</p>
                                                            <p className="text-white">
                                                                {order.items[0].details.shippingDetails?.address || order.items[0].details.customerAddress || 'No address provided'}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className="text-slate-400 text-xs text-uppercase font-bold mb-1">Contact</p>
                                                            <p className="text-white">
                                                                {order.items[0].details.shippingDetails?.contactNumber || order.items[0].details.customerContact || order.items[0].details.contactNumber || 'N/A'}
                                                            </p>
                                                        </div>
                                                        <div className="col-span-1 md:col-span-2">
                                                            <p className="text-slate-400 text-xs text-uppercase font-bold mb-1">Details (Barangay, City, Province)</p>
                                                            <p className="text-white">
                                                                {order.items[0].details.shippingDetails ? (
                                                                    `${order.items[0].details.shippingDetails.city}, ${order.items[0].details.shippingDetails.province} ${order.items[0].details.shippingDetails.zipCode || ''}`
                                                                ) : (
                                                                    `${order.items[0].details.customerBarangay ? order.items[0].details.customerBarangay + ', ' : ''}${order.items[0].details.customerCity ? order.items[0].details.customerCity + ', ' : ''}${order.items[0].details.customerProvince || ''}`
                                                                )}
                                                            </p>
                                                        </div>
                                                        {order.items[0].details.trackingNumber && (
                                                            <div className="col-span-1 md:col-span-2 mt-2 pt-2 border-t border-white/5">
                                                                <p className="text-slate-400 text-xs flex items-center gap-2 mb-1"><Truck size={10} /> Tracking Number</p>
                                                                <p className="text-primary font-mono font-bold tracking-wider">{order.items[0].details.trackingNumber}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Proof of Payment Display */}
                                            {order.items[0]?.details?.proofOfPayment && (
                                                <div className="mt-2 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                                                    <p className="text-xs font-bold text-emerald-400 uppercase mb-2 flex items-center gap-2"><CheckCircle size={12} /> Proof of Payment</p>
                                                    <div className="relative group">
                                                        <img
                                                            src={order.items[0].details.proofOfPayment}
                                                            className="h-32 rounded-lg bg-black/40 object-contain cursor-pointer transition-transform hover:scale-105"
                                                            onClick={() => window.open(order.items[0].details.proofOfPayment, '_blank')}
                                                        />
                                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <span className="bg-black/80 text-white text-xs px-2 py-1 rounded">Click to View</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    ))}
                    {filteredOrders.length === 0 && (
                        <div className="text-center text-slate-500 mt-20">
                            <Package size={48} className="mx-auto mb-4 opacity-50" />
                            <p>No orders matched your filters</p>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bulk Edit Modal */}
            <AnimatePresence>
                {showBulkEditModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="glass-panel p-6 max-w-sm w-full"
                        >
                            <h3 className="text-xl font-bold text-white mb-4">Bulk Update ({selectedOrderIds.size})</h3>

                            <div className="space-y-4">
                                <div>
                                    {!isReseller && (
                                        <>
                                            <label className="text-xs font-bold text-slate-500 uppercase">Fulfillment Status</label>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {FULFILLMENT_STATUSES.map(s => (
                                                    <button key={s} onClick={() => handleBulkUpdate({ fulfillmentStatus: s })} className="px-3 py-1 bg-white/5 hover:bg-primary hover:text-white rounded-lg text-xs capitalize transition-colors border border-white/5">
                                                        {s.replace('_', ' ')}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Payment Status</label>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {PAYMENT_STATUSES.map(s => (
                                            <button key={s} onClick={() => handleBulkUpdate({ paymentStatus: s })} className="px-3 py-1 bg-white/5 hover:bg-emerald-600 hover:text-white rounded-lg text-xs capitalize transition-colors border border-white/5">
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <button onClick={() => setShowBulkEditModal(false)} className="mt-6 w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400">Cancel</button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
