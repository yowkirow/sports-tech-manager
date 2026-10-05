import React, { useState, useMemo } from 'react';
import { Ticket, Plus, Trash2, Tag, Percent, DollarSign, Save, X, ToggleLeft, ToggleRight, Search } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '../ui/Toast';
import { getVoucherUsage } from '../../lib/voucherUsage';

const formatDiscount = (voucher) => `${voucher.discountType === 'fixed' ? '₱' : ''}${voucher.value}${voucher.discountType === 'percent' ? '%' : ''}`;

export default function VoucherManager({ transactions, onAddTransaction, onUpdateTransaction, onDeleteTransaction }) {
    const { showToast } = useToast();
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);

    const vouchers = useMemo(() => {
        const usage = getVoucherUsage(transactions);
        return transactions.filter(t => t.type === 'voucher').map(t => ({
            id: t.id,
            code: t.details.code,
            discountType: t.details.discountType,
            value: t.details.value,
            usageLimit: t.details.usageLimit,
            expiryDate: t.details.expiryDate,
            usageCount: usage.get(t.details.code) || 0,
            active: t.details.active !== false,
            description: t.description
        }));
    }, [transactions]);

    const filteredVouchers = vouchers.filter(v =>
        v.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const activeVouchers = vouchers.filter(v => v.active).length;
    const totalUsage = vouchers.reduce((sum, voucher) => sum + voucher.usageCount, 0);

    const toggleStatus = async (voucher) => {
        // Toggle active status
        const originalTransaction = transactions.find(t => t.id === voucher.id);
        if (!originalTransaction) {
            showToast('Voucher no longer exists. Refresh and try again.', 'error');
            return;
        }

        const newStatus = !voucher.active;
        setSaving(true);
        try {
            await onUpdateTransaction(voucher.id, {
                details: { ...originalTransaction.details, active: newStatus }
            });
            showToast(`Voucher ${newStatus ? 'Activated' : 'Deactivated'}`, 'success');
        } catch (err) {
            console.error('Failed to update voucher:', err);
            showToast('Failed to update voucher', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (confirm('Delete this voucher permanently?')) {
            setSaving(true);
            try {
                await onDeleteTransaction(id);
                showToast('Voucher deleted', 'success');
            } catch (err) {
                console.error('Failed to delete voucher:', err);
                showToast('Failed to delete voucher', 'error');
            } finally {
                setSaving(false);
            }
        }
    };

    const renderVoucherStatus = (voucher) => (
        <span className={clsx('badge', voucher.active ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-600 text-ink-2')}>
            {voucher.active ? 'Active' : 'Inactive'}
        </span>
    );

    const renderVoucherActions = (voucher) => (
        <div className="flex items-center justify-end gap-1">
            <button
                type="button"
                onClick={() => toggleStatus(voucher)}
                disabled={saving}
                aria-label={`${voucher.active ? 'Deactivate' : 'Activate'} voucher ${voucher.code}`}
                aria-pressed={voucher.active}
                className={clsx('chip h-10', voucher.active && 'chip-active')}
            >
                {voucher.active ? <ToggleRight size={16} aria-hidden="true" /> : <ToggleLeft size={16} aria-hidden="true" />}
                {voucher.active ? 'Active' : 'Inactive'}
            </button>
            <button
                type="button"
                onClick={() => handleDelete(voucher.id)}
                disabled={saving}
                aria-label={`Delete voucher ${voucher.code}`}
                className="icon-btn hover:text-red-300"
            >
                <Trash2 size={18} aria-hidden="true" />
            </button>
        </div>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="section-title flex items-center gap-2">
                        <Ticket size={20} className="text-ink-3" aria-hidden="true" /> Vouchers
                    </h2>
                    <p className="mt-1 text-sm text-ink-2">Manage discount codes</p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    className="btn-primary w-full sm:w-auto"
                >
                    <Plus size={18} aria-hidden="true" /> Create Voucher
                </button>
            </div>

            <div className="surface grid grid-cols-1 divide-y divide-line overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Vouchers</p>
                    <p className="display mt-2 text-3xl num">{vouchers.length}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Active</p>
                    <p className="display mt-2 text-3xl num">{activeVouchers}</p>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm text-ink-2">Used</p>
                    <p className="display mt-2 text-3xl num">{totalUsage}</p>
                </div>
            </div>

            <section className="surface overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <h3 className="section-title">Voucher list</h3>
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                        <input
                            type="text"
                            aria-label="Search vouchers"
                            placeholder="Search vouchers..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="field pl-9 text-sm"
                        />
                    </div>
                </div>

                {filteredVouchers.length === 0 ? (
                    <div className="m-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 py-16 text-center text-ink-2 sm:m-5">
                        <Ticket size={32} className="mb-3 text-ink-3" aria-hidden="true" />
                        <p>No vouchers found. Create one to get started!</p>
                    </div>
                ) : (
                    <>
                        <div className="divide-y divide-line sm:hidden">
                            {filteredVouchers.map(voucher => (
                                <div key={voucher.id} className={clsx('p-4', !voucher.active && 'opacity-70')}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="break-all text-2xl font-bold leading-none tracking-wide text-ink">{voucher.code}</p>
                                            <p className="mt-1 text-sm text-ink-2">{voucher.discountType === 'percent' ? 'Percentage Off' : 'Fixed Amount'}</p>
                                        </div>
                                        <p className="display shrink-0 text-right text-3xl num">
                                            {formatDiscount(voucher)}<span className="ml-1 align-baseline text-sm font-semibold text-ink-2">off</span>
                                        </p>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                                        {renderVoucherStatus(voucher)}
                                        {voucher.expiryDate && (
                                            <span>
                                                <span className="text-ink-3">Expires:</span>{' '}
                                                <span className={new Date(voucher.expiryDate) < new Date() ? 'font-semibold text-red-300' : 'text-ink-2'}>
                                                    {new Date(voucher.expiryDate).toLocaleDateString()}
                                                </span>
                                            </span>
                                        )}
                                        {voucher.usageLimit && <span className="num">Used: {voucher.usageCount} / {voucher.usageLimit}</span>}
                                    </div>
                                    {voucher.usageLimit && (
                                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-well">
                                            <div
                                                className="h-full bg-primary"
                                                style={{ width: `${Math.min((voucher.usageCount / voucher.usageLimit) * 100, 100)}%` }}
                                            />
                                        </div>
                                    )}
                                    <div className="mt-4 flex justify-end border-t border-line pt-3">
                                        {renderVoucherActions(voucher)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden overflow-x-auto sm:block">
                            <table className="w-full min-w-[760px] text-sm">
                                <thead>
                                    <tr className="border-b border-line text-left text-ink-2">
                                        <th className="px-3 py-3 font-medium">Voucher Code</th>
                                        <th className="px-3 py-3 font-medium">Discount Type</th>
                                        <th className="px-3 py-3 text-right font-medium">Value</th>
                                        <th className="px-3 py-3 font-medium">Usage Limit</th>
                                        <th className="px-3 py-3 font-medium">Expiry Date</th>
                                        <th className="px-3 py-3 text-center font-medium">Status</th>
                                        <th className="px-3 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredVouchers.map(voucher => (
                                        <tr key={voucher.id} className={clsx('border-b border-line transition-colors last:border-0 hover:bg-white/[0.04]', !voucher.active && 'opacity-70')}>
                                            <td className="px-3 py-3 font-bold tracking-wide text-ink">{voucher.code}</td>
                                            <td className="px-3 py-3 text-ink-2">{voucher.discountType === 'percent' ? 'Percentage Off' : 'Fixed Amount'}</td>
                                            <td className="px-3 py-3 text-right font-semibold text-ink num">{formatDiscount(voucher)}</td>
                                            <td className="px-3 py-3 text-ink-2 num">
                                                {voucher.usageLimit ? `Used: ${voucher.usageCount} / ${voucher.usageLimit}` : '—'}
                                            </td>
                                            <td className="px-3 py-3 text-ink-2">
                                                {voucher.expiryDate ? (
                                                    <span className={new Date(voucher.expiryDate) < new Date() ? 'font-semibold text-red-300' : ''}>
                                                        {new Date(voucher.expiryDate).toLocaleDateString()}
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td className="px-3 py-3 text-center">{renderVoucherStatus(voucher)}</td>
                                            <td className="px-3 py-3 text-right">{renderVoucherActions(voucher)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>

            {showAddModal && (
                <AddVoucherModal
                    onClose={() => setShowAddModal(false)}
                    onSave={async (voucher) => {
                        await onAddTransaction({
                            id: crypto.randomUUID(),
                            date: new Date().toISOString(),
                            amount: 0,
                            type: 'voucher',
                            category: 'voucher',
                            description: `Voucher: ${voucher.code}`,
                            details: {
                                code: voucher.code,
                                discountType: voucher.discountType,
                                value: Number(voucher.value),
                                usageLimit: voucher.usageLimit,
                                expiryDate: voucher.expiryDate,
                                active: true
                            }
                        });
                        showToast('Voucher created!', 'success');
                        setShowAddModal(false);
                    }}
                />
            )}
        </div>
    );
}

function AddVoucherModal({ onClose, onSave }) {
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [code, setCode] = useState('');
    const [type, setType] = useState('percent');
    const [value, setValue] = useState('');
    const [limit, setLimit] = useState('');
    const [expiry, setExpiry] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!code || !value) return;
        setSaving(true);
        try {
            await onSave({
                code: code.toUpperCase(),
                discountType: type,
                value,
                usageLimit: limit ? Number(limit) : null,
                expiryDate: expiry || null
            });
        } catch (err) {
            console.error('Failed to create voucher:', err);
            showToast('Failed to create voucher. Please try again.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-6">
            <div className="mx-auto flex max-h-[92dvh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sheet">
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
                    <h3 className="display text-2xl">New Voucher</h3>
                    <button type="button" aria-label="Close" disabled={saving} onClick={onClose} className="icon-btn -mr-2 -mt-1">
                        <X size={22} aria-hidden="true" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                        <div>
                            <label htmlFor="voucher-code" className="field-label">Voucher Code</label>
                            <div className="relative">
                                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={16} aria-hidden="true" />
                                <input
                                    id="voucher-code"
                                    autoFocus
                                    value={code}
                                    onChange={e => setCode(e.target.value.toUpperCase())}
                                    placeholder="e.g. SUMMERCAFE"
                                    className="field pl-10 font-semibold uppercase tracking-wide"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <p className="field-label">Discount Type</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setType('percent')}
                                        aria-pressed={type === 'percent'}
                                        className="chip justify-center"
                                    >
                                        <Percent size={16} aria-hidden="true" /> %
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setType('fixed')}
                                        aria-pressed={type === 'fixed'}
                                        className="chip justify-center"
                                    >
                                        <DollarSign size={16} aria-hidden="true" /> ₱
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="voucher-value" className="field-label">Value</label>
                                <input
                                    id="voucher-value"
                                    type="number"
                                    value={value}
                                    onChange={e => setValue(e.target.value)}
                                    placeholder={type === 'percent' ? '10' : '100'}
                                    className="field w-full num"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="voucher-limit" className="field-label">Usage Limit</label>
                                <input
                                    id="voucher-limit"
                                    type="number"
                                    value={limit}
                                    onChange={e => setLimit(e.target.value)}
                                    placeholder="∞"
                                    className="field w-full num"
                                />
                            </div>
                            <div>
                                <label htmlFor="voucher-expiry" className="field-label">Expiry Date</label>
                                <input
                                    id="voucher-expiry"
                                    type="date"
                                    value={expiry}
                                    onChange={e => setExpiry(e.target.value)}
                                    className="field w-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 border-t border-line bg-surface px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        <button type="submit" disabled={saving} className="btn-primary w-full">
                            <Save size={18} aria-hidden="true" /> {saving ? 'Saving...' : 'Save Voucher'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
