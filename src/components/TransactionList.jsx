import React from 'react';
import Card from './ui/Card';
import { ArrowUpRight, ArrowDownLeft, Trash2 } from 'lucide-react';

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
        <Card>
            <h2 style={{ marginBottom: '1.5rem' }}>Recent Activity</h2>
            {sorted.length === 0 ? (
                <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>No transactions yet.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sorted.map((t) => (
                        <div
                            key={t.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '1rem',
                                background: 'rgba(255,255,255,0.03)',
                                borderRadius: '12px',
                                borderLeft: `4px solid ${t.type === 'sale' ? 'var(--success)' : 'var(--danger)'}`
                            }} // Removed incorrect comment
                        >
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <div style={{
                                    background: t.type === 'sale' ? 'rgba(0, 184, 148, 0.2)' : 'rgba(255, 77, 77, 0.2)',
                                    padding: '0.5rem',
                                    borderRadius: '50%',
                                    color: t.type === 'sale' ? 'var(--success)' : 'var(--danger)'
                                }}>
                                    {t.type === 'sale' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                                </div>
                                <div>
                                    <div style={{ fontWeight: '600' }}>{t.description}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        {formatDate(t.date)} • {getCategoryLabel(t.category)}
                                        {t.details && t.details.size && (
                                            <span style={{ marginLeft: '0.5rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                                                {t.details.quantity || 1}x {t.details.size} / {t.details.color}
                                            </span>
                                        )}
                                        {t.details && t.details.subCategory && (
                                            <span style={{ marginLeft: '0.5rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                                                {t.details.quantity || 1}x {t.details.subCategory}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{
                                    fontWeight: '700',
                                    color: t.type === 'sale' ? 'var(--success)' : 'var(--danger)',
                                    fontSize: '1.1rem'
                                }}>
                                    {t.type === 'sale' ? '+' : '-'} ₱{t.amount.toLocaleString()}
                                </div>
                                <button
                                    onClick={() => onDelete(t.id)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
};

export default TransactionList;
