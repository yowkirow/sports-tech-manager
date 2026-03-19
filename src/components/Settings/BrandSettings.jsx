import React, { useState } from 'react';
import { Tag, Plus, Trash2, Check, X, Loader2 } from 'lucide-react';
import { useBrands } from '../../hooks/useInventory';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ui/Toast';
import { useActivityLog } from '../../hooks/useActivityLog';

export default function BrandSettings({ transactions, onAddTransaction }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const brands = useBrands(transactions);

    const [isAdding, setIsAdding] = useState(false);
    const [loading, setLoading] = useState(false);
    const [newName, setNewName] = useState('');

    const handleAddBrand = async () => {
        if (!newName.trim()) return;
        setLoading(true);
        try {
            const transactionData = {
                id: crypto.randomUUID(),
                type: 'define_brand',
                category: 'system',
                amount: 0,
                date: new Date().toISOString(),
                description: `Defined Brand: ${newName}`,
                details: {
                    name: newName.trim(),
                }
            };

            await onAddTransaction(transactionData);
            await logActivity('Add Brand', { name: newName }, transactionData.id);

            showToast('Brand added!', 'success');
            setNewName('');
            setIsAdding(false);
        } catch (err) {
            console.error(err);
            showToast('Failed to add brand', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteBrand = async (brand) => {
        if (!window.confirm(`Delete brand "${brand.name}"? This will affect product assignment and inventory tracking.`)) return;

        setLoading(true);
        try {
            const transactionData = {
                id: crypto.randomUUID(),
                type: 'delete_brand',
                category: 'system',
                amount: 0,
                date: new Date().toISOString(),
                description: `Deleted Brand: ${brand.name}`,
                details: {
                    name: brand.name
                }
            };

            await onAddTransaction(transactionData);
            await logActivity('Delete Brand', { name: brand.name }, transactionData.id);
            showToast('Brand removed', 'info');
        } catch (err) {
            console.error(err);
            showToast('Failed to delete', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Tag className="text-primary" size={20} />
                        Shirt Brand Management
                    </h3>
                    <p className="text-xs text-slate-500">Manage brands available for your products</p>
                </div>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold flex items-center gap-2 border border-white/5"
                    >
                        <Plus size={16} /> Add Brand
                    </button>
                )}
            </div>

            <AnimatePresence>
                {isAdding && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col md:flex-row items-end gap-4"
                    >
                        <div className="flex-1 space-y-2 w-full">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Brand Name</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g., Gildan"
                                className="glass-input"
                            />
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={handleAddBrand}
                                disabled={loading || !newName}
                                className="p-3 bg-primary text-white rounded-xl hover:bg-primary/80 disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} />}
                            </button>
                            <button
                                onClick={() => { setIsAdding(false); setNewName(''); }}
                                className="p-3 bg-white/5 text-slate-400 rounded-xl hover:bg-white/10"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {brands.map((brand) => (
                    <motion.div
                        layout
                        key={brand.name}
                        className="group relative p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-white/20 transition-all flex items-center gap-3"
                    >
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-inner">
                            <Tag className="text-primary" size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-white truncate">{brand.name}</p>
                        </div>

                        <button
                            onClick={() => handleDeleteBrand(brand)}
                            className="p-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Trash2 size={16} />
                        </button>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
