import * as XLSX from 'xlsx';
import { Package, Download, Search, Plus, X } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

const InventoryList = ({ transactions, onAddTransaction, onDeleteTransaction, onOpenAddStock }) => {
    const [searchTerm, setSearchTerm] = useState('');

    // Calculate inventory
    const inventory = {};

    transactions.forEach(t => {
        if (!t.details || (!t.details.size && !t.details.subCategory)) return;

        // Key based on what it is
        let key, name, variant;
        if (t.category === 'blanks') {
            const { size, color } = t.details;
            // Normalize color casing to merge "White" and "white"
            const safeColor = (color || 'Unknown').trim();
            key = `shirt-${size}-${safeColor.toLowerCase()}`;

            // Present nicely formatted color (Title Case) if needed, or just use the first one found
            name = `${safeColor} Shirt`;
            variant = size;
        } else {
            // Accessories or others
            const sub = t.details.subCategory || t.category;
            key = `misc-${sub}`;
            name = sub;
            variant = 'N/A';
        }

        if (!inventory[key]) {
            inventory[key] = {
                id: key,
                name,
                variant,
                count: 0
            };
        }

        const quantity = t.details.quantity || 1;

        if (t.type === 'expense' || t.type === 'update_stock') {
            inventory[key].count += quantity;
        } else if (t.type === 'sale') {
            inventory[key].count -= quantity;
        }
    });

    // Convert to array and filter
    const inventoryList = Object.values(inventory)
        .filter(item =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.variant.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name));

    const exportToExcel = () => {
        const data = inventoryList.map(item => ({
            Item: item.name,
            Variant: item.variant,
            Quantity: item.count
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Inventory");
        XLSX.writeFile(wb, "inventory_status.xlsx");
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
                        onClick={onOpenAddStock}
                        className="btn-primary py-2 px-4 text-sm whitespace-nowrap flex items-center gap-2"
                    >
                        <Plus size={16} /> Add Stock
                    </button>

                    <button
                        onClick={exportToExcel}
                        className="btn-secondary py-2 px-4 text-sm whitespace-nowrap"
                    >
                        <Download size={16} /> Export
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
                                    <div className="text-sm text-slate-500">Var: {item.variant}</div>
                                </div>
                                <div className={clsx(
                                    "text-2xl font-bold",
                                    item.count > 0 ? "text-white" : "text-red-400"
                                )}>
                                    {item.count}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDeleteItem(item, transactions)}
                                className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-500/80 rounded-lg text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
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

    function handleDeleteItem(item, allTransactions) {
        if (!confirm(`Are you sure you want to delete "${item.name}" (${item.variant})?\n\nThis will permanently delete ALL ${item.count} history records for this item type.`)) {
            return;
        }

        // Identify transactions to delete
        const toDeleteIds = [];
        allTransactions.forEach(t => {
            if (!t.details) return;

            // Reconstruct key to match item.id
            let key;
            if (t.category === 'blanks') {
                const { size, color } = t.details;
                const safeColor = (color || 'Unknown').trim();
                key = `shirt-${size}-${safeColor.toLowerCase()}`;
            } else {
                const sub = t.details.subCategory || t.category;
                key = `misc-${sub}`;
            }

            if (key === item.id) {
                toDeleteIds.push(t.id);
            }
        });

        if (toDeleteIds.length === 0) return;

        // Execute deletions
        // Ensure onAddTransaction handles '_delete' or properly pass a delete function.
        // Since we only have onAddTransaction prop in this file's signature currently,
        // we'll assume the parent will pass a specific delete handler or we signal it.
        // Actually, best to pass `onDeleteTransaction` prop.
        if (onDeleteTransaction) {
            toDeleteIds.forEach(id => onDeleteTransaction(id));
        } else {
            console.error("Delete function not provided to InventoryList");
        }
    }
};

export default InventoryList;
