import React, { useState, useMemo } from 'react';
import { Package, Copy, CheckCircle2, Circle, Filter, Calendar, Truck, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ui/Toast';
import clsx from 'clsx';

export default function SupplierManager({ transactions }) {
    const { showToast } = useToast();
    const [filterType, setFilterType] = useState('unfulfilled'); // 'unfulfilled' | 'week'
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [copying, setCopying] = useState(false);

    // 1. Group transactions into logical orders (Sale types)
    const orders = useMemo(() => {
        const sales = transactions.filter(t => t.type === 'sale');
        const grouped = sales.reduce((acc, t) => {
            const orderId = t.details?.orderId || t.id;
            if (!acc[orderId]) {
                acc[orderId] = {
                    id: orderId,
                    customerName: t.details?.customerName || 'Unknown',
                    date: t.date,
                    fulfillmentStatus: t.details?.fulfillmentStatus || 'pending',
                    items: []
                };
            }
            acc[orderId].items.push(t);
            return acc;
        }, {});

        // Filter based on UI state
        return Object.values(grouped).filter(order => {
            const isUnfulfilled = !['shipped', 'delivered'].includes(order.fulfillmentStatus);

            if (filterType === 'unfulfilled') {
                return isUnfulfilled;
            }

            if (filterType === 'week') {
                const orderDate = new Date(order.date);
                const now = new Date();
                const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return orderDate >= oneWeekAgo && isUnfulfilled;
            }

            return true;
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
        const colorMap = {}; // { Color: { Size: Quantity } }

        selectedOrdersList.forEach(order => {
            order.items.forEach(item => {
                const color = item.details?.linkedColor || "Unknown";
                const size = item.details?.size || "Unknown";
                const qty = item.details?.quantity || 1;

                if (!colorMap[color]) colorMap[color] = {};
                if (!colorMap[color][size]) colorMap[color][size] = 0;
                colorMap[color][size] += qty;
            });
        });

        return colorMap;
    }, [orders, selectedOrderIds]);

    // 4. Formatting Engine
    const generatedText = useMemo(() => {
        const colors = Object.keys(aggregatedData);
        if (colors.length === 0) return "No items selected.";

        return colors.map(color => {
            const sizes = aggregatedData[color];
            const sizeLines = Object.keys(sizes)
                .map(size => `${size} - ${sizes[size]}`)
                .join('\n');

            return `${color}\n${sizeLines}`;
        }).join('\n\n');
    }, [aggregatedData]);

    const handleCopy = () => {
        setCopying(true);
        navigator.clipboard.writeText(generatedText);
        showToast('Supplier text copied!', 'success');
        setTimeout(() => setCopying(false), 2000);
    };

    return (
        <div className="space-y-6 h-full flex flex-col">
            {/* Header / Toolbar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex bg-white/5 p-1 rounded-xl">
                    <button
                        onClick={() => setFilterType('unfulfilled')}
                        className={clsx(
                            "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                            filterType === 'unfulfilled' ? "bg-primary text-white shadow-lg" : "text-slate-400 hover:text-white"
                        )}
                    >
                        Pending Orders
                    </button>
                    <button
                        onClick={() => setFilterType('week')}
                        className={clsx(
                            "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                            filterType === 'week' ? "bg-primary text-white shadow-lg" : "text-slate-400 hover:text-white"
                        )}
                    >
                        Unfulfilled (Last 7 Days)
                    </button>
                </div>

                <div className="flex gap-2">
                    <button onClick={selectAll} className="text-xs font-bold text-slate-400 hover:text-white px-3 py-2">Select All</button>
                    <button onClick={selectNone} className="text-xs font-bold text-slate-400 hover:text-white px-3 py-2">Clear</button>
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6 flex-1 min-h-0">
                {/* Left Column: Order Selection */}
                <div className="glass-card flex flex-col p-0 overflow-hidden min-h-[400px]">
                    <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                        <h3 className="font-bold flex items-center gap-2">
                            <Truck size={18} className="text-primary" />
                            Pending Orders ({orders.length})
                        </h3>
                        <span className="text-xs text-slate-500 font-mono">
                            {selectedOrderIds.size} selected
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {orders.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2 opacity-50">
                                <Package size={48} />
                                <p>No matching orders found</p>
                            </div>
                        ) : (
                            orders.map(order => (
                                <motion.div
                                    key={order.id}
                                    layout
                                    onClick={() => toggleOrder(order.id)}
                                    className={clsx(
                                        "p-4 rounded-xl border cursor-pointer transition-all flex items-center gap-4 group",
                                        selectedOrderIds.has(order.id)
                                            ? "bg-primary/10 border-primary/30 shadow-lg shadow-primary/5"
                                            : "bg-white/5 border-white/5 hover:border-white/10"
                                    )}
                                >
                                    <div className={clsx(
                                        "shrink-0 transition-colors",
                                        selectedOrderIds.has(order.id) ? "text-primary" : "text-slate-600 group-hover:text-slate-400"
                                    )}>
                                        {selectedOrderIds.has(order.id) ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-1">
                                            <h4 className="font-bold text-white truncate">{order.customerName}</h4>
                                            <span className="text-[10px] text-slate-500 font-mono italic">#{order.id.slice(-6).toUpperCase()}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {order.items.map((item, idx) => (
                                                <span
                                                    key={idx}
                                                    className="text-[10px] bg-white/15 px-2 py-0.5 rounded text-slate-300 flex items-center gap-1"
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.details?.linkedColor?.toLowerCase() === 'white' ? '#fff' : item.details?.linkedColor }} />
                                                    {item.details.size} - {item.details.quantity || 1}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] text-slate-500">{new Date(order.date).toLocaleDateString()}</p>
                                        <p className="text-[10px] font-bold text-primary uppercase tracking-tighter">{order.fulfillmentStatus}</p>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right Column: Preview & Output */}
                <div className="flex flex-col gap-6 h-full">
                    {/* Data Quality Check */}
                    {selectedOrderIds.size > 0 && Object.keys(aggregatedData).includes('Unknown') && (
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-xl flex items-start gap-4"
                        >
                            <AlertCircle className="text-orange-400 shrink-0" size={20} />
                            <div>
                                <h4 className="text-sm font-bold text-orange-200">Missing Data Detected</h4>
                                <p className="text-xs text-orange-200/60 mt-1">
                                    Some selected orders are missing Color or Size information. Please check your product definitions.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    <div className="glass-card flex-1 flex flex-col p-0 overflow-hidden relative group">
                        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <h3 className="font-bold flex items-center gap-2">
                                <Copy size={18} className="text-primary" />
                                Supplier Message Preview
                            </h3>
                            <button
                                onClick={handleCopy}
                                disabled={selectedOrderIds.size === 0}
                                className={clsx(
                                    "px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all",
                                    selectedOrderIds.size === 0
                                        ? "bg-white/5 text-slate-600 cursor-not-allowed"
                                        : "bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/20"
                                )}
                            >
                                {copying ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                                {copying ? 'Copied!' : 'Copy to Clipboard'}
                            </button>
                        </div>

                        <div className="flex-1 p-6 font-mono text-sm overflow-y-auto custom-scrollbar bg-black/20">
                            {selectedOrderIds.size === 0 ? (
                                <div className="h-full flex items-center justify-center text-slate-600 italic">
                                    Select orders from the left to generate text...
                                </div>
                            ) : (
                                <pre className="whitespace-pre-wrap text-emerald-400">
                                    {generatedText}
                                </pre>
                            )}
                        </div>

                        {/* Summary Widget */}
                        <AnimatePresence>
                            {selectedOrderIds.size > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    className="p-4 bg-white/[0.02] border-t border-white/10 grid grid-cols-2 gap-4"
                                >
                                    <div>
                                        <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mb-1">Total Items</p>
                                        <p className="text-2xl font-bold font-mono">
                                            {Object.values(aggregatedData).reduce((sum, sizes) =>
                                                sum + Object.values(sizes).reduce((a, b) => a + b, 0), 0
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mb-1">Colors</p>
                                        <p className="text-2xl font-bold font-mono">{Object.keys(aggregatedData).length}</p>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
