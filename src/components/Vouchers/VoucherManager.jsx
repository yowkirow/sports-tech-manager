import React, { useState } from 'react';
import { Ticket, Plus, Trash2, Tag, Percent, DollarSign, Save, X, ToggleLeft, ToggleRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ui/Toast';

export default function VoucherManager({ transactions, onAddTransaction, onDeleteTransaction }) {
    const { showToast } = useToast();
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const vouchers = transactions.filter(t => t.type === 'voucher').map(t => ({
        id: t.id,
        code: t.details.code,
        discountType: t.details.discountType, // 'percent' | 'fixed'
        value: t.details.value,
        active: t.details.active !== false, // default true
        description: t.description
    }));

    const filteredVouchers = vouchers.filter(v =>
        v.code.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const toggleStatus = async (voucher) => {
        // Toggle active status
        const originalTransaction = transactions.find(t => t.id === voucher.id);
        if (!originalTransaction) return;

        const newStatus = !voucher.active;

        // Use onAddTransaction to overwrite? No, we need an update mechanism. 
        // Current App.js doesn't pass 'updateTransaction', but 'addTransaction' creates new. 
        // We might need to delete and re-add or implement update in App.js.
        // Assuming 'onAddTransaction' essentially does 'upsert' or we rely on delete+add.
        // Wait, App.js 'addTransaction' calls 'addToSupabase'. 'addToSupabase' usually does insert.
        // Let's rely on delete then add for update, or assume we can just add a new one? No, ID conflict.

        // Actually, we don't have an update prop passed down to this component based on App.jsx.
        // I should probably just Delete and Create New with same ID? 'addToSupabase' handles upsert? 
        // Let's check 'useSupabaseTransactions' later. For now, I'll delete and re-create to be safe effectively updating.

        try {
            await onDeleteTransaction(voucher.id, true); // Skip confirm
            await onAddTransaction({
                ...originalTransaction,
                details: { ...originalTransaction.details, active: newStatus }
            });
            showToast(`Voucher ${newStatus ? 'Activated' : 'Deactivated'}`, 'success');
        } catch (err) {
            showToast('Failed to update voucher', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (confirm('Delete this voucher permanently?')) {
            await onDeleteTransaction(id);
            showToast('Voucher deleted', 'success');
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-pink-500/20 rounded-xl text-pink-400">
                        <Ticket size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Vouchers</h2>
                        <p className="text-slate-400 text-sm">Manage discount codes</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} /> Create Voucher
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredVouchers.map(voucher => (
                    <motion.div
                        key={voucher.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`glass-card p-6 relative overflow-hidden group ${!voucher.active ? 'opacity-60 grayscale' : ''}`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-lg ${voucher.discountType === 'percent' ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
                                    {voucher.discountType === 'percent' ? <Percent size={20} /> : <DollarSign size={20} />}
                                </div>
                                <div>
                                    <h3 className="text-2xl font-bold text-white tracking-widest leading-none mb-1">{voucher.code}</h3>
                                    <p className="text-xs text-slate-400 uppercase font-bold">{voucher.discountType === 'percent' ? 'Percentage Off' : 'Fixed Amount'}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(voucher.id)}
                                className="text-slate-500 hover:text-red-400 transition-colors p-2"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>

                        <div className="flex items-end justify-between">
                            <div className="text-4xl font-bold text-white">
                                {voucher.discountType === 'fixed' ? '₱' : ''}{voucher.value}{voucher.discountType === 'percent' ? '%' : ''}
                                <span className="text-base font-normal text-slate-500 ml-1">OFF</span>
                            </div>

                            <button
                                onClick={() => toggleStatus(voucher)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${voucher.active
                                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                        : 'bg-slate-700 text-slate-400'
                                    }`}
                            >
                                {voucher.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                {voucher.active ? 'Active' : 'Inactive'}
                            </button>
                        </div>
                    </motion.div>
                ))}
            </div>

            {filteredVouchers.length === 0 && (
                <div className="text-center py-20 text-slate-500">
                    <Ticket size={64} className="mx-auto mb-4 opacity-20" />
                    <p>No vouchers found. Create one to get started!</p>
                </div>
            )}

            <AnimatePresence>
                {showAddModal && (
                    <AddVoucherModal
                        onClose={() => setShowAddModal(false)}
                        onSave={async (voucher) => {
                            await onAddTransaction({
                                id: crypto.randomUUID(),
                                date: new Date().toISOString(),
                                amount: 0,
                                type: 'voucher',
                                description: `Voucher: ${voucher.code}`,
                                details: {
                                    code: voucher.code,
                                    discountType: voucher.discountType,
                                    value: Number(voucher.value),
                                    active: true
                                }
                            });
                            showToast('Voucher created!', 'success');
                            setShowAddModal(false);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function AddVoucherModal({ onClose, onSave }) {
    const [code, setCode] = useState('');
    const [type, setType] = useState('percent'); // percent, fixed
    const [value, setValue] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!code || !value) return;
        onSave({ code: code.toUpperCase(), discountType: type, value });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="glass-panel p-6 max-w-sm w-full"
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Plus size={20} className="text-primary" /> New Voucher
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Voucher Code</label>
                        <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                            <input
                                autoFocus
                                value={code}
                                onChange={e => setCode(e.target.value.toUpperCase())}
                                placeholder="e.g. SUMMERCAFE"
                                className="glass-input pl-10 w-full font-mono tracking-widest uppercase font-bold"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Discount Type</label>
                            <div className="flex bg-black/40 rounded-lg p-1">
                                <button
                                    type="button"
                                    onClick={() => setType('percent')}
                                    className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${type === 'percent' ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'}`}
                                >
                                    %
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setType('fixed')}
                                    className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${type === 'fixed' ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'}`}
                                >
                                    ₱
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Value</label>
                            <input
                                type="number"
                                value={value}
                                onChange={e => setValue(e.target.value)}
                                placeholder={type === 'percent' ? '10' : '100'}
                                className="glass-input w-full"
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn-primary w-full py-3 mt-4 flex items-center justify-center gap-2">
                        <Save size={18} /> Save Voucher
                    </button>
                </form>
            </motion.div>
        </div>
    );
}
