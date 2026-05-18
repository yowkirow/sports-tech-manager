import React, { useState, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2, X, Save } from 'lucide-react';
import clsx from 'clsx';
import { useActivityLog } from '../../hooks/useActivityLog';
import { supabase } from '../../lib/supabaseClient';

const DEFAULT_CATEGORIES = [
    'Rent',
    'Utilities',
    'Marketing/Ads',
    'Packaging',
    'Software/Subscriptions',
    'Transportation',
    'Other'
];

const CLUB_SLUG = 'downtown-dinks';

export default function AddExpenseForm({ onAddTransaction, onUpdateTransaction, onClose, initialData = null }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const [loading, setLoading] = useState(false);
    const [expenseCategories, setExpenseCategories] = useState(DEFAULT_CATEGORIES);

    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
    const [owner, setOwner] = useState('business');
    const [customCategory, setCustomCategory] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [reimbursementStatus, setReimbursementStatus] = useState('none');
    const [reimbursedAmount, setReimbursedAmount] = useState('');

    useEffect(() => {
        const fetchMeta = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.user_metadata?.expense_categories) {
                setExpenseCategories(user.user_metadata.expense_categories);
                if (!initialData) setCategory(user.user_metadata.expense_categories[0]);
            }
        };
        fetchMeta();
    }, [initialData]);

    useEffect(() => {
        if (initialData) {
            setDescription(initialData.description || '');
            setAmount(initialData.amount || '');
            setOwner(initialData.details?.club === CLUB_SLUG ? CLUB_SLUG : 'business');

            const isCustom = !expenseCategories.includes(initialData.category) && initialData.category !== 'general';
            // Actually, existing categories in DB might be 'general' with subCategory
            const cat = initialData.category;
            const subCat = initialData.details?.subCategory;

            if (expenseCategories.includes(subCat)) {
                setCategory(subCat);
            } else if (subCat) {
                setCategory('Other');
                setCustomCategory(subCat);
            } else {
                // Fallback
                if (expenseCategories.includes(cat)) setCategory(cat);
                else {
                    setCategory('Other');
                    setCustomCategory(cat);
                }
            }

            if (initialData.date) {
                const d = new Date(initialData.date);
                setDate(d.toISOString().split('T')[0]);
            }

            const rAmt = initialData.details?.reimbursedAmount;
            const rStatusBool = initialData.details?.reimbursed;
            
            if (rAmt !== undefined) {
                if (rAmt === 0) {
                    setReimbursementStatus('none');
                    setReimbursedAmount('');
                } else if (rAmt >= (initialData.amount || 0)) {
                    setReimbursementStatus('full');
                    setReimbursedAmount(rAmt.toString());
                } else {
                    setReimbursementStatus('partial');
                    setReimbursedAmount(rAmt.toString());
                }
            } else if (rStatusBool) {
                setReimbursementStatus('full');
                setReimbursedAmount(initialData.amount ? initialData.amount.toString() : '');
            } else {
                setReimbursementStatus('none');
                setReimbursedAmount('');
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

            const { data: { user } } = await supabase.auth.getUser();

            let finalReimbursedAmount = 0;
            if (reimbursementStatus === 'full') {
                finalReimbursedAmount = parseFloat(amount) || 0;
            } else if (reimbursementStatus === 'partial') {
                finalReimbursedAmount = parseFloat(reimbursedAmount) || 0;
            }
            const isReimbursedBool = finalReimbursedAmount > 0;

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
                        club: owner === CLUB_SLUG ? CLUB_SLUG : null,
                        reimbursed: isReimbursedBool,
                        reimbursedAmount: finalReimbursedAmount,
                        updatedBy: user?.email || 'Unknown',
                        updatedAt: new Date().toISOString()
                    }
                };

                await onUpdateTransaction(initialData.id, updates);
                await logActivity('Update Expense', { amount: updates.amount, description: updates.description }, initialData.id);
                showToast('Expense updated', 'success');
            } else {
                // Create
                const isAdSpend = finalCategory === 'Marketing/Ads';

                const newTransaction = {
                    id: crypto.randomUUID(),
                    type: 'expense',
                    amount: parseFloat(amount),
                    description: description || `Expense: ${finalCategory}`,
                    category: isAdSpend ? 'ads' : 'general',
                    date: newDate.toISOString(),
                    details: {
                        subCategory: finalCategory,
                        isGeneral: true,
                        club: owner === CLUB_SLUG ? CLUB_SLUG : null,
                        reimbursed: isReimbursedBool,
                        reimbursedAmount: finalReimbursedAmount,
                        platform: isAdSpend ? customCategory : undefined, // Reuse customCategory for ad platform
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
                        <label className="text-sm text-slate-400">Assign To</label>
                        <select
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                            className="glass-input appearance-none"
                        >
                            <option value="business" className="bg-slate-900">SportsTech</option>
                            <option value={CLUB_SLUG} className="bg-slate-900">Downtown Dinks</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Category</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="glass-input appearance-none"
                        >
                            {expenseCategories.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                        </select>
                    </div>

                    {(category === 'Other' || category === 'Marketing/Ads') && (
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">
                                {category === 'Marketing/Ads' ? 'Ad Platform' : 'Specify Category'}
                            </label>
                            <input
                                type="text"
                                value={customCategory}
                                onChange={(e) => setCustomCategory(e.target.value)}
                                className="glass-input"
                                placeholder={category === 'Marketing/Ads' ? 'e.g. Facebook, TikTok' : 'e.g. Office Supplies'}
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

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="glass-input appearance-none w-full"
                            required
                        />
                    </div>

                    <div className="space-y-4 p-4 bg-white/5 rounded-xl border border-white/5">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Reimbursement Status</label>
                            <select
                                value={reimbursementStatus}
                                onChange={(e) => setReimbursementStatus(e.target.value)}
                                className="glass-input appearance-none"
                            >
                                <option value="none" className="bg-slate-900">Not Reimbursed</option>
                                <option value="partial" className="bg-slate-900">Partially Reimbursed</option>
                                <option value="full" className="bg-slate-900">Fully Reimbursed</option>
                            </select>
                        </div>
                        {reimbursementStatus === 'partial' && (
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Reimbursed Amount (₱)</label>
                                <input
                                    type="number"
                                    value={reimbursedAmount}
                                    onChange={(e) => setReimbursedAmount(e.target.value)}
                                    className="glass-input"
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                    required
                                />
                            </div>
                        )}
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
