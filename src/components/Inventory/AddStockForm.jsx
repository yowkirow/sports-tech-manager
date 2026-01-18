import React, { useState } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['Black', 'White', 'Navy', 'Heather Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Aqua', 'Peach'];

export default function AddStockForm({ onAddTransaction }) {
    const { showToast } = useToast();

    const [loading, setLoading] = useState(false);

    // Form State
    const [category, setCategory] = useState('blanks'); // blanks, accessories
    const [quantity, setQuantity] = useState('1');
    const [cost, setCost] = useState('');
    const [description, setDescription] = useState('');

    // Shirt Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('Black');

    // Accessory Details
    const [subCategory, setSubCategory] = useState('');

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

            // Reset Form
            setQuantity('1');
            setCost('');
            setDescription('');
            setSubCategory('');

        } catch (error) {
            console.error(error);
            showToast('Failed to add stock', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6 rounded-2xl max-w-2xl mx-auto"
        >
            <h2 className="text-2xl font-bold mb-6 text-white">Add New Stock</h2>

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
                        <input
                            type="number"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            className="glass-input"
                        />
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
        </motion.div>
    );
}
