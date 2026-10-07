import React, { useState } from 'react';
import { Palette, Plus, Trash2, Check, X, Loader2 } from 'lucide-react';
import { useColors } from '../../hooks/useInventory';
import { useToast } from '../ui/Toast';
import { useActivityLog } from '../../hooks/useActivityLog';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

export default function ColorSettings({ transactions, onAddTransaction }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const readOnly = useReadOnly();
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
        <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="color-settings-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 id="color-settings-title" className="section-title flex items-center gap-2">
                        <Palette className="text-ink-3" size={20} aria-hidden="true" />
                        Shirt Color Management
                    </h3>
                    <p className="mt-1 text-xs text-ink-2">Manage colors available across the system</p>
                </div>
                {!isAdding && (
                    <button type="button" onClick={() => setIsAdding(true)} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} className="btn-secondary">
                        <Plus size={16} aria-hidden="true" /> Add Color
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="flex flex-col gap-4 rounded-xl border border-line bg-raised p-4 md:flex-row md:items-end">
                    <div className="w-full flex-1">
                        <label htmlFor="color-name" className="field-label">Color Name</label>
                        <input
                            id="color-name"
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="e.g., Lavender"
                            disabled={readOnly}
                            className="field"
                        />
                    </div>
                    <div className="shrink-0">
                        <label htmlFor="marker-color" className="field-label">Marker Color</label>
                        <div className="flex items-center gap-2">
                            <input
                                id="marker-color"
                                type="color"
                                value={newHex}
                                onChange={(e) => setNewHex(e.target.value)}
                                disabled={readOnly}
                                className="h-11 w-12 cursor-pointer rounded-lg border border-line bg-transparent p-1"
                            />
                            <input
                                type="text"
                                value={newHex}
                                onChange={(e) => setNewHex(e.target.value)}
                                aria-label="Marker Color hex"
                                disabled={readOnly}
                                className="field w-28 font-mono text-xs uppercase"
                            />
                        </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <button
                            type="button"
                            onClick={handleAddColor}
                            disabled={readOnly || loading || !newName}
                            title={readOnly ? READ_ONLY_HINT : undefined}
                            className="btn-primary min-h-11 px-4"
                            aria-label="Save color"
                        >
                            {loading ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setIsAdding(false); setNewName(''); }}
                            className="btn-secondary min-h-11 px-4"
                            aria-label="Cancel color"
                        >
                            <X size={20} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {colors.map((color) => (
                    <div key={color.name} className="group flex items-center gap-3 rounded-xl border border-line bg-raised p-4 transition-colors hover:border-slate-600">
                        <div
                            className="size-10 shrink-0 rounded-full border border-line"
                            style={{ backgroundColor: color.hex }}
                        />
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-ink">{color.name}</p>
                            <p className="num text-xs uppercase text-ink-2">{color.hex}</p>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleDeleteColor(color)}
                            disabled={readOnly}
                            title={readOnly ? READ_ONLY_HINT : undefined}
                            className="btn-danger min-h-10 px-3 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus:opacity-100"
                            aria-label={`Delete ${color.name}`}
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>
        </section>
    );
}
