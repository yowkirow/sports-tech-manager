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
        <div className="glass-panel rounded-2xl p-6 relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/20 rounded-lg text-primary">
                        <Package size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-white">Inventory Status</h2>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="glass-input pl-9 py-2 text-sm w-full sm:w-48"
                        />
                    </div>

                    <button
                        onClick={() => {
                            console.log('Add Stock Clicked');
                            onOpenAddStock();
                        }}
                        className="btn-primary py-2 px-4 text-sm whitespace-nowrap flex items-center gap-2"
                    >
                        <Plus size={16} /> Add Stock
                    </button>

                    <button
                        onClick={exportToExcel}
                        disabled={exporting}
                        className="btn-secondary py-2 px-4 text-sm whitespace-nowrap"
                    >
                        <Download size={16} /> {exporting ? 'Exporting...' : 'Export'}
                    </button>
                </div>
            </div>

            {inventoryList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 border border-dashed border-white/10 rounded-xl">
                    <Package size={48} className="mb-4 opacity-50" />
                    <p>No inventory data found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {inventoryList.map((item) => (
                        <div key={item.id} className="relative group">
                            <div
                                className={clsx(
                                    "flex items-center justify-between p-4 rounded-xl border transition-all",
                                    item.count > 0
                                        ? "bg-white/5 border-white/5 hover:border-white/10"
                                        : "bg-red-500/10 border-red-500/20"
                                )}
                            >
                                <div className="min-w-0 pr-6">
                                    <div className="font-semibold text-slate-200 truncate">{item.name}</div>
                                    <div className={clsx(
                                        "text-sm",
                                        item.count > 0 ? "text-slate-500" : "text-red-100/80"
                                    )}>
                                        Var: {item.variant}
                                    </div>
                                </div>
                                <div className={clsx(
                                    "text-2xl font-bold",
                                    item.count > 0 ? "text-white" : "text-red-400"
                                )}>
                                    {item.count}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDeleteItem(item)}
                                className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-500/80 rounded-lg text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                                title="Delete all history for this item"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default InventoryList;
