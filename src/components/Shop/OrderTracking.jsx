import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, CheckCircle, Clock, Truck, ShieldCheck, Search, ArrowLeft, Copy, ShoppingCart, MapPin, Phone, User, ExternalLink, X, Plus, Minus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';

const STATUS_STEPS = [
    { key: 'pending', label: 'Order Placed', icon: Clock, description: 'We have received your order.' },
    { key: 'in_progress', label: 'Processing', icon: Package, description: 'We are preparing your items.' },
    { key: 'ready', label: 'Ready', icon: CheckCircle, description: 'Your order is ready for pickup or shipping.' },
    { key: 'shipped', label: 'Shipped', icon: Truck, description: 'Your order is on its way!' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

export default function OrderTracking() {
    const { showToast } = useToast();
    const [orderId, setOrderId] = useState('');
    const [contactVerify, setContactVerify] = useState('');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isVerified, setIsVerified] = useState(false);

    // Editing State
    const [isEditing, setIsEditing] = useState(false);
    const [editItems, setEditItems] = useState([]);
    const [editDetails, setEditDetails] = useState(null);
    const [saving, setSaving] = useState(false);

    // Get order ID from URL on mount
    useEffect(() => {
        const path = window.location.pathname;
        const match = path.match(/\/track\/([^/]+)/);
        if (match && match[1]) {
            setOrderId(match[1]);
        }
    }, []);

    const fetchOrder = async (id, contact) => {
        setLoading(true);
        try {
            let query = supabase
                .from('transactions')
                .select('*')
                .eq('type', 'sale');

            if (id) {
                // If ID is provided (from URL), search by orderId
                query = query.filter('details->>orderId', 'eq', id);
            } else {
                // If no ID, search by contact number and get the latest order
                query = query.eq('details->>contactNumber', contact.trim())
                    .order('date', { ascending: false });
            }

            const { data, error } = await query;

            if (error) throw error;

            if (!data || data.length === 0) {
                showToast('Order not found', 'error');
                return;
            }

            // If we searched by contact without ID, we take the most recent order's ID
            const activeOrderId = id || data[0].details.orderId;

            // Filter all items belonging to this specific orderId
            const orderItems = id ? data : data.filter(item => item.details.orderId === activeOrderId);

            const firstItem = orderItems[0];
            const storedContact = firstItem.details.contactNumber || firstItem.details.shippingDetails?.contactNumber;

            // Verify contact if we came from a specific ID link
            if (id && storedContact !== contact && !storedContact.endsWith(contact)) {
                showToast('Verification failed. Invalid contact number.', 'error');
                return;
            }

            // Success - store the group of items
            setOrder({
                id: activeOrderId,
                items: orderItems,
                details: firstItem.details,
                date: firstItem.date
            });
            setOrderId(activeOrderId); // Ensure state is updated for real-time channel
            setIsVerified(true);
            showToast('Order verified!', 'success');

        } catch (err) {
            console.error(err);
            showToast('Error fetching order', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Real-time subscription
    useEffect(() => {
        if (!isVerified || !orderId || isEditing) return;

        const channel = supabase
            .channel(`order-track-${orderId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'transactions',
                },
                (payload) => {
                    // Check if this transaction belongs to our current order
                    const tx = payload.new || payload.old;
                    if (tx?.details?.orderId === orderId) {
                        setOrder(prev => {
                            if (!prev) return prev;

                            if (payload.eventType === 'INSERT') {
                                if (prev.items.find(i => i.id === payload.new.id)) return prev;
                                return { ...prev, items: [...prev.items, payload.new] };
                            }

                            if (payload.eventType === 'UPDATE') {
                                const updatedItems = prev.items.map(item =>
                                    item.id === payload.new.id ? { ...item, ...payload.new } : item
                                );
                                return {
                                    ...prev,
                                    items: updatedItems,
                                    details: { ...prev.details, ...payload.new.details }
                                };
                            }

                            if (payload.eventType === 'DELETE') {
                                return {
                                    ...prev,
                                    items: prev.items.filter(i => i.id !== payload.old.id)
                                };
                            }

                            return prev;
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [isVerified, orderId, isEditing]);

    const handleVerify = (e) => {
        e.preventDefault();
        if (!contactVerify) return;
        fetchOrder(orderId, contactVerify);
    };

    const startEditing = () => {
        setEditItems(order.items.map(item => ({
            id: item.id,
            name: item.details.itemName,
            size: item.details.size,
            quantity: item.details.quantity,
            imageUrl: item.details.imageUrl,
            price: item.details.originalAmount / item.details.quantity
        })));
        setEditDetails({
            customerName: order.details.customerName,
            contactNumber: order.details.contactNumber,
            address: order.details.shippingDetails.address,
            city: order.details.shippingDetails.city,
            province: order.details.shippingDetails.province,
            barangay: order.details.shippingDetails.barangay,
        });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (editItems.length === 0) {
            return showToast('Order cannot be empty', 'error');
        }

        setSaving(true);
        try {
            // Updated details for all transactions
            const updatedFulfillmentDetails = {
                ...order.details,
                customerName: editDetails.customerName,
                contactNumber: editDetails.contactNumber,
                shippingDetails: {
                    ...order.details.shippingDetails,
                    address: editDetails.address,
                    city: editDetails.city,
                    province: editDetails.province,
                    barangay: editDetails.barangay,
                    contactNumber: editDetails.contactNumber, // Added to sync with shipping details
                }
            };

            // Process each item
            for (const item of editItems) {
                const originalRow = order.items.find(i => i.id === item.id);

                if (originalRow) {
                    // Update existing row
                    const newTotal = item.price * item.quantity;
                    const updates = {
                        amount: newTotal - (updatedFulfillmentDetails.discountShare / editItems.length), // Simplified discount split
                        details: {
                            ...updatedFulfillmentDetails,
                            size: item.size,
                            quantity: item.quantity,
                            originalAmount: newTotal
                        }
                    };

                    const { error } = await supabase
                        .from('transactions')
                        .update(updates)
                        .eq('id', item.id);

                    if (error) throw error;
                }
            }

            // Remove deleted rows (items removed from editItems)
            const removedIds = order.items
                .filter(orig => !editItems.some(edited => edited.id === orig.id))
                .map(orig => orig.id);

            if (removedIds.length > 0) {
                const { error } = await supabase
                    .from('transactions')
                    .delete()
                    .in('id', removedIds);
                if (error) throw error;
            }

            showToast('Order updated successfully!', 'success');
            setIsEditing(false);
            // Re-fetch to get clean state
            fetchOrder(orderId, contactVerify);
        } catch (err) {
            console.error(err);
            showToast('Failed to update order', 'error');
        } finally {
            setSaving(false);
        }
    };

    const currentStatus = order?.details?.fulfillmentStatus || 'pending';
    const statusIdx = STATUS_STEPS.findIndex(s => s.key === currentStatus);
    const canEdit = currentStatus === 'pending';

    if (!isVerified) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-panel p-8 max-w-md w-full"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 rounded-2xl bg-primary/20 text-primary">
                            <ShieldCheck size={32} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-white">Track Order</h2>
                            <p className="text-slate-400 text-sm">Verify your identity to proceed</p>
                        </div>
                    </div>

                    <form onSubmit={handleVerify} className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase ml-1">Contact Number</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="tel"
                                    value={contactVerify}
                                    onChange={e => setContactVerify(e.target.value)}
                                    placeholder="Enter your registered number"
                                    className="glass-input pl-12 w-full py-3"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full py-4 font-bold flex items-center justify-center gap-2"
                        >
                            {loading ? <Clock className="animate-spin" /> : 'Track Order'}
                        </button>
                    </form>

                    <button
                        onClick={() => window.location.href = '/'}
                        className="w-full mt-4 text-sm text-slate-500 hover:text-white flex items-center justify-center gap-2 transition-colors"
                    >
                        <ArrowLeft size={14} /> Back to Shop
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
            <header className="h-20 border-b border-white/5 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-4 md:px-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="SportsTech" className="h-10 w-auto object-contain cursor-pointer" onClick={() => window.location.href = '/'} />
                    <div className="h-8 w-[1px] bg-white/10 mx-2 hidden sm:block" />
                    <h2 className="text-lg font-bold text-white hidden sm:block">Track Order</h2>
                </div>
                <div className="flex items-center gap-4">
                    {canEdit && !isEditing && (
                        <button
                            onClick={startEditing}
                            className="text-primary hover:bg-primary/10 px-4 py-2 rounded-xl text-sm font-bold border border-primary/20 transition-all flex items-center gap-2"
                        >
                            Modify Order
                        </button>
                    )}
                    <button
                        onClick={() => window.location.href = '/'}
                        className="text-slate-400 hover:text-white flex items-center gap-2 text-sm font-medium"
                    >
                        <ArrowLeft size={18} /> Back to Shop
                    </button>
                </div>
            </header>

            <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6">
                {!isEditing ? (
                    <>
                        {/* Header Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass-panel p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                            <div>
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                                    Order ID: <span className="text-primary">{orderId.slice(0, 8)}...</span>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(orderId);
                                            showToast('ID copied!', 'success');
                                        }}
                                        className="p-1 hover:bg-white/5 rounded transition-colors"
                                    >
                                        <Copy size={12} />
                                    </button>
                                </div>
                                <h1 className="text-2xl font-bold text-white">Hello, {order.details.customerName}!</h1>
                                <p className="text-slate-400 text-sm mt-1">Placed on {new Date(order.date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/5">
                                <div className={`w-2 h-2 rounded-full animate-pulse ${currentStatus === 'shipped' ? 'bg-green-500' : 'bg-primary'}`} />
                                <span className="text-sm font-bold uppercase tracking-wider">
                                    {currentStatus.replace('_', ' ')}
                                </span>
                            </div>
                        </motion.div>

                        {/* Status Timeline */}
                        <section className="glass-panel p-6 md:p-8">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-8">Order Status</h3>

                            <div className="relative">
                                {/* Progress Line */}
                                <div className="absolute left-6 md:left-1/2 md:-translate-x-1/2 top-0 bottom-0 w-1 bg-white/5 hidden sm:block" />
                                <div
                                    className="absolute left-6 md:left-1/2 md:-translate-x-1/2 top-0 w-1 bg-primary transition-all duration-1000 hidden sm:block"
                                    style={{ height: `${(statusIdx / (STATUS_STEPS.length - 1)) * 100}%` }}
                                />

                                <div className="space-y-12">
                                    {STATUS_STEPS.map((step, index) => {
                                        const isCompleted = index <= statusIdx;
                                        const isCurrent = index === statusIdx;
                                        return (
                                            <div key={step.key} className="relative flex items-start sm:items-center gap-6 md:gap-0">
                                                <div className="md:w-1/2 md:pr-12 md:text-right hidden md:block">
                                                    {index % 2 === 0 && (
                                                        <div className={isCompleted ? 'opacity-100' : 'opacity-30'}>
                                                            <h4 className="font-bold text-white text-lg">{step.label}</h4>
                                                            <p className="text-sm text-slate-400">{step.description}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-500 shrink-0
                                                    ${isCompleted ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20' : 'bg-slate-800 border-white/10 text-slate-500'}`}
                                                >
                                                    <step.icon size={20} />
                                                    {isCurrent && (
                                                        <motion.div
                                                            layoutId="outline"
                                                            className="absolute -inset-2 border border-primary rounded-full animate-ping opacity-20"
                                                        />
                                                    )}
                                                </div>

                                                <div className="md:w-1/2 md:pl-12">
                                                    {(index % 2 !== 0 || window.innerWidth < 768) && (
                                                        <div className={isCompleted ? 'opacity-100' : 'opacity-30'}>
                                                            <h4 className="font-bold text-white text-lg">{step.label}</h4>
                                                            <p className="text-sm text-slate-400">{step.description}</p>
                                                        </div>
                                                    )}
                                                    {index % 2 === 0 && window.innerWidth >= 768 && <div className="invisible md:block" />}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </section>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Order Summary */}
                            <div className="glass-panel p-6 flex flex-col">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <ShoppingCart size={14} className="text-primary" /> Order Summary
                                </h3>
                                <div className="flex-1 space-y-4">
                                    {order.items.map(item => (
                                        <div key={item.id} className="flex gap-4">
                                            <div className="w-16 h-20 bg-black/40 rounded-lg overflow-hidden shrink-0 border border-white/5">
                                                {item.details.imageUrl ? (
                                                    <img src={item.details.imageUrl} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-700">
                                                        <Package size={24} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-bold text-white leading-tight">{item.details.itemName}</h4>
                                                <p className="text-xs text-slate-400 mt-1">Size: {item.details.size} • Qty: {item.details.quantity}</p>
                                                <p className="text-primary font-mono text-sm mt-1">₱{(item.details.price || 0).toLocaleString()}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-6 pt-4 border-t border-white/5 space-y-2">
                                    <div className="flex justify-between text-sm text-slate-400">
                                        <span>Subtotal</span>
                                        <span>₱{(order.items.reduce((acc, item) => acc + (item.details.originalAmount || item.amount), 0)).toLocaleString()}</span>
                                    </div>
                                    {order.details.discountShare > 0 && (
                                        <div className="flex justify-between text-sm text-emerald-400">
                                            <span>Discount</span>
                                            <span>-₱{order.details.discountShare.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm text-slate-400">
                                        <span>Shipping</span>
                                        <span>₱{(order.details.shippingDetails?.shippingFee || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-lg font-bold text-white pt-2">
                                        <span>Total Paid</span>
                                        <span>₱{(order.items.reduce((acc, item) => acc + item.amount, 0) + (order.details.shippingDetails?.shippingFee || 0)).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Shipping Details */}
                            <div className="glass-panel p-6 space-y-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <MapPin size={14} className="text-primary" /> Delivery Info
                                </h3>

                                <div className="space-y-4">
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                                            <User size={18} className="text-slate-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">Customer</p>
                                            <p className="text-white font-medium">{order.details.customerName}</p>
                                            <p className="text-slate-400 text-sm">{order.details.contactNumber}</p>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                                            <MapPin size={18} className="text-slate-400" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">Shipping Address</p>
                                            <p className="text-white font-medium">{order.details.shippingDetails.address}</p>
                                            <p className="text-slate-400 text-sm">
                                                {order.details.shippingDetails.barangay}, {order.details.shippingDetails.city}
                                                {order.details.shippingDetails.province ? `, ${order.details.shippingDetails.province}` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                                            <Clock size={18} className="text-slate-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">Payment Mode</p>
                                            <p className="text-white font-medium uppercase">{order.details.paymentMode}</p>
                                            <p className="text-slate-400 text-sm">Cutoff: Every Thursday</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-start gap-3">
                                    <ShieldCheck className="text-primary shrink-0 transition-transform mt-0.5" size={18} />
                                    <p className="text-xs text-slate-300">
                                        This order is tracked in real-time. You will see status updates automatically on this page as they happen.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    /* Edit Mode UI */
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-6"
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-white">Modify Order</h2>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsEditing(false)}
                                    className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm font-bold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="btn-primary px-6 py-2 flex items-center gap-2"
                                >
                                    {saving ? <Clock className="animate-spin" size={16} /> : 'Save Changes'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Items Edit */}
                            <div className="lg:col-span-2 glass-panel p-6 space-y-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Order Items</h3>
                                <div className="space-y-6">
                                    {editItems.map((item, idx) => (
                                        <div key={item.id} className="flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 group">
                                            <div className="w-20 h-24 bg-black/40 rounded-xl overflow-hidden shrink-0 border border-white/5 relative">
                                                {item.imageUrl ? (
                                                    <img src={item.imageUrl} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-700">
                                                        <Package size={32} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 space-y-3">
                                                <div className="flex justify-between items-start">
                                                    <h4 className="font-bold text-white text-lg">{item.name}</h4>
                                                    <button
                                                        onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                                                        className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                                                        title="Remove Item"
                                                    >
                                                        <X size={18} />
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Size</label>
                                                        <select
                                                            value={item.size}
                                                            onChange={e => {
                                                                const newItems = [...editItems];
                                                                newItems[idx].size = e.target.value;
                                                                setEditItems(newItems);
                                                            }}
                                                            className="glass-input py-1.5 px-3 text-sm min-w-[80px]"
                                                        >
                                                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Quantity</label>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    const newItems = [...editItems];
                                                                    if (newItems[idx].quantity > 1) {
                                                                        newItems[idx].quantity--;
                                                                        setEditItems(newItems);
                                                                    }
                                                                }}
                                                                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-300"
                                                            >
                                                                <Minus size={14} />
                                                            </button>
                                                            <span className="w-8 text-center font-bold text-white">{item.quantity}</span>
                                                            <button
                                                                onClick={() => {
                                                                    const newItems = [...editItems];
                                                                    newItems[idx].quantity++;
                                                                    setEditItems(newItems);
                                                                }}
                                                                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-300"
                                                            >
                                                                <Plus size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Details Edit */}
                            <div className="glass-panel p-6 space-y-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Shipping Details</h3>
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Full Name</label>
                                        <input
                                            type="text"
                                            value={editDetails.customerName}
                                            onChange={e => setEditDetails({ ...editDetails, customerName: e.target.value })}
                                            className="glass-input w-full py-2.5"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Contact Number</label>
                                        <input
                                            type="tel"
                                            value={editDetails.contactNumber}
                                            onChange={e => setEditDetails({ ...editDetails, contactNumber: e.target.value })}
                                            className="glass-input w-full py-2.5"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Street Address</label>
                                        <input
                                            type="text"
                                            value={editDetails.address}
                                            onChange={e => setEditDetails({ ...editDetails, address: e.target.value })}
                                            className="glass-input w-full py-2.5"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">City</label>
                                            <input
                                                type="text"
                                                value={editDetails.city}
                                                className="glass-input w-full py-2.5 opacity-50 cursor-not-allowed"
                                                disabled
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Barangay</label>
                                            <input
                                                type="text"
                                                value={editDetails.barangay}
                                                className="glass-input w-full py-2.5 opacity-50 cursor-not-allowed"
                                                disabled
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic mt-2">* City/Barangay cannot be changed once order is calculation for shipping is done.</p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                <div className="text-center py-8">
                    <p className="text-slate-500 text-xs italic">
                        Questions about your order? Message us on
                        <a href="https://facebook.com/sportstech.fb" target="_blank" className="text-primary hover:underline ml-1">Facebook</a> or
                        <a href="https://instagram.com/sportstech.ig" target="_blank" className="text-primary hover:underline ml-1">Instagram</a>.
                    </p>
                </div>
            </main>
        </div>
    );
}
