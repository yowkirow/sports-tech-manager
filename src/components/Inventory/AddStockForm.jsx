import React, { useState } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useActivityLog } from '../../hooks/useActivityLog';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['White', 'Black', 'Kiwi', 'Cream', 'Baby Blue'];

export default function AddStockForm({ onAddTransaction, onClose }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();

    const [loading, setLoading] = useState(false);

    // Form State
    const [category, setCategory] = useState('blanks'); // blanks, accessories
    const [quantity, setQuantity] = useState('1');
    const [cost, setCost] = useState('');
    const [description, setDescription] = useState('');

    // Shirt Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('White');

    // Accessory Details
    const [subCategory, setSubCategory] = useState('');

    // Auto-calculate cost for blanks
    React.useEffect(() => {
        if (category === 'blanks') {
            const qty = parseInt(quantity) || 0;
            setCost((qty * 70).toFixed(2));
        }
    }, [category, quantity]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const finalCost = parseFloat(cost) || 0; // Allow 0 cost

            // 1. Construct Details
            let details = {
                quantity: parseInt(quantity)
            };

            if (category === 'blanks') {
                details = { ...details, size, color };
            } else {
                details = { ...details, subCategory };
            }

            // 2. Create Transaction
            const newTransaction = {
                id: crypto.randomUUID(),
                type: 'expense',
                amount: finalCost,
                description: description || (category === 'blanks' ? `Bought ${quantity}x ${color} ${size}` : `Bought ${subCategory}`),
                category,
                date: new Date().toISOString(),
                details
            };

            await onAddTransaction(newTransaction);

            // Log Activity
            await logActivity('Add Inventory', {
                item: newTransaction.description,
                quantity: details.quantity,
                cost: finalCost
            }, newTransaction.id);

            // Reset Form or Close
            // If we want to keep adding, we reset. But closing is also fine. 
            // Let's reset for bulk entry ease.
            setQuantity('1');
            if (category !== 'blanks') setCost(''); // Reset cost only if not fixed
            setDescription('');
            setSubCategory('');
            showToast('Stock Added', 'success');

        } catch (error) {
            console.error(error);
            showToast('Failed to add stock', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-2xl mx-auto shadow-2xl relative flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                <h2 className="text-2xl font-bold text-white">Add New Stock</h2>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white transition-colors bg-white/5 p-2 rounded-lg hover:bg-white/10"
                >
                    <X size={24} />
                </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar">
                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* Category Selection */}
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            type="button"
                            onClick={() => setCategory('blanks')}
                            className={`p-4 rounded-xl border transition-all ${category === 'blanks'
                                ? 'bg-primary/20 border-primary text-white'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                                }`}
                        >
                            <span className="block font-semibold">Blank Shirt</span>
                            <span className="text-xs text-primary/80 mt-1">Fixed Cost: ₱70</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setCategory('accessories')}
                            className={`p-4 rounded-xl border transition-all ${category === 'accessories'
                                ? 'bg-primary/20 border-primary text-white'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                                }`}
                        >
                            <span className="block font-semibold">Accessory / Other</span>
                        </button>
                    </div>

                    {/* Specific Fields */}
                    <AnimatePresence mode="wait">
                        {category === 'blanks' ? (
                            <motion.div
                                key="blanks-fields"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="grid grid-cols-2 gap-4"
                            >
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Size</label>
                                    <select
                                        value={size}
                                        onChange={(e) => setSize(e.target.value)}
                                        className="glass-input appearance-none"
                                    >
                                        {SIZES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Color</label>
                                    <select
                                        value={color}
                                        onChange={(e) => setColor(e.target.value)}
                                        className="glass-input appearance-none"
                                    >
                                        {COLORS.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                                    </select>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="acc-fields"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                            >
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Item Name</label>
                                    <input
                                        type="text"
                                        value={subCategory}
                                        onChange={(e) => setSubCategory(e.target.value)}
                                        placeholder="e.g. Stickers, Packaging"
                                        className="glass-input"
                                        required
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Common Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Quantity</label>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                min="1"
                                className="glass-input"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Total Cost (₱)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={cost}
                                    onChange={(e) => setCost(e.target.value)}
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                    readOnly={category === 'blanks'}
                                    className={`glass-input ${category === 'blanks' ? 'opacity-70 cursor-not-allowed bg-black/20' : ''}`}
                                />
                                {category === 'blanks' && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 bg-black/40 px-1 rounded">
                                        AUTO (70/unit)
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Description / Note</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional note..."
                            className="glass-input"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full py-4 text-lg shadow-lg shadow-indigo-500/20"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Plus size={20} />}
                        {loading ? 'Saving...' : 'Add to Inventory'}
                    </button>

                </form>
            </div>
        </div>
    );
}
