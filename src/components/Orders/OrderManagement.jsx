import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, User, Search, Edit2, Save, X, Trash2, Layers, ChevronDown, ChevronUp, ShoppingBag, Loader2, AlertCircle, Banknote, Filter, Copy, MessageSquare, Send, RotateCcw } from 'lucide-react';
import { useToast } from '../ui/Toast';
import Dialog from '../ui/Dialog';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import { api, apiRequest } from '../../lib/apiClient';
import { useProducts } from '../../hooks/useInventory';
import { withLocalDate } from '../../lib/transactionDate';
import { groupOrders } from '../../lib/orderItems';
import { buildOrderChanges, buildOrderDetailChanges, priceOrderChanges, saveOrderChanges } from '../../lib/orderEditing';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const FULFILLMENT_STATUSES = ['pending', 'in_progress', 'ready', 'shipped', 'returned', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid'];
const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];

export default function OrderManagement({ transactions, onAddTransaction, onDeleteTransaction, onOrderSaved, refetch, userRole }) {
    const { showToast } = useToast();
    const products = useProducts(transactions);
    const isReseller = userRole === 'reseller';
    const readOnly = useReadOnly();
    const deletionRequests = React.useRef(new Map());
    const persistOrder = async changes => {
        const ready = details => ['ready', 'shipped'].includes(details?.fulfillmentStatus ?? details?.status);
        const needsPackingConfirmation = import.meta.env.VITE_PRINT_QUEUE_ENABLED === 'true'
            && changes.some(change => !ready(change.original.details) && ready(change.updates.details));
        if (needsPackingConfirmation && !window.confirm('Confirm that all shirts passed quality checks and packing, accessories and labels are complete.')) {
            throw new Error('Packing was not confirmed. No changes were saved.');
        }
        const result = await saveOrderChanges(changes, { requirePending: isReseller, ...(needsPackingConfirmation ? { packingConfirmed: true } : {}) });
        onOrderSaved?.(changes, result);
        return result;
    };
    const [filterFulfillment, setFilterFulfillment] = useState('all');
    const [filterPayment, setFilterPayment] = useState('all'); // 'all', 'paid', 'unpaid'
    const [searchTerm, setSearchTerm] = useState('');

    // Group Expansion State
    const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());

    // Edit State
    const [editingId, setEditingId] = useState(null);
    const [editingOrder, setEditingOrder] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [loading, setLoading] = useState(false);

    // Bulk Actions
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [showBulkEditModal, setShowBulkEditModal] = useState(false);

    const groupedOrders = useMemo(() => groupOrders(transactions), [transactions]);
    const editPricing = useMemo(() => {
        if (!editingId || !editingOrder || !editForm.items) return null;
        try {
            return priceOrderChanges(editingOrder, editForm.items);
        } catch (error) {
            return { error: error.message };
        }
    }, [editingId, editingOrder, editForm.items]);

    // 2. Filter Groups
    const filteredOrders = useMemo(() => {
        return groupedOrders.map(order => order.id === editingId && editingOrder ? editingOrder : order).filter(order => {
            const matchesFulfillment = filterFulfillment === 'all' || order.fulfillmentStatus === filterFulfillment;
            const matchesPayment = filterPayment === 'all' || order.paymentStatus === filterPayment;
            const matchesSearch =
                order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.id.toLowerCase().includes(searchTerm.toLowerCase());

            return matchesFulfillment && matchesPayment && matchesSearch;
        });
    }, [groupedOrders, filterFulfillment, filterPayment, searchTerm, editingId, editingOrder]);


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
        if (isReseller && order.fulfillmentStatus !== 'pending') {
            showToast('Only pending orders can be edited. Contact the owner for later changes.', 'info');
            return;
        }
        setEditingId(order.id);
        setEditingOrder(order);
        
        // Ensure order is expanded so user sees the shipping details edit form
        const newSet = new Set(expandedOrderIds);
        newSet.add(order.id);
        setExpandedOrderIds(newSet);

        const firstItemDetails = order.items[0]?.details || {};
        const shipping = firstItemDetails.shippingDetails || {};

        setEditForm({
            customerName: order.customerName,
            fulfillmentStatus: order.fulfillmentStatus,
            paymentStatus: order.paymentStatus,
            paymentMode: order.paymentMode,
            trackingNumber: order.items[0]?.details?.trackingNumber || '',
            date: new Date(order.date).toISOString().split('T')[0],
            contactNumber: shipping.contactNumber || firstItemDetails.customerContact || firstItemDetails.contactNumber || '',
            address: shipping.address || firstItemDetails.customerAddress || '',
            city: shipping.city || firstItemDetails.customerCity || '',
            province: shipping.province || firstItemDetails.customerProvince || '',
            barangay: shipping.barangay || firstItemDetails.customerBarangay || '',
            items: order.items.map(item => ({
                id: item.id,
                amount: item.amount,
                details: { ...item.details }
            }))
        });
    };

    const handleSave = async (orderId) => {
        setLoading(true);
        try {
            const order = editingOrder?.id === orderId ? editingOrder : null;
            if (!order) throw new Error("Order not found");

            const isoDate = editForm.date === new Date(order.date).toISOString().split('T')[0]
                ? order.date
                : withLocalDate(editForm.date, new Date(order.date)).toISOString();

            const isNewTracking = !isReseller && editForm.trackingNumber && editForm.trackingNumber !== (order.items[0]?.details?.trackingNumber || '');
            const finalFulfillmentStatus = isReseller ? order.fulfillmentStatus : isNewTracking ? 'shipped' : editForm.fulfillmentStatus;

            const result = buildOrderChanges(order, editForm.items, {
                customerName: editForm.customerName,
                contactNumber: editForm.contactNumber,
                fulfillmentStatus: finalFulfillmentStatus,
                paymentStatus: isReseller ? order.paymentStatus : editForm.paymentStatus,
                paymentMode: editForm.paymentMode,
                trackingNumber: isReseller ? (order.items[0]?.details?.trackingNumber || '') : editForm.trackingNumber,
                status: finalFulfillmentStatus,
                shippingDetails: {
                    contactNumber: editForm.contactNumber,
                    address: editForm.address,
                    city: editForm.city,
                    province: editForm.province,
                    barangay: editForm.barangay
                }
            }, { date: isoDate });
            result.changes.forEach(({ original, updates }) => {
                const updatedDetails = updates.details;
                if (finalFulfillmentStatus === 'returned') {
                    updatedDetails.returnedAt = original.details?.returnedAt || new Date().toISOString();
                    updatedDetails.previousFulfillmentStatus = original.details?.previousFulfillmentStatus ||
                        original.details?.fulfillmentStatus || original.details?.status || order.fulfillmentStatus;
                } else if (original.details?.fulfillmentStatus === 'returned') {
                    delete updatedDetails.returnedAt;
                    delete updatedDetails.previousFulfillmentStatus;
                }
            });
            await persistOrder(result.changes);
            showToast('Order updated!', 'success');

            // Trigger SMS if tracking number was added/updated
            if (isNewTracking) {
                await handleSendTrackingSms(order, editForm.trackingNumber);
            }

            setEditingId(null);
            if (refetch) await refetch();

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Failed to update order', 'error');
            if (refetch) await refetch();
        } finally {
            setLoading(false);
        }
    };

    const handleQuickTracking = async (orderId, trackingNumber) => {
        if (isReseller) return;
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) throw new Error('Order not found. Reload before retrying.');

            const changes = buildOrderDetailChanges(order, details => ({
                ...details,
                trackingNumber,
                fulfillmentStatus: trackingNumber ? 'shipped' : details.fulfillmentStatus,
                status: trackingNumber ? 'shipped' : details.status
            }));
            await persistOrder(changes);

            showToast('Tracking updated', 'success');

            // Trigger SMS
            if (trackingNumber) {
                await handleSendTrackingSms(order, trackingNumber);
            }

            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Update failed: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteOrder = async (orderId) => {
        if (isReseller) return;
        if (!confirm('Delete this entire order?')) return;
        setLoading(true);
        try {
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) throw new Error('Order not found. Reload before retrying.');
            const expectedVersion = order.transactions[0]?.orderVersion;
            if (!Number.isSafeInteger(expectedVersion)) throw new Error('The order version is missing. Reload before deleting.');
            const key = `${orderId}:${expectedVersion}`;
            const requestId = deletionRequests.current.get(key) || crypto.randomUUID();
            deletionRequests.current.set(key, requestId);
            const result = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
                method: 'DELETE', body: { expectedVersion, requestId, sourceIds: order.transactions.map(row => row.id) }
            });
            if (result.orderId !== orderId || !Array.isArray(result.ids)
                || order.transactions.some(row => !result.ids.includes(row.id))) {
                throw new Error('Order deletion could not be confirmed. Reload before retrying.');
            }
            deletionRequests.current.delete(key);
            showToast('Order deleted', 'success');
            if (refetch) await refetch();
        } catch (err) {
            showToast('Delete failed: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    const handleMarkReturned = async (orderId) => {
        const order = groupedOrders.find(o => o.id === orderId);
        if (!order || order.fulfillmentStatus === 'returned') return;

        if (!confirm(`Mark ${order.customerName}'s order as returned?\n\nThis only tags the order. Payment and inventory will stay unchanged.`)) return;

        setLoading(true);
        try {
            const returnedAt = new Date().toISOString();
            const changes = buildOrderDetailChanges(order, details => ({
                ...details,
                previousFulfillmentStatus: details?.fulfillmentStatus || details?.status || order.fulfillmentStatus,
                fulfillmentStatus: 'returned',
                status: 'returned',
                returnedAt
            }));
            await persistOrder(changes);
            showToast('Order marked as returned', 'success');
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Failed to mark order as returned: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBulkUpdate = async (updates) => {
        if (isReseller) return;
        if (!confirm(`Update ${selectedOrderIds.size} orders?`)) return;
        setLoading(true);
        try {
            for (const orderId of selectedOrderIds) {
                const order = groupedOrders.find(o => o.id === orderId);
                if (!order) throw new Error('Order not found. Reload before retrying.');

                const changes = buildOrderDetailChanges(order, details => {
                    const newDetails = { ...details, ...updates };
                    // Sync legacy field
                    if (updates.fulfillmentStatus) {
                        newDetails.status = updates.fulfillmentStatus;

                        if (updates.fulfillmentStatus === 'returned') {
                            newDetails.returnedAt = details?.returnedAt || new Date().toISOString();
                            newDetails.previousFulfillmentStatus = details?.previousFulfillmentStatus ||
                                details?.fulfillmentStatus || details?.status || order.fulfillmentStatus;
                        } else if (details?.fulfillmentStatus === 'returned') {
                            delete newDetails.returnedAt;
                            delete newDetails.previousFulfillmentStatus;
                        }
                    }

                    return newDetails;
                });
                await persistOrder(changes);
            }
            showToast('Bulk update complete', 'success');
            setIsSelectionMode(false);
            setSelectedOrderIds(new Set());
            setShowBulkEditModal(false);
            if (refetch) await refetch();
        } catch (err) {
            console.error(err);
            showToast('Bulk update stopped. Earlier orders may be saved; reload before retrying.', 'error');
            if (refetch) await refetch();
        } finally {
            setLoading(false);
        }
    };
    
    const handleSaveComment = async (orderId, commentText) => {
        if (!commentText.trim()) return;
        setLoading(true);
        try {
            const user = await api.getCurrentUser();
            const order = groupedOrders.find(o => o.id === orderId);
            if (!order) throw new Error('Order not found. Reload before retrying.');

            const newComment = {
                id: crypto.randomUUID(),
                text: commentText.trim(),
                author: user?.email || 'Unknown',
                date: new Date().toISOString()
            };

            const changes = buildOrderDetailChanges(order, details => ({
                ...details,
                comments: [...(details?.comments || []), newComment]
            }));
            await persistOrder(changes);
            showToast('Comment added', 'success');
            if (refetch) await refetch();
            return true;
        } catch (err) {
            console.error(err);
            showToast('Failed to add comment: ' + err.message, 'error');
            return false;
        } finally {
            setLoading(false);
        }
    };

    const handleCopyToClipboard = (text, type) => {
        navigator.clipboard.writeText(text);
        showToast(`${type} copied!`, 'success');
    };

    const formatContactForSMS = (number) => {
        if (!number) return '';
        // Remove spaces, dashes, etc.
        const clean = number.toString().replace(/[\s\-\(\)]/g, '');
        // Ensure it starts with + if it's a valid PH number
        if (clean.startsWith('9')) return `+63${clean}`;
        if (clean.startsWith('09')) return `+63${clean.slice(1)}`;
        if (clean.startsWith('639')) return `+${clean}`;
        if (clean.startsWith('+639')) return clean;
        return clean;
    };

    const formatContactForCopy = (number) => {
        if (!number) return '';
        // Remove all non-numeric characters
        let clean = number.toString().replace(/\D/g, '');

        // Strip prefixes: +63, 63, or 0
        if (clean.startsWith('639')) clean = clean.slice(2);
        else if (clean.startsWith('09')) clean = clean.slice(1);

        return clean;
    };

    const handleSendTrackingSms = async (order, trackingNumber) => {
        try {
            if (userRole !== 'owner') return;
            const settings = await apiRequest('/api/settings/sms');
            if (!settings.enableTrackingSms) {
                showToast("SMS Disabled in Profile Settings", "info");
                return;
            }
            if (!settings.configured) {
                showToast("Order saved. Configure the SMS gateway in Settings to send notifications.", "error");
                return;
            }
            if (!trackingNumber) return;

            // Get customer contact - check all possible fields
            const contactRaw = order.items[0]?.details?.shippingDetails?.contactNumber ||
                order.items[0]?.details?.customerContact ||
                order.items[0]?.details?.contactNumber ||
                ''; // Fallback to empty string

            const recipient = formatContactForSMS(contactRaw);
            if (!recipient || !recipient.startsWith('+')) {
                showToast(`SMS Skipped: Customer missing valid phone #`, 'error');
                return;
            }

            // Intelligently format the tracking link
            let trackingLink = trackingNumber;
            if (!trackingNumber.startsWith('http') && trackingNumber.length < 25) {
                // If it looks like an ordinary tracking ID, fallback to LBC or courier
                trackingLink = `https://www.lbcexpress.com/track/?tracking_no=${trackingNumber}`;
            }

            // Parse template
            let message = settings.trackingSmsTemplate || 'Hi {customerName}, your order {orderId} has been shipped! Track here: {trackingLink}';
            message = message
                .replace(/{customerName}/g, order.customerName || 'Customer')
                .replace(/{trackingNumber}/g, trackingNumber)
                .replace(/{trackingLink}/g, trackingLink)
                .replace(/{orderId}/g, String(order.id).slice(0, 8)); // Use first 8 chars for cleaner ID

            await api.sendSms({
                recipient,
                message,
                orderId: order.id,
                trackingNumber
            });
            showToast('Tracking SMS sent!', 'success');
        } catch (error) {
            console.error('Failed to send tracking SMS:', error);
            showToast(`SMS Failed: ${error.message}`, 'error');
        }
    };



    return (
        <div className="flex h-full flex-col gap-4 lg:gap-5">
            <h2 className="sr-only">Order Management</h2>

            <section className="surface p-4 sm:p-5" aria-label="Order filters">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="relative min-w-0 flex-1 xl:max-w-md">
                        <label htmlFor="order-search" className="sr-only">Search customer or ID...</label>
                        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" size={20} aria-hidden="true" />
                        <input
                            id="order-search"
                            type="text"
                            placeholder="Search customer or ID..."
                            className="field pl-12"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
                        <div className="flex flex-wrap items-center gap-2">
                            {isSelectionMode ? (
                                <>
                                    {!isReseller && <button
                                        type="button"
                                        disabled={readOnly}
                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                        onClick={() => setShowBulkEditModal(true)}
                                        className="btn-primary whitespace-nowrap"
                                    >
                                        <Edit2 size={18} aria-hidden="true" /> Bulk edit
                                    </button>}
                                    <button
                                        type="button"
                                        aria-label="Delete selected orders"
                                        disabled={readOnly}
                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                        onClick={async () => {
                                            if (confirm(`Delete ${selectedOrderIds.size} orders?`)) {
                                                setLoading(true);
                                                try {
                                                    for (const orderId of selectedOrderIds) {
                                                        const order = groupedOrders.find(o => o.id === orderId);
                                                        if (order) {
                                                            for (const item of order.transactions) await onDeleteTransaction(item.id);
                                                        }
                                                    }
                                                    setIsSelectionMode(false);
                                                    setSelectedOrderIds(new Set());
                                                    if (refetch) await refetch();
                                                    showToast('Deleted', 'success');
                                                } catch (error) {
                                                    console.error('Order deletion failed:', error);
                                                    showToast('Some orders could not be deleted. Refresh before retrying.', 'error');
                                                } finally { setLoading(false); }
                                            }
                                        }}
                                        className="icon-btn text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                    >
                                        <Trash2 size={20} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Cancel selection"
                                        onClick={() => { setIsSelectionMode(false); setSelectedOrderIds(new Set()); }}
                                        className="icon-btn"
                                    >
                                        <X size={20} aria-hidden="true" />
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    disabled={readOnly}
                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                    onClick={() => setIsSelectionMode(true)}
                                    className="btn-secondary whitespace-nowrap"
                                >
                                    <Layers size={18} aria-hidden="true" /> Multi-select
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                        <p className="mb-2 text-sm font-medium text-ink-2">Fulfillment</p>
                        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Fulfillment filter">
                            {['all', ...FULFILLMENT_STATUSES].map(status => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setFilterFulfillment(status)}
                                    aria-pressed={filterFulfillment === status}
                                    className="chip capitalize"
                                >
                                    {status.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className="mb-2 text-sm font-medium text-ink-2">Payment</p>
                        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Payment filter">
                            {['all', 'paid', 'unpaid'].map(status => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setFilterPayment(status)}
                                    aria-pressed={filterPayment === status}
                                    className="chip capitalize"
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-3 pb-2">
                    {filteredOrders.map(order => {
                        const isExpanded = expandedOrderIds.has(order.id);
                        const isEditing = editingId === order.id;
                        const totalQuantity = order.items.reduce((sum, item) => sum + (Number(item.details?.quantity) || 1), 0);
                        const itemSummary = order.items.map(item => item.details?.itemName).filter(Boolean).join(', ') || `${totalQuantity} Items`;
                        const fulfillmentBadgeClass = order.fulfillmentStatus === 'shipped' || order.fulfillmentStatus === 'ready'
                            ? 'border-emerald-500/40 text-emerald-300'
                            : order.fulfillmentStatus === 'in_progress'
                                ? 'border-sky-500/40 text-sky-300'
                                : order.fulfillmentStatus === 'returned'
                                    ? 'border-amber-500/40 text-amber-300'
                                    : order.fulfillmentStatus === 'cancelled'
                                        ? 'border-red-500/40 text-red-300'
                                        : 'border-amber-500/40 text-amber-300';
                        const FulfillmentIcon = order.fulfillmentStatus === 'shipped' ? Truck
                            : order.fulfillmentStatus === 'ready' ? Package
                                : order.fulfillmentStatus === 'in_progress' ? Loader2
                                    : order.fulfillmentStatus === 'returned' ? RotateCcw
                                        : order.fulfillmentStatus === 'cancelled' ? X
                                            : Clock;
                        const dateInputId = `order-date-${order.id}`;
                        const trackingInputId = `tracking-${order.id}`;
                        const fulfillmentSelectId = `fulfillment-${order.id}`;
                        const paymentStatusSelectId = `payment-status-${order.id}`;
                        const paymentModeSelectId = `payment-mode-${order.id}`;
                        const addressInputId = `address-${order.id}`;
                        const contactInputId = `contact-${order.id}`;
                        const barangayInputId = `barangay-${order.id}`;
                        const cityInputId = `city-${order.id}`;
                        const provinceInputId = `province-${order.id}`;

                        return (
                            <div
                                key={order.id}
                                className={`surface overflow-hidden transition-colors ${isSelectionMode && selectedOrderIds.has(order.id) ? 'ring-2 ring-primary' : ''}`}
                            >
                                <div
                                    className="cursor-pointer p-4 transition-colors hover:bg-white/[0.04] sm:p-5"
                                    onClick={() => {
                                        if (isSelectionMode) toggleSelection(order.id);
                                        else toggleExpansion(order.id);
                                    }}
                                >
                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)] lg:items-start">
                                        <div className="min-w-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-start gap-3">
                                                    {isSelectionMode && (
                                                        <div className={`mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors ${selectedOrderIds.has(order.id)
                                                            ? 'border-primary bg-primary-strong text-white'
                                                            : 'border-line bg-raised text-transparent'
                                                            }`} aria-hidden="true">
                                                            {selectedOrderIds.has(order.id) && <CheckCircle size={14} />}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        {isEditing ? (
                                                            <input
                                                                aria-label="Customer name"
                                                                disabled={readOnly}
                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                className="field max-w-xs py-2 text-lg font-semibold"
                                                                value={editForm.customerName}
                                                                onChange={e => setEditForm({ ...editForm, customerName: e.target.value })}
                                                                onClick={e => e.stopPropagation()}
                                                            />
                                                        ) : (
                                                            <h3 className="truncate text-lg font-semibold text-ink">{order.customerName}</h3>
                                                        )}
                                                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                                                            <span className="font-mono text-xs text-ink-3">#{order.id.slice(-6)}</span>
                                                            <span aria-hidden="true">•</span>
                                                            <span>{new Date(order.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span aria-hidden="true">•</span>
                                                            <span className="num">{totalQuantity} Items</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right lg:hidden">
                                                    <p className="text-xs text-ink-2">Total</p>
                                                    <p className="num text-xl font-semibold text-ink">₱{order.totalAmount.toLocaleString()}</p>
                                                </div>
                                            </div>

                                            <p className="mt-3 max-w-3xl truncate text-sm text-ink-2">{itemSummary}</p>

                                            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                                                {order.isOnlineOrder && order.fulfillmentStatus === 'pending' && (
                                                    <span className="badge border-sky-500/40 text-sky-300">*New</span>
                                                )}
                                                {order.isRushOrder && (
                                                    <span className="badge border-amber-500/40 text-amber-300">Rush</span>
                                                )}
                                                <span className={`badge ${order.paymentStatus === 'paid'
                                                    ? 'border-emerald-500/40 text-emerald-300'
                                                    : 'border-red-500/40 text-red-300'
                                                    }`}>
                                                    {order.paymentStatus}
                                                </span>
                                                <span className={`badge capitalize ${fulfillmentBadgeClass}`}>
                                                    <FulfillmentIcon size={14} className={order.fulfillmentStatus === 'in_progress' ? 'animate-spin' : ''} aria-hidden="true" />
                                                    {order.fulfillmentStatus.replace('_', ' ')}
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-ink-2">
                                                    <Banknote size={14} aria-hidden="true" className="text-ink-3" /> {order.paymentMode}
                                                </span>
                                                {order.items[0]?.details?.createdBy && (
                                                    <span className="inline-flex min-w-0 items-center gap-1 text-ink-2">
                                                        <User size={14} aria-hidden="true" className="text-ink-3" />
                                                        <span className="truncate">{order.items[0].details.createdBy.split('@')[0]}</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex min-w-0 flex-col gap-3 lg:items-end">
                                            <div className="hidden text-right lg:block">
                                                <p className="text-xs text-ink-2">Total</p>
                                                <p className="num text-2xl font-semibold text-ink">₱{order.totalAmount.toLocaleString()}</p>
                                            </div>

                                            {isEditing ? (
                                                <div className="w-full rounded-xl border border-line bg-raised p-3 lg:w-[360px]" onClick={e => e.stopPropagation()}>
                                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                        <div className="sm:col-span-2">
                                                            <label htmlFor={dateInputId} className="field-label">Order date</label>
                                                            <input
                                                                id={dateInputId}
                                                                type="date"
                                                                disabled={readOnly}
                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                value={editForm.date || ''}
                                                                onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                                                                className="field py-2 text-sm"
                                                            />
                                                        </div>

                                                        <div className="sm:col-span-2">
                                                            <label htmlFor={trackingInputId} className="field-label">Tracking number</label>
                                                            <div className="relative">
                                                                <Truck className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                                                                <input
                                                                    id={trackingInputId}
                                                                    placeholder="Tracking number"
                                                                    disabled={readOnly || isReseller}
                                                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                                                    value={editForm.trackingNumber || ''}
                                                                    onChange={e => {
                                                                        const val = e.target.value;
                                                                        setEditForm(prev => ({
                                                                            ...prev,
                                                                            trackingNumber: val,
                                                                            fulfillmentStatus: val ? 'shipped' : prev.fulfillmentStatus
                                                                        }));
                                                                    }}
                                                                    className="field pl-9 py-2 text-sm"
                                                                />
                                                            </div>
                                                        </div>

                                                        {!isReseller && (
                                                            <div>
                                                                <label htmlFor={fulfillmentSelectId} className="field-label">Fulfillment status</label>
                                                                <select
                                                                    id={fulfillmentSelectId}
                                                                    disabled={readOnly}
                                                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                                                    value={editForm.fulfillmentStatus}
                                                                    onChange={e => setEditForm({ ...editForm, fulfillmentStatus: e.target.value })}
                                                                    className="field py-2 text-sm capitalize"
                                                                >
                                                                    {FULFILLMENT_STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s.replace('_', ' ')}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <label htmlFor={paymentStatusSelectId} className="field-label">Payment status</label>
                                                            <select
                                                                id={paymentStatusSelectId}
                                                                value={editForm.paymentStatus}
                                                                disabled={readOnly || isReseller}
                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                onChange={e => setEditForm({ ...editForm, paymentStatus: e.target.value })}
                                                                className="field py-2 text-sm capitalize"
                                                            >
                                                                {PAYMENT_STATUSES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="sm:col-span-2">
                                                            <label htmlFor={paymentModeSelectId} className="field-label">Payment mode</label>
                                                            <select
                                                                id={paymentModeSelectId}
                                                                disabled={readOnly}
                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                value={editForm.paymentMode}
                                                                onChange={e => setEditForm({ ...editForm, paymentMode: e.target.value })}
                                                                className="field py-2 text-sm"
                                                            >
                                                                {PAYMENT_MODES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex gap-2">
                                                        <button type="button" aria-label="Save order changes" disabled={readOnly || loading || !!editPricing?.error} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => handleSave(order.id)} className="btn-success flex-1 px-3">
                                                            <Save size={16} aria-hidden="true" /> Save
                                                        </button>
                                                        <button type="button" aria-label="Cancel order changes" disabled={loading} onClick={() => setEditingId(null)} className="btn-danger flex-1 px-3">
                                                            <X size={16} aria-hidden="true" /> Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end" onClick={e => e.stopPropagation()}>
                                                    <div className="relative w-full sm:w-52">
                                                        <Truck size={16} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${order.items[0]?.details?.trackingNumber ? 'text-primary' : 'text-ink-3'}`} aria-hidden="true" />
                                                        <input
                                                            aria-label={`Tracking number for ${order.customerName}`}
                                                            defaultValue={order.items[0]?.details?.trackingNumber || ''}
                                                            readOnly={isReseller}
                                                            disabled={readOnly}
                                                            title={readOnly ? READ_ONLY_HINT : undefined}
                                                            placeholder="Add tracking"
                                                            className={`field pl-9 pr-3 py-2 text-sm ${order.items[0]?.details?.trackingNumber
                                                                ? 'border-primary/40 bg-primary/10 text-primary font-mono font-semibold'
                                                                : ''
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

                                                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                                        {!isSelectionMode && (
                                                            <>
                                                                {!isReseller && order.fulfillmentStatus !== 'returned' && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleMarkReturned(order.id); }}
                                                                        disabled={readOnly}
                                                                        className="icon-btn text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                                                                        title={readOnly ? READ_ONLY_HINT : "Mark as returned"}
                                                                        aria-label="Mark order as returned"
                                                                    >
                                                                        <RotateCcw size={18} aria-hidden="true" />
                                                                    </button>
                                                                )}
                                                                <button type="button" aria-label={`Edit order for ${order.customerName}`} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={(e) => { e.stopPropagation(); startEditing(order); }} className="icon-btn"><Edit2 size={18} aria-hidden="true" /></button>
                                                                <button type="button" aria-label={`Delete order for ${order.customerName}`} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order.id); }} className="icon-btn text-red-400 hover:bg-red-500/10 hover:text-red-300"><Trash2 size={18} aria-hidden="true" /></button>
                                                            </>
                                                        )}
                                                        <button
                                                            type="button"
                                                            aria-label={isExpanded ? `Collapse order for ${order.customerName}` : `Expand order for ${order.customerName}`}
                                                            onClick={(e) => { e.stopPropagation(); toggleExpansion(order.id); }}
                                                            className="icon-btn"
                                                        >
                                                            {isExpanded ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0 }}
                                            animate={{ height: 'auto' }}
                                            exit={{ height: 0 }}
                                            className="overflow-hidden border-t border-line bg-surface"
                                        >
                                            <div className="p-4 sm:p-5">
                                                {isEditing && editPricing && (
                                                    <div role={editPricing.error ? 'alert' : 'status'} className="mb-4 rounded-xl border border-line bg-raised p-3 text-sm text-ink-2">
                                                        {editPricing.error || `Updated total: PHP ${editPricing.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                                        {editPricing.options?.legacyDiscount && <p className="mt-1 text-ink-2">This older order keeps its original peso discount when quantities change.</p>}
                                                    </div>
                                                )}

                                                <div className="divide-y divide-line">
                                                    {order.items.map((item, idx) => (
                                                        <div key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
                                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                                                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-well text-ink-3">
                                                                    {item.details.imageUrl ? (
                                                                        <img
                                                                            src={item.details.imageUrl}
                                                                            className="size-full object-cover"
                                                                            alt={item.details.itemName}
                                                                        />
                                                                    ) : (
                                                                        <ShoppingBag size={20} aria-hidden="true" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0 flex-1 space-y-1">
                                                                    {isEditing ? (
                                                                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3" onClick={e => e.stopPropagation()}>
                                                                            <select
                                                                                aria-label={`Product for line ${idx + 1}`}
                                                                                disabled={readOnly}
                                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                                className="field py-2 text-sm"
                                                                                value={editForm.items[idx]?.details?.itemName || ''}
                                                                                onChange={e => {
                                                                                    const selectedProductName = e.target.value;
                                                                                    const product = products.find(p => p.name === selectedProductName);
                                                                                    const newItems = [...editForm.items];

                                                                                    newItems[idx].details.itemName = selectedProductName;
                                                                                    if (product) {
                                                                                        newItems[idx].productChanged = true;
                                                                                        newItems[idx].priceAdjustment = 0;
                                                                                        newItems[idx].details.unitPrice = product.price;
                                                                                        newItems[idx].details.category = product.category || 'shirts';
                                                                                        newItems[idx].details.imageUrl = product.imageUrl;
                                                                                        newItems[idx].details.color = product.linkedColor || 'Varied';
                                                                                        newItems[idx].details.brand = product.brand || 'Sypik';
                                                                                    }

                                                                                    setEditForm({ ...editForm, items: newItems });
                                                                                }}
                                                                            >
                                                                                <option value="" disabled>Select product</option>
                                                                                {products.map(p => (
                                                                                    <option key={p.id} value={p.name} className="bg-slate-900">{p.name} - ₱{p.price}</option>
                                                                                ))}
                                                                            </select>

                                                                            <select
                                                                                aria-label={`Size for ${item.details.itemName}`}
                                                                                disabled={readOnly}
                                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                                className="field py-2 text-sm"
                                                                                value={editForm.items[idx]?.details?.size || ''}
                                                                                onChange={e => {
                                                                                    const newItems = [...editForm.items];
                                                                                    newItems[idx].details.size = e.target.value;
                                                                                    setEditForm({ ...editForm, items: newItems });
                                                                                }}
                                                                            >
                                                                                <option value="" disabled>Size</option>
                                                                                {SIZES.map(s => (
                                                                                    <option key={s} value={s} className="bg-slate-900">{s}</option>
                                                                                ))}
                                                                            </select>

                                                                            <input
                                                                                aria-label={`Color for ${item.details.itemName}`}
                                                                                disabled={readOnly}
                                                                                title={readOnly ? READ_ONLY_HINT : undefined}
                                                                                className="field py-2 text-sm"
                                                                                value={editForm.items[idx]?.details?.color || ''}
                                                                                onChange={e => {
                                                                                    const newItems = [...editForm.items];
                                                                                    newItems[idx].details.color = e.target.value;
                                                                                    setEditForm({ ...editForm, items: newItems });
                                                                                }}
                                                                                placeholder="Color"
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <p className="truncate font-semibold text-ink">{item.details?.itemName}</p>
                                                                            <p className="text-xs font-medium text-ink-2">
                                                                                {item.details?.brand && `${item.details.brand} • `}
                                                                                {item.details?.size !== 'N/A' && `${item.details?.size} • `}
                                                                                {item.details?.color}
                                                                            </p>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 items-center justify-between gap-6 md:justify-end">
                                                                <div className="text-right">
                                                                    {isEditing ? (
                                                                        <div className="flex flex-col gap-2 items-end" onClick={e => e.stopPropagation()}>
                                                                            <label className="flex items-center gap-2 text-xs font-medium text-ink-2">
                                                                                Line total
                                                                                <input
                                                                                    type="number"
                                                                                    disabled={readOnly}
                                                                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                                                                    className="field w-24 py-2 text-right text-sm num"
                                                                                    aria-label={`Line total for ${item.details.itemName}`}
                                                                                    step="0.01"
                                                                                    min="0"
                                                                                    value={editPricing?.items?.find(priced => priced.id === item.id)?.amount ?? editForm.items[idx]?.amount ?? 0}
                                                                                    onChange={e => {
                                                                                        const priced = editPricing?.items?.find(priced => priced.id === item.id);
                                                                                        if (!priced) return showToast('Enter a valid quantity before changing the line total.', 'error');
                                                                                        const newItems = [...editForm.items];
                                                                                        newItems[idx].amount = Number(e.target.value);
                                                                                        newItems[idx].priceAdjustment = Number(((priced.priceAdjustment || 0) + Number(e.target.value) - priced.amount).toFixed(2));
                                                                                        setEditForm({ ...editForm, items: newItems });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                            <label className="flex items-center gap-2 text-xs font-medium text-ink-2">
                                                                                Qty
                                                                                <input
                                                                                    type="number"
                                                                                    disabled={readOnly}
                                                                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                                                                    min="1"
                                                                                    step="1"
                                                                                    aria-label={`Quantity for ${item.details.itemName}`}
                                                                                    className="field w-20 py-2 text-right text-sm num"
                                                                                    value={editForm.items[idx]?.details?.quantity || 0}
                                                                                    onChange={e => {
                                                                                        const newItems = [...editForm.items];
                                                                                        newItems[idx].details.quantity = Number(e.target.value);
                                                                                        setEditForm({ ...editForm, items: newItems });
                                                                                    }}
                                                                                />
                                                                            </label>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <p className="num text-base font-semibold text-ink">₱{(item.details?.originalAmount ?? item.amount).toLocaleString()}</p>
                                                                            <p className="text-xs font-medium text-ink-2">Qty: {item.details?.quantity}</p>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="mt-4 border-t border-line pt-4">
                                                    <div className="space-y-2 text-sm">
                                                        <div className="flex justify-between gap-4 text-ink-2">
                                                            <span>Items subtotal</span>
                                                            <span className="num">₱{(order.items.reduce((acc, item) => acc + (item.details?.originalAmount || 0), 0)).toLocaleString()}</span>
                                                        </div>
                                                        {(order.items.reduce((acc, item) => acc + (item.details?.discountShare || 0), 0)) > 0 && (
                                                            <div className="flex justify-between gap-4 text-emerald-300">
                                                                <span>Voucher/Discount</span>
                                                                <span className="num">-₱{(order.items.reduce((acc, item) => acc + (item.details?.discountShare || 0), 0)).toLocaleString()}</span>
                                                            </div>
                                                        )}
                                                        {order.isRushOrder && (
                                                            <div className="flex justify-between gap-4 text-amber-300">
                                                                <span>Rush processing fee (synced)</span>
                                                                <span className="num">₱{(order.totalRushFee || 0).toLocaleString()}</span>
                                                            </div>
                                                        )}
                                                        <div className="flex justify-between gap-4 text-ink-2">
                                                            <span>{order.shippingFee > 0 ? 'Shipping fee' : 'No shipping charge'}</span>
                                                            <span className="num">₱{(order.shippingFee || 0).toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-semibold text-ink">
                                                            <span>Grand total</span>
                                                            <span className="num">₱{order.totalAmount.toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {(order.items[0]?.details?.shippingDetails || order.items[0]?.details?.customerProvince || isEditing) && (
                                                    <div className="mt-4 border-t border-line pt-4" onClick={e => e.stopPropagation()}>
                                                        <p className="section-title mb-3 flex items-center gap-2"><Truck size={16} aria-hidden="true" /> Shipping information</p>
                                                        {isEditing ? (
                                                            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                                                                <div>
                                                                    <label htmlFor={addressInputId} className="field-label">Address</label>
                                                                    <input
                                                                        id={addressInputId}
                                                                        type="text"
                                                                        disabled={readOnly}
                                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                                        className="field py-2 text-sm"
                                                                        value={editForm.address || ''}
                                                                        onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                                                                        placeholder="Street address / House No."
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label htmlFor={contactInputId} className="field-label">Contact number</label>
                                                                    <input
                                                                        id={contactInputId}
                                                                        type="text"
                                                                        disabled={readOnly}
                                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                                        className="field py-2 text-sm"
                                                                        value={editForm.contactNumber || ''}
                                                                        onChange={e => setEditForm({ ...editForm, contactNumber: e.target.value })}
                                                                        placeholder="e.g. 09123456789"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label htmlFor={barangayInputId} className="field-label">Barangay</label>
                                                                    <input
                                                                        id={barangayInputId}
                                                                        type="text"
                                                                        disabled={readOnly}
                                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                                        className="field py-2 text-sm"
                                                                        value={editForm.barangay || ''}
                                                                        onChange={e => setEditForm({ ...editForm, barangay: e.target.value })}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label htmlFor={cityInputId} className="field-label">City/municipality</label>
                                                                    <input
                                                                        id={cityInputId}
                                                                        type="text"
                                                                        disabled={readOnly}
                                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                                        className="field py-2 text-sm"
                                                                        value={editForm.city || ''}
                                                                        onChange={e => setEditForm({ ...editForm, city: e.target.value })}
                                                                    />
                                                                </div>
                                                                <div className="md:col-span-2">
                                                                    <label htmlFor={provinceInputId} className="field-label">Province</label>
                                                                    <input
                                                                        id={provinceInputId}
                                                                        type="text"
                                                                        disabled={readOnly}
                                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                                        className="field py-2 text-sm"
                                                                        value={editForm.province || ''}
                                                                        onChange={e => setEditForm({ ...editForm, province: e.target.value })}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                                                                <div>
                                                                    <p className="field-label">Address</p>
                                                                    <button
                                                                        type="button"
                                                                        className="group/address flex min-h-11 w-full items-center gap-2 text-left text-ink transition-colors hover:text-primary"
                                                                        onClick={() => handleCopyToClipboard(order.items[0].details.shippingDetails?.address || order.items[0].details.customerAddress, 'Address')}
                                                                        title="Click to copy address"
                                                                    >
                                                                        <span className="min-w-0 flex-1">{order.items[0].details.shippingDetails?.address || order.items[0].details.customerAddress || 'No address provided'}</span>
                                                                        <Copy size={14} className="shrink-0 opacity-0 transition-opacity group-hover/address:opacity-100" aria-hidden="true" />
                                                                    </button>
                                                                </div>
                                                                <div>
                                                                    <p className="field-label">Contact</p>
                                                                    <button
                                                                        type="button"
                                                                        className="group/contact flex min-h-11 w-full items-center gap-2 text-left text-ink transition-colors hover:text-primary"
                                                                        onClick={() => {
                                                                            const raw = order.items[0].details.shippingDetails?.contactNumber || order.items[0].details.customerContact || order.items[0].details.contactNumber;
                                                                            handleCopyToClipboard(formatContactForCopy(raw), 'Contact number');
                                                                        }}
                                                                        title="Click to copy contact (starts with 9)"
                                                                    >
                                                                        <span className="min-w-0 flex-1">{order.items[0].details.shippingDetails?.contactNumber || order.items[0].details.customerContact || order.items[0].details.contactNumber || 'N/A'}</span>
                                                                        <Copy size={14} className="shrink-0 opacity-0 transition-opacity group-hover/contact:opacity-100" aria-hidden="true" />
                                                                    </button>
                                                                </div>
                                                                <div className="md:col-span-2">
                                                                    <p className="field-label">Details (barangay, city, province)</p>
                                                                    <p className="text-ink">
                                                                        {order.items[0].details.shippingDetails ? (
                                                                            `${order.items[0].details.shippingDetails.barangay ? order.items[0].details.shippingDetails.barangay + ', ' : ''}${order.items[0].details.shippingDetails.city ? order.items[0].details.shippingDetails.city + ', ' : ''}${order.items[0].details.shippingDetails.province || ''}`
                                                                        ) : (
                                                                            `${order.items[0].details.customerBarangay ? order.items[0].details.customerBarangay + ', ' : ''}${order.items[0].details.customerCity ? order.items[0].details.customerCity + ', ' : ''}${order.items[0].details.customerProvince || ''}`
                                                                        )}
                                                                    </p>
                                                                </div>
                                                                {order.items[0].details.trackingNumber && (
                                                                    <div className="md:col-span-2 border-t border-line pt-3">
                                                                        <p className="field-label flex items-center gap-2"><Truck size={14} aria-hidden="true" /> Tracking number</p>
                                                                        <p className="font-mono font-semibold text-primary">{order.items[0].details.trackingNumber}</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {order.items[0]?.details?.proofOfPayment && (
                                                    <div className="mt-4 border-t border-line pt-4">
                                                        <p className="section-title mb-3 flex items-center gap-2 text-emerald-300"><CheckCircle size={16} aria-hidden="true" /> Proof of payment</p>
                                                        <button
                                                            type="button"
                                                            aria-label="View proof of payment"
                                                            className="group/proof block overflow-hidden rounded-lg bg-well"
                                                            onClick={() => window.open(order.items[0].details.proofOfPayment, '_blank')}
                                                        >
                                                            <img
                                                                src={order.items[0].details.proofOfPayment}
                                                                className="h-32 max-w-full object-contain transition-opacity group-hover/proof:opacity-80"
                                                                alt="Proof of payment"
                                                            />
                                                            <span className="sr-only">Click to view</span>
                                                        </button>
                                                    </div>
                                                )}

                                                <div className="mt-4 border-t border-line pt-4" onClick={e => e.stopPropagation()}>
                                                    <p className="section-title mb-3 flex items-center gap-2">
                                                        <MessageSquare size={16} aria-hidden="true" /> Order notes & comments
                                                    </p>

                                                    <div className="mb-4 max-h-48 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                                                        {order.comments && order.comments.length > 0 ? (
                                                            order.comments.map((comment) => (
                                                                <div key={comment.id} className="rounded-lg border border-line bg-raised p-3">
                                                                    <div className="mb-1 flex items-start justify-between gap-3">
                                                                        <span className="text-xs font-semibold text-primary">{comment.author.split('@')[0]}</span>
                                                                        <span className="text-xs text-ink-2">{new Date(comment.date).toLocaleString()}</span>
                                                                    </div>
                                                                    <p className="text-sm leading-relaxed text-ink-2">{comment.text}</p>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <p className="py-2 text-center text-xs text-ink-2">No comments yet. Add a note below.</p>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            aria-label="Write a note..."
                                                            placeholder="Write a note..."
                                                            className="field flex-1 py-2 text-sm"
                                                            disabled={readOnly || loading}
                                                            title={readOnly ? READ_ONLY_HINT : undefined}
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter' && e.target.value.trim() && !loading) {
                                                                    const input = e.currentTarget;
                                                                    if (await handleSaveComment(order.id, input.value)) input.value = '';
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            type="button"
                                                            aria-label="Add note"
                                                            disabled={readOnly || loading}
                                                            title={readOnly ? READ_ONLY_HINT : undefined}
                                                            onClick={async (e) => {
                                                                const input = e.currentTarget.previousSibling;
                                                                if (input.value.trim()) {
                                                                    if (await handleSaveComment(order.id, input.value)) input.value = '';
                                                                }
                                                            }}
                                                            className="icon-btn bg-primary/10 text-primary hover:bg-primary-strong hover:text-white"
                                                        >
                                                            <Send size={16} aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                    {filteredOrders.length === 0 && (
                        <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-ink-2">
                            <Package size={32} className="mx-auto mb-3 text-ink-3" aria-hidden="true" />
                            <p>No orders matched your filters</p>
                        </div>
                    )}
                </div>
            </div>

            {showBulkEditModal && (
                <Dialog
                    onClose={() => setShowBulkEditModal(false)}
                    title={`Bulk update (${selectedOrderIds.size})`}
                    size="sm"
                    footer={(
                        <button type="button" onClick={() => setShowBulkEditModal(false)} className="btn-secondary w-full">Cancel</button>
                    )}
                >
                    <div className="space-y-5">
                        {!isReseller && (
                            <div>
                                <p className="field-label">Fulfillment status</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {FULFILLMENT_STATUSES.map(s => (
                                        <button key={s} type="button" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => handleBulkUpdate({ fulfillmentStatus: s })} className="chip capitalize">
                                            {s.replace('_', ' ')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div>
                            <p className="field-label">Payment status</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {PAYMENT_STATUSES.map(s => (
                                    <button key={s} type="button" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => handleBulkUpdate({ paymentStatus: s })} className="chip capitalize">
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </Dialog>
            )}
        </div>
    );
}
