import React, { useState } from 'react';
import { Tag, Plus, Trash2, Check, X, Loader2 } from 'lucide-react';
import { useBrands } from '../../hooks/useInventory';
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
        <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="brand-settings-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 id="brand-settings-title" className="section-title flex items-center gap-2">
                        <Tag className="text-ink-3" size={20} aria-hidden="true" />
                        Shirt Brand Management
                    </h3>
                    <p className="mt-1 text-xs text-ink-2">Manage brands available for your products</p>
                </div>
                {!isAdding && (
                    <button type="button" onClick={() => setIsAdding(true)} className="btn-secondary">
                        <Plus size={16} aria-hidden="true" /> Add Brand
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="flex flex-col gap-4 rounded-xl border border-line bg-raised p-4 md:flex-row md:items-end">
                    <div className="w-full flex-1">
                        <label htmlFor="brand-name" className="field-label">Brand Name</label>
                        <input
                            id="brand-name"
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="e.g., Gildan"
                            className="field"
                        />
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <button
                            type="button"
                            onClick={handleAddBrand}
                            disabled={loading || !newName}
                            className="btn-primary min-h-11 px-4"
                            aria-label="Save brand"
                        >
                            {loading ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setIsAdding(false); setNewName(''); }}
                            className="btn-secondary min-h-11 px-4"
                            aria-label="Cancel brand"
                        >
                            <X size={20} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {brands.map((brand) => (
                    <div key={brand.name} className="group flex items-center gap-3 rounded-xl border border-line bg-raised p-4 transition-colors hover:border-slate-600">
                        <Tag className="shrink-0 text-ink-3" size={20} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-ink">{brand.name}</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleDeleteBrand(brand)}
                            className="btn-danger min-h-10 px-3 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus:opacity-100"
                            aria-label={`Delete ${brand.name}`}
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
}
