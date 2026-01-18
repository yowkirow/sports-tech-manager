import React from 'react';
import { ArrowUpRight, ArrowDownLeft, Trash2, Calendar, ShoppingBag } from 'lucide-react';
import clsx from 'clsx';

const TransactionList = ({ transactions, onDelete }) => {
    // Sort by date desc
    const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const getCategoryLabel = (cat) => {
        switch (cat) {
            case 'blanks': return 'Blank Shirts';
            case 'dtf': return 'DTF Prints';
            case 'accessories': return 'Accessories';
            case 'sale': return 'Sale';
            default: return cat;
        }
    };

    return (
        <div className="glass-panel rounded-2xl p-6">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Calendar className="text-primary" size={24} />
                Recent Activity
            </h2>

            {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                    <ShoppingBag size={48} className="mb-4 opacity-50" />
                    <p>No transactions yet.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {sorted.map((t) => (
                        <div
                            key={t.id}
                            className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5 hover:border-white/10"
                        >
                            <div className="flex gap-4 items-start sm:items-center">
                                <div className={clsx(
                                    "p-3 rounded-xl flex items-center justify-center shrink-0",
                                    t.type === 'sale' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                                )}>
                                    {t.type === 'sale' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                                </div>
                                <div>
                                    <div className="font-semibold text-slate-200 line-clamp-1">{t.description}</div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 mt-1">
                                        <span>{formatDate(t.date)}</span>
                                        <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                                        <span>{getCategoryLabel(t.category)}</span>

                                        {t.details && t.details.size && (
                                            <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300 text-xs">
                                                {t.details.quantity || 1}x {t.details.size} / {t.details.color}
                                            </span>
                                        )}
                                        {t.details && t.details.subCategory && (
                                            <span className="px-2 py-0.5 rounded bg-white/10 text-slate-300 text-xs">
                                                {t.details.subCategory}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-6 ml-14 sm:ml-0">
                                <div className={clsx(
                                    "font-bold text-lg",
                                    t.type === 'sale' ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {t.type === 'sale' ? '+' : '-'} ₱{t.amount.toLocaleString()}
                                </div>
                                <button
                                    onClick={() => onDelete(t.id)}
                                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    title="Delete"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TransactionList;
