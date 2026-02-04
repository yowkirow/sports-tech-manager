import React, { useState, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2, X, Save } from 'lucide-react';
import { useActivityLog } from '../../hooks/useActivityLog';
import { supabase } from '../../lib/supabaseClient';

const EXPENSE_CATEGORIES = [
    'Rent',
    'Utilities',
    'Marketing/Ads',
    'Packaging',
    'Software/Subscriptions',
    'Transportation',
    'Other'
];

export default function AddExpenseForm({ onAddTransaction, onUpdateTransaction, onClose, initialData = null }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const [loading, setLoading] = useState(false);

    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState('Rent');
    const [customCategory, setCustomCategory] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(() => {
        if (initialData) {
            setDescription(initialData.description || '');
            setAmount(initialData.amount || '');

            const isCustom = !EXPENSE_CATEGORIES.includes(initialData.category) && initialData.category !== 'general';
            // Actually, existing categories in DB might be 'general' with subCategory
            const cat = initialData.category;
            const subCat = initialData.details?.subCategory;

            if (EXPENSE_CATEGORIES.includes(subCat)) {
                setCategory(subCat);
            } else if (subCat) {
                setCategory('Other');
                setCustomCategory(subCat);
            } else {
                // Fallback
                if (EXPENSE_CATEGORIES.includes(cat)) setCategory(cat);
                else {
                    setCategory('Other');
                    setCustomCategory(cat);
                }
            }

            if (initialData.date) {
                const d = new Date(initialData.date);
                setDate(d.toISOString().split('T')[0]);
            }
        }
    }, [initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const finalCategory = category === 'Other' ? customCategory : category;

            // Combine selected date with current time (Robust Method)
            const [y, m, d] = date.split('-').map(Number);
            const newDate = new Date(); // Current time capture
            newDate.setFullYear(y);
            newDate.setMonth(m - 1);
            newDate.setDate(d);

            // Check if user is logged in
            const { data: { user } } = await supabase.auth.getUser();

            if (initialData) {
                // Update
                const updates = {
                    amount: parseFloat(amount),
                    description: description || `Expense: ${finalCategory}`,
                    category: 'general', // Schema uses general? Or the actual category? Existing code uses 'general' and details.subCategory
                    date: newDate.toISOString(),
                    details: {
                        ...initialData.details,
                        subCategory: finalCategory,
                        updatedBy: user?.email || 'Unknown',
                        updatedAt: new Date().toISOString()
                    }
                };

                await onUpdateTransaction(initialData.id, updates);
                await logActivity('Update Expense', { amount: updates.amount, description: updates.description }, initialData.id);
                showToast('Expense updated', 'success');
            } else {
                // Create
                const newTransaction = {
                    id: crypto.randomUUID(),
                    type: 'expense',
                    amount: parseFloat(amount),
                    description: description || `Expense: ${finalCategory}`,
                    category: 'general',
                    date: newDate.toISOString(),
                    details: {
                        subCategory: finalCategory,
                        isGeneral: true,
                        createdBy: user?.email || 'Unknown'
                    }
                };

                await onAddTransaction(newTransaction);
                await logActivity('Add Expense', {
                    amount: newTransaction.amount,
                    category: finalCategory,
                    description: newTransaction.description
                }, newTransaction.id);
                showToast('Expense recorded', 'success');
            }

            onClose();

        } catch (error) {
            console.error(error);
            showToast(initialData ? 'Failed to update expense' : 'Failed to add expense', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full mx-auto shadow-2xl relative flex flex-col">
            <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                <h2 className="text-xl font-bold text-white">{initialData ? 'Edit Expense' : 'Record Expense'}</h2>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white transition-colors bg-white/5 p-2 rounded-lg hover:bg-white/10"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Category</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="glass-input appearance-none"
                        >
                            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                        </select>
                    </div>

                    {category === 'Other' && (
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Specify Category</label>
                            <input
                                type="text"
                                value={customCategory}
                                onChange={(e) => setCustomCategory(e.target.value)}
                                className="glass-input"
                                placeholder="e.g. Office Supplies"
                                required
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Amount (₱)</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="glass-input"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Description (Optional)</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="glass-input"
                            placeholder="Details..."
                        />
                    </div>

                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="glass-input appearance-none w-full"
                                required
                            />
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full py-3 shadow-lg shadow-indigo-500/20"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : (initialData ? <Save size={18} /> : <Plus size={18} />)}
                            {loading ? 'Saving...' : (initialData ? 'Update Expense' : 'Record Expense')}
                        </button>
                    </div>

                </form >
            </div >
        </div >
    );
}
