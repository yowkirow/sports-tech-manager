import React, { useState, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { Plus, Loader2, X, Save } from 'lucide-react';
import { useActivityLog } from '../../hooks/useActivityLog';
import { api } from '../../lib/apiClient';
import { withLocalDate } from '../../lib/transactionDate';
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

const CLUB_SLUG = 'downtown-dinks';

export default function AddExpenseForm({ onAddTransaction, onUpdateTransaction, onClose, initialData = null }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const readOnly = useReadOnly();
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
    const isStockExpense = !!initialData && ['blanks', 'shirts', 'dtf', 'accessories', 'balls'].includes(initialData.category);

    useEffect(() => {
        const fetchMeta = async () => {
            const user = await api.getCurrentUser();
            if (user?.user_metadata?.expense_categories) {
                setExpenseCategories(user.user_metadata.expense_categories);
                if (!initialData) setCategory(user.user_metadata.expense_categories[0]);
            }
        };
        fetchMeta().catch(() => showToast('Could not load expense categories. Default categories are available.', 'error'));
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

            const newDate = withLocalDate(date);

            const user = await api.getCurrentUser();

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
                    category: isStockExpense ? initialData.category : (finalCategory === 'Marketing/Ads' ? 'ads' : 'general'),
                    date: newDate.toISOString(),
                    details: {
                        ...initialData.details,
                        subCategory: isStockExpense ? initialData.details?.subCategory : finalCategory,
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
        <div className="mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sheet">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
                <h2 className="display text-2xl">{initialData ? 'Edit Expense' : 'Record Expense'}</h2>
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
                    <div className="space-y-4 p-5">
                    <div>
                        <label htmlFor="expense-owner" className="field-label">Assign To</label>
                        <select
                            id="expense-owner"
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                            className="field"
                        >
                            <option value="business">SportsTech</option>
                            <option value={CLUB_SLUG}>Downtown Dinks</option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="expense-category" className="field-label">Category</label>
                        <select
                            id="expense-category"
                            value={category}
                            disabled={readOnly || isStockExpense}
                            onChange={(e) => setCategory(e.target.value)}
                            className="field"
                        >
                            {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {isStockExpense && <p className="mt-1.5 text-xs text-ink-2">Stock category and item details are preserved. This form edits the expense only.</p>}
                    </div>

                    {(category === 'Other' || category === 'Marketing/Ads') && (
                        <div>
                            <label htmlFor="expense-custom-category" className="field-label">
                                {category === 'Marketing/Ads' ? 'Ad Platform' : 'Specify Category'}
                            </label>
                            <input
                                id="expense-custom-category"
                                type="text"
                                value={customCategory}
                                disabled={readOnly || isStockExpense}
                                onChange={(e) => setCustomCategory(e.target.value)}
                                className="field"
                                placeholder={category === 'Marketing/Ads' ? 'e.g. Facebook, TikTok' : 'e.g. Office Supplies'}
                                required
                            />
                        </div>
                    )}

                    <div>
                        <label htmlFor="expense-amount" className="field-label">Amount (₱)</label>
                        <input
                            id="expense-amount"
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="field num"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="expense-description" className="field-label">Description (Optional)</label>
                        <input
                            id="expense-description"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="field"
                            placeholder="Details..."
                        />
                    </div>

                    <div>
                        <label htmlFor="expense-date" className="field-label">Date</label>
                        <input
                            id="expense-date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="field w-full"
                            required
                        />
                    </div>

                    <div className="space-y-4 rounded-xl border border-line bg-raised p-4">
                        <div>
                            <label htmlFor="expense-reimbursement-status" className="field-label">Reimbursement Status</label>
                            <select
                                id="expense-reimbursement-status"
                                value={reimbursementStatus}
                                onChange={(e) => setReimbursementStatus(e.target.value)}
                                className="field"
                            >
                                <option value="none">Not Reimbursed</option>
                                <option value="partial">Partially Reimbursed</option>
                                <option value="full">Fully Reimbursed</option>
                            </select>
                        </div>
                        {reimbursementStatus === 'partial' && (
                            <div>
                                <label htmlFor="expense-reimbursed-amount" className="field-label">Reimbursed Amount (₱)</label>
                                <input
                                    id="expense-reimbursed-amount"
                                    type="number"
                                    value={reimbursedAmount}
                                    onChange={(e) => setReimbursedAmount(e.target.value)}
                                    className="field num"
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                    required
                                />
                            </div>
                        )}
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
                        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : (initialData ? <Save size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />)}
                        {loading ? 'Saving...' : (initialData ? 'Update Expense' : 'Record Expense')}
                    </button>
                </div>
            </form>
        </div>
    );
}
