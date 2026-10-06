import React, { useState } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2, X } from 'lucide-react';

import { useActivityLog } from '../../hooks/useActivityLog';
import { api } from '../../lib/apiClient';
import { useColors, useBrands } from '../../hooks/useInventory';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

export default function AddStockForm({ onAddTransaction, onClose, transactions }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const colors = useColors(transactions || []);
    const brands = useBrands(transactions || []);
    const readOnly = useReadOnly();

    const [loading, setLoading] = useState(false);

    // Form State
    const [category, setCategory] = useState('blanks'); // blanks, accessories
    const [quantity, setQuantity] = useState('1');
    const [cost, setCost] = useState('');
    const [description, setDescription] = useState('');

    // Shirt Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('White');
    const [brand, setBrand] = useState('Sypik');

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
            const user = await api.getCurrentUser();

            // 1. Construct Details
            let details = {
                quantity: parseInt(quantity),
                createdBy: user?.email || 'Unknown'
            };

            if (category === 'blanks') {
                details = { ...details, size, linkedColor: color, brand };
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
        <div className="mx-auto flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sheet">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                    <h2 className="display text-2xl">Add New Stock</h2>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="icon-btn -mr-2 -mt-1"
                    aria-label="Close"
                >
                    <X size={22} aria-hidden="true" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0 min-h-0 flex-1 overflow-y-auto">
                    <div className="space-y-5 p-5">
                    {/* Category Selection */}
                    <div>
                        <p className="field-label">Item type</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => setCategory('blanks')}
                                aria-pressed={category === 'blanks'}
                                className="chip h-auto justify-start rounded-xl py-3 text-left"
                            >
                                <span>
                                    <span className="block font-semibold">Blank Shirt</span>
                                    <span className="mt-1 block text-xs text-ink-2">Fixed Cost: <span className="num">₱70</span></span>
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setCategory('accessories')}
                                aria-pressed={category === 'accessories'}
                                className="chip h-auto justify-start rounded-xl py-3 text-left"
                            >
                                <span className="block font-semibold">Accessory / Other</span>
                            </button>
                        </div>
                    </div>

                    {/* Specific Fields */}
                    {category === 'blanks' ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <label htmlFor="stock-brand" className="field-label">Brand</label>
                                <select
                                    id="stock-brand"
                                    value={brand}
                                    onChange={(e) => setBrand(e.target.value)}
                                    className="field"
                                >
                                    {brands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="stock-size" className="field-label">Size</label>
                                <select
                                    id="stock-size"
                                    value={size}
                                    onChange={(e) => setSize(e.target.value)}
                                    className="field"
                                >
                                    {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="stock-color" className="field-label">Color</label>
                                <select
                                    id="stock-color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="field"
                                >
                                    {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <label htmlFor="stock-item-name" className="field-label">Item Name</label>
                            <input
                                id="stock-item-name"
                                type="text"
                                value={subCategory}
                                onChange={(e) => setSubCategory(e.target.value)}
                                placeholder="e.g. Stickers, Packaging"
                                className="field"
                                required
                            />
                        </div>
                    )}

                    {/* Common Fields */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="stock-quantity" className="field-label">Quantity</label>
                            <input
                                id="stock-quantity"
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                min="1"
                                className="field num"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="stock-total-cost" className="field-label">Total Cost (₱)</label>
                            <div className="relative">
                                <input
                                    id="stock-total-cost"
                                    type="number"
                                    value={cost}
                                    onChange={(e) => setCost(e.target.value)}
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                    readOnly={category === 'blanks'}
                                    className={`field num pr-28 ${category === 'blanks' ? 'cursor-not-allowed bg-well text-ink-2' : ''}`}
                                />
                                {category === 'blanks' && (
                                    <span className="badge absolute right-2 top-1/2 -translate-y-1/2 border-line text-ink-2">
                                        Auto (70/unit)
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="stock-description" className="field-label">Description / Note</label>
                        <input
                            id="stock-description"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional note..."
                            className="field"
                        />
                    </div>
                    </div>
                </fieldset>

                <div className="shrink-0 border-t border-line bg-surface px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button
                        type="submit"
                        disabled={readOnly || loading}
                        title={readOnly ? READ_ONLY_HINT : undefined}
                        className="btn-primary w-full"
                    >
                        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
                        {loading ? 'Saving...' : 'Add to Inventory'}
                    </button>
                </div>
            </form>
        </div>
    );
}
