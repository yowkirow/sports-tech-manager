import React, { useState, useEffect } from 'react';
import { api } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { Tag, Plus, X, Save, Loader2 } from 'lucide-react';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

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
    const readOnly = useReadOnly();
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
        <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="expense-categories-title">
            <div className="flex items-start gap-3 border-b border-line pb-4">
                <Tag size={22} aria-hidden="true" className="mt-0.5 text-ink-3" />
                <div>
                    <h3 id="expense-categories-title" className="section-title">Expense Categories</h3>
                    <p className="mt-1 text-xs text-ink-2">Manage order and general expense categories</p>
                </div>
            </div>

            {loadError && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                Could not load expense categories: {loadError}
                <button type="button" onClick={() => setAttempt(value => value + 1)} className="btn-secondary ml-3 min-h-10 px-4 py-2">Retry</button>
            </p>}
            <div className="space-y-4">
                <div>
                    <label htmlFor="new-expense-category" className="field-label">Add new category...</label>
                    <div className="flex gap-2">
                        <input
                            id="new-expense-category"
                            type="text"
                            value={newCategory}
                            onChange={(e) => setNewCategory(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                            placeholder="Add new category..."
                            disabled={readOnly}
                            className="field flex-1"
                        />
                        <button
                            type="button"
                            onClick={handleAddCategory}
                            disabled={readOnly}
                            title={readOnly ? READ_ONLY_HINT : undefined}
                            className="btn-secondary min-h-11 px-4"
                            aria-label="Add category"
                        >
                            <Plus size={20} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto rounded-xl border border-line bg-raised p-3">
                    {categories.map((cat) => (
                        <span key={cat} className="badge group border-slate-600 text-ink">
                            {cat}
                            <button
                                type="button"
                                onClick={() => handleRemoveCategory(cat)}
                                disabled={readOnly}
                                title={readOnly ? READ_ONLY_HINT : undefined}
                                className="ml-1 rounded-full p-1 text-ink-2 hover:bg-red-500/10 hover:text-red-300"
                                aria-label={`Remove ${cat}`}
                            >
                                <X size={12} aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                    {categories.length === 0 && (
                        <p className="w-full py-4 text-center text-sm text-ink-2">No categories added</p>
                    )}
                </div>

                <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={readOnly || loading || !loaded}
                        title={readOnly ? READ_ONLY_HINT : undefined}
                        className="btn-primary flex-1"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                        {loading ? 'Saving...' : 'Save Categories'}
                    </button>
                    <button
                        type="button"
                        onClick={handleReset}
                        disabled={readOnly || loading || !loaded}
                        title={readOnly ? READ_ONLY_HINT : undefined}
                        className="btn-danger"
                    >
                        Reset Defaults
                    </button>
                </div>
            </div>
        </section>
    );
}
