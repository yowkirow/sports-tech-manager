import React, { useState, useMemo } from 'react';
import { Package, Copy, CheckCircle2, Circle, Truck, AlertCircle } from 'lucide-react';
import { useToast } from '../ui/Toast';
import clsx from 'clsx';
import { groupOrders } from '../../lib/orderItems.js';
import { useReadOnly } from '../ui/ReadOnly';

const numberOr = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export default function SupplierManager({ transactions }) {
    const { showToast } = useToast();
    const [filterType, setFilterType] = useState('unfulfilled'); // 'unfulfilled' | 'week'
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [copying, setCopying] = useState(false);
    const readOnly = useReadOnly();

    // 1. Group transactions into logical orders (Sale types)
    const orders = useMemo(() => {
        return groupOrders(transactions).filter(order => {
            const isPending = `${order.fulfillmentStatus || ''}`.toLowerCase() === 'pending';

            if (filterType === 'unfulfilled') {
                return isPending;
            }

            if (filterType === 'week') {
                const orderDate = new Date(order.date);
                const now = new Date();
                const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return orderDate >= oneWeekAgo && isPending;
            }

            return isPending; // Ensure other states are filtered out by default if a new filter is added
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [transactions, filterType]);

    // 2. Selection Handlers
    const toggleOrder = (id) => {
        const next = new Set(selectedOrderIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedOrderIds(next);
    };

    const selectAll = () => {
        const next = new Set(orders.map(o => o.id));
        setSelectedOrderIds(next);
    };

    const selectNone = () => {
        setSelectedOrderIds(new Set());
    };

    // 3. Aggegration Logic (The "Magic")
    const aggregatedData = useMemo(() => {
        const selectedOrdersList = orders.filter(o => selectedOrderIds.has(o.id));
        const shirtMap = {}; // { Brand - Color: { color, brand, sizes } }
        const itemMap = {}; // { Product Name: Quantity }
        let hasMissingShirtData = false;

        selectedOrdersList.forEach(order => {
            order.items.forEach(item => {
                const details = item.details || {};
                const category = (details.category || item.category || '').toLowerCase();
                const name = details.itemName || item.description || 'Unknown Item';
                const qty = numberOr(details.quantity, 1);

                if (category !== 'shirts') {
                    if (!itemMap[name]) itemMap[name] = 0;
                    itemMap[name] += qty;
                    return;
                }

                const brand = (details.brand || 'Sypik').trim();
                const color = (details.color || details.linkedColor || 'Unknown').trim() || 'Unknown';
                const size = (details.size || 'Unknown').trim() || 'Unknown';
                const groupLabel = `${brand} - ${color}`;

                if (color === 'Unknown' || size === 'Unknown') {
                    hasMissingShirtData = true;
                }

                if (!shirtMap[groupLabel]) {
                    shirtMap[groupLabel] = { brand, color, sizes: {} };
                }
                if (!shirtMap[groupLabel].sizes[size]) shirtMap[groupLabel].sizes[size] = 0;
                shirtMap[groupLabel].sizes[size] += qty;
            });
        });

        return { shirts: shirtMap, items: itemMap, hasMissingShirtData };
    }, [orders, selectedOrderIds]);

    const totalSelectedItems = Object.values(aggregatedData.shirts).reduce((sum, group) =>
        sum + Object.values(group.sizes).reduce((a, b) => a + b, 0), 0
    ) + Object.values(aggregatedData.items).reduce((a, b) => a + b, 0);
    const selectedColors = Object.keys(aggregatedData.shirts).length;

    // 4. Formatting Engine
    const generatedText = useMemo(() => {
        const shirts = Object.entries(aggregatedData.shirts);
        const items = Object.keys(aggregatedData.items);
        if (shirts.length === 0 && items.length === 0) return "No items selected.";

        const shirtText = shirts.map(([label, group]) => {
            const sizes = group.sizes;
            const sizeLines = Object.keys(sizes)
                .map(size => `${size} - ${sizes[size]}`)
                .join('\n');

            return `${label}\n${sizeLines}`;
        });

        const itemText = items.map(item => `${item} - ${aggregatedData.items[item]}`);

        return [...shirtText, ...itemText].join('\n\n');
    }, [aggregatedData]);

    const handleCopy = () => {
        setCopying(true);
        navigator.clipboard.writeText(generatedText);
        showToast('Supplier text copied!', 'success');
        setTimeout(() => setCopying(false), 2000);
    };

    const renderOrderItemChip = (item, idx) => {
        const color = item.details?.color || item.details?.linkedColor || '';
        const quantity = numberOr(item.details?.quantity, 1);
        const label = item.details?.category === 'shirts'
            ? `${item.details?.itemName} • ${item.details?.brand || 'Sypik'} • ${item.details?.size || 'N/A'} - ${quantity}`
            : `${item.details?.itemName} - ${quantity}`;

        return (
            <span
                key={item.id || idx}
                className="badge border-line text-ink-2 num"
            >
                {item.details?.category === 'shirts' && (
                    <span className="size-2 rounded-full border border-line" style={{ backgroundColor: color.toLowerCase() === 'white' ? '#fff' : color }} />
                )}
                {label}
            </span>
        );
    };

    return (
        <div className="flex h-full flex-col gap-5" data-read-only={readOnly ? 'true' : undefined}>
            {/* Header / Toolbar */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Supplier filters">
                    <button
                        type="button"
                        onClick={() => setFilterType('unfulfilled')}
                        className="chip"
                        aria-pressed={filterType === 'unfulfilled'}
                    >
                        Pending Orders
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilterType('week')}
                        className="chip"
                        aria-pressed={filterType === 'week'}
                    >
                        Pending (Last 7 Days)
                    </button>
                </div>

                <div className="flex gap-2">
                    <button type="button" onClick={selectAll} className="btn-secondary">Select All</button>
                    <button type="button" onClick={selectNone} className="btn-ghost">Clear</button>
                </div>
            </div>

            <div className="surface grid grid-cols-1 divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Pending Orders</p>
                    <p className="display mt-2 text-3xl num">{orders.length}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Selected</p>
                    <p className="display mt-2 text-3xl num">{selectedOrderIds.size}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Total Items</p>
                    <p className="display mt-2 text-3xl num">{totalSelectedItems}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Colors</p>
                    <p className="display mt-2 text-3xl num">{selectedColors}</p>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-2">
                {/* Left Column: Order Selection */}
                <section className="surface flex min-h-[400px] flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                        <h3 className="section-title flex items-center gap-2">
                            <Truck size={18} className="text-ink-3" aria-hidden="true" />
                            Pending Orders ({orders.length})
                        </h3>
                        <span className="text-sm text-ink-2 num">
                            {selectedOrderIds.size} selected
                        </span>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {orders.length === 0 ? (
                            <div className="m-4 flex h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-line text-center text-ink-2">
                                <Package size={32} className="mb-3 text-ink-3" aria-hidden="true" />
                                <p>No matching orders found</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-line">
                                {orders.map(order => (
                                    <button
                                        key={order.id}
                                        type="button"
                                        onClick={() => toggleOrder(order.id)}
                                        className={clsx(
                                            "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-white/[0.04] sm:gap-4",
                                            selectedOrderIds.has(order.id) && "bg-primary/10"
                                        )}
                                    >
                                        <span className={clsx(
                                            "mt-0.5 shrink-0 transition-colors",
                                            selectedOrderIds.has(order.id) ? "text-primary" : "text-ink-3"
                                        )}>
                                            {selectedOrderIds.has(order.id) ? <CheckCircle2 size={24} aria-hidden="true" /> : <Circle size={24} aria-hidden="true" />}
                                        </span>

                                        <span className="min-w-0 flex-1">
                                            <span className="mb-1 flex items-start justify-between gap-3">
                                                <span className="truncate font-semibold text-ink">{order.customerName}</span>
                                                <span className="shrink-0 text-xs text-ink-3">#{order.id.slice(-6).toUpperCase()}</span>
                                            </span>
                                            <span className="flex flex-wrap gap-2">
                                                {order.items.map(renderOrderItemChip)}
                                            </span>
                                        </span>

                                        <span className="shrink-0 text-right">
                                            <span className="block text-xs text-ink-2">{new Date(order.date).toLocaleDateString()}</span>
                                            <span className="badge mt-1 border-amber-500/40 capitalize text-amber-300">{order.fulfillmentStatus}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* Right Column: Preview & Output */}
                <div className="flex min-h-0 flex-col gap-5">
                    {/* Data Quality Check */}
                    {selectedOrderIds.size > 0 && aggregatedData.hasMissingShirtData && (
                        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                            <AlertCircle className="shrink-0 text-amber-300" size={20} aria-hidden="true" />
                            <div>
                                <h4 className="text-sm font-semibold text-amber-200">Missing Data Detected</h4>
                                <p className="mt-1 text-xs text-amber-100/80">
                                    Some selected orders are missing Color or Size information. Please check your product definitions.
                                </p>
                            </div>
                        </div>
                    )}

                    <section className="surface flex min-h-[400px] flex-1 flex-col overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <h3 className="section-title flex items-center gap-2">
                                <Copy size={18} className="text-ink-3" aria-hidden="true" />
                                Supplier Message Preview
                            </h3>
                            <button
                                type="button"
                                onClick={handleCopy}
                                disabled={selectedOrderIds.size === 0}
                                className={clsx(
                                    "btn-primary w-full sm:w-auto",
                                    selectedOrderIds.size === 0 && "bg-well text-ink-3 hover:bg-well"
                                )}
                            >
                                {copying ? <CheckCircle2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                                {copying ? 'Copied!' : 'Copy to Clipboard'}
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto bg-well p-5 font-mono text-sm">
                            {selectedOrderIds.size === 0 ? (
                                <div className="flex h-full items-center justify-center text-center text-ink-2">
                                    Select orders from the left to generate text...
                                </div>
                            ) : (
                                <pre className="whitespace-pre-wrap text-ink">
                                    {generatedText}
                                </pre>
                            )}
                        </div>

                        {/* Summary Widget */}
                        {selectedOrderIds.size > 0 && (
                            <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
                                <div className="p-4">
                                    <p className="text-sm text-ink-2">Total Items</p>
                                    <p className="display mt-1 text-2xl num">{totalSelectedItems}</p>
                                </div>
                                <div className="p-4 text-right">
                                    <p className="text-sm text-ink-2">Colors</p>
                                    <p className="display mt-1 text-2xl num">{selectedColors}</p>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
