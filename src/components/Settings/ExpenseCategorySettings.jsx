import React, { useState, useEffect } from 'react';
import { api } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { Tag, Plus, X, Save, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_CATEGORIES = [
    'Rent',
    'Utilities',
    'Marketing/Ads',
    'Packaging',
    'Software/Subscriptions',
    'Transportation',
    'Other'
];

export default function ExpenseCategorySettings() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [newCategory, setNewCategory] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        setLoaded(false);
        setLoadError(null);
        const fetchCategories = async () => {
            const { profile } = await api.getProfile();
            const savedCategories = profile?.expense_categories || DEFAULT_CATEGORIES;
            if (active) {
                setCategories(savedCategories);
                setLoaded(true);
            }
        };
        fetchCategories().catch(error => {
            if (active) setLoadError(error.message);
        });
        return () => { active = false; };
    }, [attempt]);

    const handleAddCategory = () => {
        const trimmed = newCategory.trim();
        if (!trimmed) return;
        if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
            return showToast('Category already exists', 'error');
        }
        setCategories([...categories, trimmed]);
        setNewCategory('');
    };

    const handleRemoveCategory = (cat) => {
        setCategories(categories.filter(c => c !== cat));
    };

    const handleSave = async () => {
        if (!loaded) return;
        setLoading(true);
        try {
            await api.updateProfile({ expense_categories: categories });
            showToast('Expense categories updated!', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to save categories', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        if (confirm('Reset to default categories?')) {
            setCategories(DEFAULT_CATEGORIES);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card space-y-6"
        >
            <div className="flex justify-between items-center border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                        <Tag size={24} />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-white">Expense Categories</h3>
                        <p className="text-xs text-slate-400">Manage order and general expense categories</p>
                    </div>
                </div>
            </div>

            {loadError && <p role="alert" className="text-sm text-red-300">
                Could not load expense categories: {loadError}
                <button type="button" onClick={() => setAttempt(value => value + 1)} className="btn-secondary ml-3">Retry</button>
            </p>}
            <div className="space-y-4">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                        placeholder="Add new category..."
                        className="glass-input flex-1"
                    />
                    <button
                        onClick={handleAddCategory}
                        className="p-2 bg-primary/20 text-primary hover:bg-primary hover:text-white rounded-xl transition-all"
                    >
                        <Plus size={20} />
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto p-2 rounded-xl bg-black/20 border border-white/5 custom-scrollbar">
                    <AnimatePresence>
                        {categories.map((cat) => (
                            <motion.span
                                key={cat}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                className="group flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/5 text-sm transition-all"
                            >
                                {cat}
                                <button
                                    onClick={() => handleRemoveCategory(cat)}
                                    className="p-0.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </motion.span>
                        ))}
                    </AnimatePresence>
                    {categories.length === 0 && (
                        <p className="text-sm text-slate-500 italic w-full text-center py-4">No categories added</p>
                    )}
                </div>

                <div className="flex gap-3 pt-4 border-t border-white/5">
                    <button
                        onClick={handleSave}
                        disabled={loading || !loaded}
                        className="btn-primary flex-1 py-1.5 h-10 shadow-lg shadow-indigo-500/20"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                        {loading ? 'Saving...' : 'Save Categories'}
                    </button>
                    <button
                        onClick={handleReset}
                        disabled={loading || !loaded}
                        className="px-4 py-1.5 h-10 bg-white/5 hover:bg-white/10 text-slate-400 rounded-xl transition-all border border-white/5 text-sm font-medium"
                    >
                        Reset Defaults
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
