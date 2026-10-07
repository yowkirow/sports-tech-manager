import React, { useState, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Check, Copy, ImageOff, Loader2, Minus, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { refreshTrackedOrder, saveTrackedOrder, trackOrder, trackingToken } from '../../lib/publicShopApi';
import { useToast } from '../ui/Toast';
import Logo from '../ui/Logo';
import { getEditableOrderItems, priceOrderChanges } from '../../lib/orderEditingPure';

const STATUS_STEPS = [
    { key: 'pending', label: 'Order Placed', description: 'We have received your order.' },
    { key: 'in_progress', label: 'Processing', description: 'We are preparing your items.' },
    { key: 'ready', label: 'Ready', description: 'Your order is ready for pickup or shipping.' },
    { key: 'shipped', label: 'Shipped', description: 'Your order is on its way!' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const STATUS_LABELS = { pending: 'Order placed', in_progress: 'Processing', ready: 'Ready', shipped: 'Shipped', returned: 'Returned' };
const peso = (value) => `₱${(Number(value) || 0).toLocaleString()}`;
const longDate = (value) => new Date(value).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

function Thumb({ src }) {
    return (
        <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-well">
            {src ? <img src={src} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-ink-3"><ImageOff size={22} aria-hidden="true" /></div>}
        </div>
    );
}

function ContactLine() {
    return (
        <p className="py-10 text-center text-sm text-ink-2">
            Questions about your order? Message us on{' '}
            <a href="https://facebook.com/sportstech.fb" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Facebook</a> or{' '}
            <a href="https://instagram.com/sportstech.ig" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Instagram</a>.
        </p>
    );
}

export default function OrderTracking() {
    const { showToast } = useToast();
    const [orderId, setOrderId] = useState('');
    const [contactVerify, setContactVerify] = useState('');
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [token, setToken] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const editRequest = useRef(null);
    const refreshing = useRef(false);
    const saveInFlight = useRef(false);

    // Editing State
    const [isEditing, setIsEditing] = useState(false);
    const [editItems, setEditItems] = useState([]);
    const [editDetails, setEditDetails] = useState(null);
    const [saving, setSaving] = useState(false);
    const [editingOrder, setEditingOrder] = useState(null);
    const [saveError, setSaveError] = useState('');
    const editPricing = useMemo(() => {
        if (!isEditing || !editingOrder) return null;
        try {
            return priceOrderChanges(editingOrder, editItems);
        } catch (error) {
            return { error: error.message };
        }
    }, [isEditing, editingOrder, editItems]);

    // Get order ID from URL on mount
    useEffect(() => {
        const path = window.location.pathname;
        const match = path.match(/\/track\/([^/]+)/);
        if (match && match[1]) {
            setOrderId(match[1]);
        }
    }, []);

    const fetchOrder = async (id, contact, { verifyContact = true, notify = true } = {}) => {
        setLoading(true);
        try {
            const result = verifyContact ? await trackOrder(contact, id) : await refreshTrackedOrder(id, token || trackingToken(id));
            setOrder(result.order);
            setOrderId(result.order.id);
            if (result.token) setToken(result.token);
            setIsVerified(true);
            setRefreshError('');
            if (notify) showToast('Order verified!', 'success');

        } catch (err) {
            console.error(err);
            if ([401, 403].includes(err.status)) setIsVerified(false);
            setRefreshError(err.message || 'The order could not be refreshed.');
            if (notify) showToast(err.message || 'Error fetching order', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Poll only while visible and not editing; the server verifies the capability each time.
    useEffect(() => {
        if (!isVerified || !orderId || isEditing) return;
        let cancelled = false;
        const refresh = async () => {
            if (document.visibilityState !== 'visible' || refreshing.current) return;
            refreshing.current = true;
            try {
                const result = await refreshTrackedOrder(orderId, token || trackingToken(orderId));
                if (!cancelled) { setOrder(result.order); setRefreshError(''); }
            } catch (error) {
                if (!cancelled) {
                    setRefreshError(error.message);
                    if ([401, 403].includes(error.status)) setIsVerified(false);
                }
            } finally { refreshing.current = false; }
        };
        const timer = setInterval(refresh, 30000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            cancelled = true;
            clearInterval(timer);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [isVerified, orderId, isEditing, token]);

    useEffect(() => {
        const id = window.location.pathname.match(/\/track\/([^/]+)/)?.[1];
        const savedToken = id && trackingToken(id);
        if (!savedToken) return;
        let cancelled = false;
        refreshTrackedOrder(id, savedToken).then(result => {
            if (!cancelled) {
                setOrder(result.order);
                setOrderId(id);
                setToken(savedToken);
                setIsVerified(true);
            }
        }).catch(() => { /* Expired capabilities fall back to full contact verification. */ });
        return () => { cancelled = true; };
    }, []);

    const handleVerify = (e) => {
        e.preventDefault();
        if (!contactVerify.trim()) return showToast('Enter your registered contact number.', 'error');
        fetchOrder(orderId, contactVerify);
    };

    const startEditing = () => {
        editRequest.current = null;
        setEditingOrder(order);
        setEditItems(getEditableOrderItems(order));
        setSaveError('');
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
        if (saveInFlight.current) return;
        if (editItems.length === 0) {
            return showToast('Order cannot be empty', 'error');
        }

        saveInFlight.current = true;
        setSaving(true);
        try {
            if (!editDetails.customerName.trim() || String(editDetails.contactNumber).replace(/\D/g, '').length < 7) {
                throw new Error('Enter a customer name and valid contact number.');
            }
            const intent = {
                expectedVersion: editingOrder.orderVersion,
                items: editItems.map(item => ({ id: item.id, size: item.size, color: item.color, quantity: Number(item.quantity) })),
                customerName: editDetails.customerName,
                contactNumber: editDetails.contactNumber,
                shippingDetails: {
                    address: editDetails.address,
                    city: editDetails.city,
                    province: editDetails.province,
                    barangay: editDetails.barangay
                }
            };
            const signature = JSON.stringify(intent);
            if (editRequest.current && editRequest.current.signature !== signature) throw new Error('The previous save is unconfirmed. Retry it unchanged or cancel to reload.');
            editRequest.current ||= { signature, requestId: crypto.randomUUID() };
            const result = await saveTrackedOrder(orderId, { ...intent, requestId: editRequest.current.requestId }, token);

            showToast('Order updated successfully!', 'success');
            setOrder(result.order);
            setToken(result.token);
            editRequest.current = null;
            setIsEditing(false);
            setContactVerify(editDetails.contactNumber);
        } catch (err) {
            console.error(err);
            setSaveError(`${err.message} Retry the same changes, or cancel editing to reload.`);
            showToast(err.message || 'Failed to update order', 'error');
        } finally {
            saveInFlight.current = false;
            setSaving(false);
        }
    };

    const currentStatus = order?.details?.fulfillmentStatus || 'pending';
    const timelineStatus = currentStatus === 'returned'
        ? (order?.details?.previousFulfillmentStatus || 'shipped')
        : currentStatus;
    const statusIdx = Math.max(0, STATUS_STEPS.findIndex(s => s.key === timelineStatus));
    const canEdit = currentStatus === 'pending' && order?.items.length > 0;

    const updateEditItem = (idx, changes) => setEditItems(prev => prev.map((entry, i) => (i === idx ? { ...entry, ...changes } : entry)));
    const cancelEditing = async () => {
        setIsEditing(false);
        setSaveError('');
        await fetchOrder(orderId, contactVerify, { verifyContact: false, notify: false });
    };

    if (!isVerified || !order?.items.length) {
        return (
            <div className="flex min-h-dvh flex-col bg-ground text-ink">
                <header className="border-b border-line">
                    <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
                        <a href="/" aria-label="SportsTech home"><Logo className="h-9 sm:h-10" /></a>
                    </div>
                </header>
                <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
                    <h1 className="display text-5xl sm:text-6xl">Track order</h1>
                    <p className="mt-3 text-ink-2">Verify your identity to proceed. Enter the contact number you used at checkout.</p>
                    <form onSubmit={handleVerify} className="mt-8 space-y-4">
                        <div>
                            <label htmlFor="verify-phone" className="field-label">Contact number</label>
                            <input id="verify-phone" type="tel" inputMode="tel" autoComplete="tel" value={contactVerify}
                                onChange={e => setContactVerify(e.target.value)} placeholder="Enter your registered number" className="field" required />
                        </div>
                        <button type="submit" disabled={loading} className="btn-primary h-12 w-full text-base">
                            {loading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Checking…</> : 'Track order'}
                        </button>
                    </form>
                    <a href="/" className="btn-ghost mt-4 self-center"><ArrowLeft size={16} aria-hidden="true" /> Back to shop</a>
                </main>
            </div>
        );
    }

    const subtotal = order.items.reduce((acc, item) => acc + (item.details.originalAmount || item.amount), 0);
    const balance = Math.max(0, order.totalAmount - order.paidAmount);
    const shipping = order.details.shippingDetails || {};

    return (
        <div className="min-h-dvh bg-ground text-ink">
            <header className="sticky top-0 z-30 border-b border-line bg-ground">
                <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
                    <a href="/" aria-label="SportsTech home"><Logo className="h-9 sm:h-10" /></a>
                    <a href="/" className="btn-ghost"><ArrowLeft size={16} aria-hidden="true" /> <span>Back to shop</span></a>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-4 sm:px-6 sm:pt-12">
                {!isEditing ? (
                    <>
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0">
                                <p className="flex items-center gap-1 text-sm text-ink-2">
                                    Order <span className="num font-semibold text-ink">#{orderId.slice(0, 8).toUpperCase()}</span>
                                    <button type="button" className="icon-btn size-9" aria-label="Copy order ID"
                                        onClick={() => { navigator.clipboard.writeText(orderId); showToast('ID copied!', 'success'); }}>
                                        <Copy size={15} />
                                    </button>
                                </p>
                                <h1 className="display mt-1 text-4xl sm:text-5xl">Hello, {order.details.customerName}</h1>
                                <p className="mt-2 text-ink-2">Placed on {longDate(order.date)}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={clsx('badge h-9 px-3.5 text-sm',
                                    currentStatus === 'returned' ? 'border-amber-500/50 text-amber-300'
                                        : currentStatus === 'shipped' ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-600 text-ink')}>
                                    <span className={clsx('size-2 rounded-full', currentStatus === 'returned' ? 'bg-amber-400' : currentStatus === 'shipped' ? 'bg-emerald-400' : 'bg-primary')} aria-hidden="true" />
                                    {STATUS_LABELS[currentStatus] || currentStatus.replace('_', ' ')}
                                </span>
                                {canEdit && <button type="button" onClick={startEditing} className="btn-light">Modify order</button>}
                            </div>
                        </div>

                        <div className="mt-5 flex items-center justify-between gap-3 border-y border-line py-2.5 text-sm">
                            <p role="status" className={refreshError ? 'text-amber-300' : 'text-ink-2'}>{refreshError || 'Status refreshes every 30 seconds while this page is visible.'}</p>
                            <button type="button" disabled={loading} onClick={() => fetchOrder(orderId, contactVerify, { verifyContact: false, notify: false })}
                                className="btn-ghost min-h-10 shrink-0 text-sm">
                                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
                            </button>
                        </div>

                        {currentStatus === 'returned' && (
                            <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                                <RotateCcw size={20} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                                <div>
                                    <h2 className="font-semibold text-amber-200">Order returned</h2>
                                    <p className="mt-0.5 text-sm text-amber-100/80">
                                        This order was marked as returned{order.details.returnedAt ? ` on ${longDate(order.details.returnedAt)}` : ''}.
                                    </p>
                                </div>
                            </div>
                        )}

                        <section className="mt-8" aria-labelledby="status-title">
                            <h2 id="status-title" className="section-title">Order status</h2>
                            <ol className="mt-5 grid gap-0 sm:grid-cols-4 sm:gap-3">
                                {STATUS_STEPS.map((step, index) => {
                                    const done = index < statusIdx || (index === statusIdx && timelineStatus === 'shipped');
                                    const current = index === statusIdx;
                                    const reached = index <= statusIdx;
                                    return (
                                        <li key={step.key} aria-current={current ? 'step' : undefined}
                                            className="relative flex gap-4 pb-6 last:pb-0 sm:flex-col sm:gap-3 sm:pb-0">
                                            <span className={clsx('absolute top-8 bottom-0 left-[15px] w-0.5 sm:hidden', index === STATUS_STEPS.length - 1 && 'hidden', index < statusIdx ? 'bg-primary' : 'bg-line')} aria-hidden="true" />
                                            <span className={clsx('hidden h-1 rounded-full sm:block', reached ? 'bg-primary' : 'bg-line')} aria-hidden="true" />
                                            <span className={clsx('relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold sm:hidden',
                                                reached ? 'border-primary bg-primary text-white' : 'border-line bg-ground text-ink-3')}>
                                                {done || index < statusIdx ? <Check size={16} aria-hidden="true" /> : index + 1}
                                            </span>
                                            <div className={clsx(!reached && 'opacity-55')}>
                                                <p className="flex items-center gap-2 font-semibold">
                                                    {step.label}
                                                    {current && <span className="badge border-primary/50 text-primary">Current</span>}
                                                </p>
                                                <p className="mt-0.5 text-sm text-ink-2">{step.description}</p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>

                        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                            <section className="surface p-5 sm:p-6" aria-labelledby="summary-title">
                                <h2 id="summary-title" className="section-title">Order summary</h2>
                                <ul className="mt-4 divide-y divide-line">
                                    {order.items.map(item => (
                                        <li key={item.id} className="flex gap-4 py-3 first:pt-0">
                                            <Thumb src={item.details.imageUrl} />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold leading-snug">{item.details.itemName}</p>
                                                <p className="mt-0.5 text-sm text-ink-2">{item.details.size && item.details.size !== 'N/A' ? `Size ${item.details.size} · ` : ''}Qty {item.details.quantity}</p>
                                            </div>
                                            <p className="num shrink-0 font-semibold">{peso(item.details.originalAmount || item.amount)}</p>
                                        </li>
                                    ))}
                                </ul>
                                <dl className="num mt-4 space-y-2 border-t border-line pt-4 text-sm">
                                    <div className="flex justify-between"><dt className="text-ink-2">Subtotal</dt><dd>{peso(subtotal)}</dd></div>
                                    {order.discountAmount > 0 && <div className="flex justify-between text-emerald-300"><dt>Discount</dt><dd>−{peso(order.discountAmount)}</dd></div>}
                                    <div className="flex justify-between"><dt className="text-ink-2">Shipping</dt><dd>{peso(shipping.shippingFee || 0)}</dd></div>
                                    {order.totalRushFee > 0 && <div className="flex justify-between"><dt className="text-ink-2">Rush processing</dt><dd>{peso(order.totalRushFee)}</dd></div>}
                                    {order.priceAdjustment !== 0 && <div className="flex justify-between"><dt className="text-ink-2">Saved price adjustment</dt><dd>{peso(order.priceAdjustment)}</dd></div>}
                                    <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Order total</dt><dd>{peso(order.totalAmount)}</dd></div>
                                    <div className="flex justify-between"><dt className="text-ink-2">Paid</dt><dd>{peso(order.paidAmount)}</dd></div>
                                    <div className={clsx('flex justify-between font-semibold', balance > 0 ? 'text-ink' : 'text-emerald-300')}><dt>Balance due</dt><dd>{peso(balance)}</dd></div>
                                </dl>
                            </section>

                            <section className="surface p-5 sm:p-6" aria-labelledby="delivery-title">
                                <h2 id="delivery-title" className="section-title">Delivery info</h2>
                                <dl className="mt-4 space-y-5 text-[15px]">
                                    <div>
                                        <dt className="text-sm text-ink-2">Customer</dt>
                                        <dd className="mt-0.5 font-semibold">{order.details.customerName}</dd>
                                        <dd className="text-ink-2">{order.details.contactNumber}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-ink-2">Shipping address</dt>
                                        <dd className="mt-0.5 font-semibold">{shipping.address}</dd>
                                        <dd className="text-ink-2">{shipping.barangay}, {shipping.city}{shipping.province ? `, ${shipping.province}` : ''}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-ink-2">Payment mode</dt>
                                        <dd className="mt-0.5 font-semibold">{order.details.paymentMode}</dd>
                                        <dd className="text-ink-2">Cutoff: every Thursday</dd>
                                    </div>
                                </dl>
                                <p className="mt-6 border-t border-line pt-4 text-sm text-ink-2">
                                    This order is tracked in real time. Status updates appear on this page automatically.
                                </p>
                            </section>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                            <h1 className="display text-4xl sm:text-5xl">Modify order</h1>
                            <div className="flex gap-2">
                                <button type="button" disabled={saving} onClick={cancelEditing} className="btn-secondary">Cancel</button>
                                <button type="button" onClick={handleSave} disabled={saving || !!editPricing?.error} className="btn-primary">
                                    {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving…</> : 'Save changes'}
                                </button>
                            </div>
                        </div>

                        <div role={saveError || editPricing?.error ? 'alert' : 'status'}
                            className={clsx('mt-5 rounded-xl border p-4 text-sm', saveError || editPricing?.error ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-line bg-raised')}>
                            {saveError || editPricing?.error || <>Updated order total: <span className="num font-semibold">₱{editPricing?.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></>}
                            {editPricing?.options?.legacyDiscount && <p className="mt-2 text-ink-2">This older order keeps its original peso discount. Shipping is charged once; rush fees follow the shirt quantity.</p>}
                        </div>

                        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                            <section className="surface p-5 sm:p-6" aria-labelledby="edit-items-title">
                                <h2 id="edit-items-title" className="section-title">Order items</h2>
                                <ul className="mt-4 divide-y divide-line">
                                    {editItems.map((item, idx) => (
                                        <li key={item.id} className="flex gap-4 py-4 first:pt-0">
                                            <Thumb src={item.imageUrl} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="font-semibold leading-snug">{item.name}</p>
                                                    <button type="button" onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                                                        className="icon-btn -mt-2 -mr-2 size-10 hover:text-red-400" aria-label={`Remove ${item.name}`}>
                                                        <X size={18} />
                                                    </button>
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-end gap-4">
                                                    <div>
                                                        <label htmlFor={`edit-size-${item.id}`} className="field-label text-xs">Size</label>
                                                        <select id={`edit-size-${item.id}`} disabled={item.category !== 'shirts'} value={item.size}
                                                            onChange={e => updateEditItem(idx, { size: e.target.value })} className="field w-28">
                                                            {!SIZES.includes(item.size) && <option value={item.size}>{item.size || 'N/A'}</option>}
                                                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <p className="field-label text-xs">Quantity</p>
                                                        <div className="flex items-center rounded-full border border-line">
                                                            <button type="button" className="icon-btn" aria-label={`Decrease quantity for ${item.name}`}
                                                                onClick={() => { if (item.quantity > 1) updateEditItem(idx, { quantity: item.quantity - 1 }); }}>
                                                                <Minus size={16} />
                                                            </button>
                                                            <span className="num w-8 text-center font-semibold">{item.quantity}</span>
                                                            <button type="button" className="icon-btn" aria-label={`Increase quantity for ${item.name}`}
                                                                onClick={() => updateEditItem(idx, { quantity: item.quantity + 1 })}>
                                                                <Plus size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>

                            <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="edit-details-title">
                                <h2 id="edit-details-title" className="section-title">Shipping details</h2>
                                <div>
                                    <label htmlFor="edit-name" className="field-label">Full name</label>
                                    <input id="edit-name" type="text" autoComplete="name" value={editDetails.customerName}
                                        onChange={e => setEditDetails({ ...editDetails, customerName: e.target.value })} className="field" />
                                </div>
                                <div>
                                    <label htmlFor="edit-phone" className="field-label">Contact number</label>
                                    <input id="edit-phone" type="tel" inputMode="tel" autoComplete="tel" value={editDetails.contactNumber}
                                        onChange={e => setEditDetails({ ...editDetails, contactNumber: e.target.value })} className="field" />
                                </div>
                                <div>
                                    <label htmlFor="edit-street" className="field-label">Street address</label>
                                    <input id="edit-street" type="text" autoComplete="street-address" value={editDetails.address}
                                        onChange={e => setEditDetails({ ...editDetails, address: e.target.value })} className="field" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="edit-city" className="field-label">City</label>
                                        <input id="edit-city" type="text" value={editDetails.city} className="field" disabled />
                                    </div>
                                    <div>
                                        <label htmlFor="edit-barangay" className="field-label">Barangay</label>
                                        <input id="edit-barangay" type="text" value={editDetails.barangay} className="field" disabled />
                                    </div>
                                </div>
                                <p className="text-xs text-ink-2">City and barangay can't be changed after shipping has been calculated.</p>
                            </section>
                        </div>
                    </>
                )}

                <ContactLine />
            </main>
        </div>
    );
}
