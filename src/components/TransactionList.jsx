import React from 'react';
import { ArrowUpRight, ArrowDownLeft, Trash2, ReceiptText } from 'lucide-react';
import clsx from 'clsx';
import { isReturnedSale } from '../lib/transactionStatus';
import { READ_ONLY_HINT } from './ui/ReadOnly';

const TransactionList = ({ transactions, onDelete, readOnly = false }) => {
    // Sort by date desc
    const sorted = transactions
        .filter(t => !isReturnedSale(t) && !t.details?.removedFromOrder)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

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
        <section className="surface" aria-labelledby="recent-activity-title">
            <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
                <h2 id="recent-activity-title" className="section-title">Recent Activity</h2>
                <span className="num text-sm text-ink-2">{sorted.length.toLocaleString()} records</span>
            </div>

            {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <ReceiptText size={30} className="text-ink-3" aria-hidden="true" />
                    <p className="mt-3 text-ink-2">No transactions yet.</p>
                </div>
            ) : (
                <ul className="divide-y divide-line">
                    {sorted.map((t) => (
                        <li key={t.id} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.02] sm:items-center sm:px-6">
                            <span className={clsx('mt-0.5 shrink-0 sm:mt-0', t.type === 'sale' ? 'text-emerald-400' : 'text-ink-3')} aria-hidden="true">
                                {t.type === 'sale' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 font-medium text-ink">{t.description || getCategoryLabel(t.category)}</p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                                    <span>{formatDate(t.date)}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{getCategoryLabel(t.category)}</span>
                                    {t.details && t.details.size && (
                                        <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-ink">
                                            {t.details.quantity ?? 1}× {t.details.size}{t.details.color ? ` / ${t.details.color}` : ''}
                                        </span>
                                    )}
                                    {t.details && t.details.subCategory && (
                                        <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-ink">{t.details.subCategory}</span>
                                    )}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <p className={clsx('num text-right font-semibold', t.type === 'sale' ? 'text-emerald-400' : 'text-ink')}>
                                    <span className="sr-only">{t.type === 'sale' ? 'Income' : 'Expense'} </span>
                                    {t.type === 'sale' ? '+' : '−'}₱{Number(t.amount).toLocaleString()}
                                </p>
                                {!readOnly && (
                                    <button type="button" onClick={() => onDelete(t.id)} aria-label={`Delete ${t.description || 'transaction'}`} title="Delete"
                                        className="icon-btn size-10 hover:text-red-400 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100">
                                        <Trash2 size={17} />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default TransactionList;
