import { Package, Download, Search, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useToast } from './ui/Toast';
import { getInventoryRows } from '../lib/inventory.js';

const InventoryList = ({ transactions, onAddTransaction, onDeleteTransaction, onOpenAddStock }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [exporting, setExporting] = useState(false);
    const { showToast } = useToast();

    // Calculate inventory
    const inventoryItems = useMemo(() => getInventoryRows(transactions), [transactions]);

    // Convert to array and filter
    const inventoryList = inventoryItems
        .filter(item =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.variant.toLowerCase().includes(searchTerm.toLowerCase())
        );

    const totalUnits = inventoryList.reduce((sum, item) => sum + (item.count || 0), 0);
    const outOfStock = inventoryList.filter(item => item.count <= 0).length;

    const exportToExcel = async () => {
        setExporting(true);
        try {
            const { exportInventory } = await import('../lib/exportInventory');
            exportInventory(inventoryList);
        } catch (err) {
            console.error('Failed to export inventory:', err);
            showToast('Inventory export failed. Please try again.', 'error');
        } finally {
            setExporting(false);
        }
    };

    const handleDeleteItem = async (item) => {
        if (!item.canDeleteHistory) {
            showToast('This item comes from a multi-SKU order. Edit or delete the original order from Orders instead.', 'error');
            return;
        }

        if (!window.confirm(`Are you sure you want to delete "${item.name}" (${item.variant})?\n\nThis will permanently delete ${item.transactionIds.length} source record(s) for this inventory item.`)) {
            return;
        }

        if (!onDeleteTransaction || item.transactionIds.length === 0) return;

        try {
            await Promise.all(item.transactionIds.map(id => onDeleteTransaction(id)));
            showToast(`Deleted history for ${item.name}.`, 'success');
        } catch (error) {
            console.error('Failed to delete inventory history:', error);
            showToast('Failed to delete inventory history. Please try again.', 'error');
        }
    };

    return (
        <div className="space-y-5">
            <div className="surface grid grid-cols-1 divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Visible SKUs</p>
                    <p className="display mt-2 text-3xl num">{inventoryList.length}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Total units</p>
                    <p className="display mt-2 text-3xl num">{totalUnits}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Out of stock</p>
                    <p className={clsx("display mt-2 text-3xl num", outOfStock > 0 ? "text-red-400" : "text-ink")}>{outOfStock}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Source records</p>
                    <p className="display mt-2 text-3xl num">{inventoryList.reduce((sum, item) => sum + item.transactionIds.length, 0)}</p>
                </div>
            </div>

            <section className="surface overflow-hidden">
                <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="flex items-center gap-3">
                        <Package size={22} className="text-ink-3" aria-hidden="true" />
                        <h2 className="section-title">Inventory Status</h2>
                    </div>

                    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                        <div className="relative min-w-0 sm:w-56">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                            <input
                                type="text"
                                aria-label="Search inventory"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="field pl-9 text-sm"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    console.log('Add Stock Clicked');
                                    onOpenAddStock();
                                }}
                                className="btn-primary whitespace-nowrap"
                            >
                                <Plus size={16} aria-hidden="true" /> Add Stock
                            </button>

                            <button
                                type="button"
                                onClick={exportToExcel}
                                disabled={exporting}
                                className="btn-secondary whitespace-nowrap"
                            >
                                <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export'}
                            </button>
                        </div>
                    </div>
                </div>

                {inventoryList.length === 0 ? (
                    <div className="m-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 py-16 text-center text-ink-2 sm:m-5">
                        <Package size={32} className="mb-3 text-ink-3" aria-hidden="true" />
                        <p>No inventory data found.</p>
                    </div>
                ) : (
                    <>
                        <div className="divide-y divide-line sm:hidden">
                            {inventoryList.map((item) => (
                                <div key={item.id} className="p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-semibold text-ink">{item.name}</p>
                                            <p className="mt-1 text-sm text-ink-2">Var: {item.variant}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={clsx("display text-3xl num", item.count > 0 ? "text-ink" : "text-red-400")}>{item.count}</p>
                                            <span className={clsx("badge mt-1", item.count > 0 ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300")}>
                                                {item.count > 0 ? 'In stock' : 'Out of stock'}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteItem(item)}
                                            className="icon-btn -mr-2 -mt-1"
                                            title="Delete all history for this item"
                                            aria-label={`Delete all history for ${item.name} ${item.variant}`}
                                        >
                                            <X size={18} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden overflow-x-auto sm:block">
                            <table className="w-full min-w-[680px] text-sm">
                                <thead>
                                    <tr className="border-b border-line text-left text-ink-2">
                                        <th className="px-3 py-3 font-medium">Item</th>
                                        <th className="px-3 py-3 font-medium">Variant</th>
                                        <th className="px-3 py-3 text-right font-medium">Count</th>
                                        <th className="px-3 py-3 text-center font-medium">Status</th>
                                        <th className="px-3 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {inventoryList.map((item) => (
                                        <tr key={item.id} className="border-b border-line transition-colors last:border-0 hover:bg-white/[0.04]">
                                            <td className="px-3 py-3 font-medium text-ink">{item.name}</td>
                                            <td className="px-3 py-3 text-ink-2">{item.variant}</td>
                                            <td className={clsx("px-3 py-3 text-right font-semibold num", item.count > 0 ? "text-ink" : "text-red-400")}>{item.count}</td>
                                            <td className="px-3 py-3 text-center">
                                                <span className={clsx("badge", item.count > 0 ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300")}>
                                                    {item.count > 0 ? 'In stock' : 'Out of stock'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteItem(item)}
                                                    className="icon-btn ml-auto"
                                                    title="Delete all history for this item"
                                                    aria-label={`Delete all history for ${item.name} ${item.variant}`}
                                                >
                                                    <X size={18} aria-hidden="true" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default InventoryList;
