import React, { useState } from 'react';
import { Palette, Plus, Trash2, Check, X, Loader2 } from 'lucide-react';
import { useColors } from '../../hooks/useInventory';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ui/Toast';
import { useActivityLog } from '../../hooks/useActivityLog';

export default function ColorSettings({ transactions, onAddTransaction }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const colors = useColors(transactions);

    const [isAdding, setIsAdding] = useState(false);
    const [loading, setLoading] = useState(false);
    const [newName, setNewName] = useState('');
    const [newHex, setNewHex] = useState('#334155');

    const handleAddColor = async () => {
        if (!newName.trim()) return;
        setLoading(true);
        try {
            const transactionData = {
                id: crypto.randomUUID(),
                type: 'define_color',
                category: 'system',
                amount: 0,
                date: new Date().toISOString(),
                description: `Defined Color: ${newName}`,
                details: {
                    name: newName.trim(),
                    hex: newHex
                }
            };

            await onAddTransaction(transactionData);
            await logActivity('Add Color', { name: newName, hex: newHex }, transactionData.id);

            showToast('Color added!', 'success');
            setNewName('');
            setNewHex('#334155');
            setIsAdding(false);
        } catch (err) {
            console.error(err);
            showToast('Failed to add color', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteColor = async (color) => {
        if (!window.confirm(`Delete color "${color.name}"? This will affect POS display and inventory tracking.`)) return;

        setLoading(true);
        try {
            const transactionData = {
                id: crypto.randomUUID(),
                type: 'delete_color',
                category: 'system',
                amount: 0,
                date: new Date().toISOString(),
                description: `Deleted Color: ${color.name}`,
                details: {
                    name: color.name
                }
            };

            await onAddTransaction(transactionData);
            await logActivity('Delete Color', { name: color.name }, transactionData.id);
            showToast('Color removed', 'info');
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
                        <Palette className="text-primary" size={20} />
                        Shirt Color Management
                    </h3>
                    <p className="text-xs text-slate-500">Manage colors available across the system</p>
                </div>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold flex items-center gap-2 border border-white/5"
                    >
                        <Plus size={16} /> Add Color
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
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Color Name</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g., Lavender"
                                className="glass-input"
                            />
                        </div>
                        <div className="space-y-2 shrink-0">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Marker Color</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={newHex}
                                    onChange={(e) => setNewHex(e.target.value)}
                                    className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={newHex}
                                    onChange={(e) => setNewHex(e.target.value)}
                                    className="glass-input w-24 text-xs font-mono uppercase"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={handleAddColor}
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
                {colors.map((color) => (
                    <motion.div
                        layout
                        key={color.name}
                        className="group relative p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-white/20 transition-all flex items-center gap-3"
                    >
                        <div
                            className="w-10 h-10 rounded-full border border-white/10 shadow-inner"
                            style={{ backgroundColor: color.hex }}
                        />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-white truncate">{color.name}</p>
                            <p className="text-[10px] text-slate-500 font-mono uppercase">{color.hex}</p>
                        </div>

                        <button
                            onClick={() => handleDeleteColor(color)}
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
