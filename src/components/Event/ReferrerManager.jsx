import React, { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Edit2, Trophy, Phone, Calendar, Award, X, Save, Search, ExternalLink, Loader2, Filter, Smartphone, Ticket } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import clsx from 'clsx';

export default function ReferrerManager() {
    const { showToast } = useToast();
    const [referrers, setReferrers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    
    // Form State
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        voucher_code: '',
        tournament_name: '',
        tournament_date: '',
        tournament_category: '',
        target_reimbursement: 1500,
        is_active: true
    });

    useEffect(() => {
        fetchReferrers();
    }, []);

    const fetchReferrers = async () => {
        setLoading(true);
        try {
            // Fetch referrers joined with their current referral count from the view
            const { data, error } = await supabase
                .from('referrers')
                .select('*, count:monthly_leaderboard(referral_count)')
                .order('created_at', { ascending: false });

            // Note: Since monthly_leaderboard is a view, simple join might be tricky depending on Supabase config.
            // Alternative: Fetch referrers and leaderboard separately.
            const { data: refData, error: refError } = await supabase.from('referrers').select('*').order('created_at', { ascending: false });
            const { data: leadData } = await supabase.from('monthly_leaderboard').select('*');

            if (refError) throw refError;

            const mapped = (refData || []).map(r => ({
                ...r,
                referral_count: leadData?.find(l => l.voucher_code === r.voucher_code)?.referral_count || 0
            }));

            setReferrers(mapped);
        } catch (err) {
            console.error(err);
            showToast('Failed to load referrers', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (ref = null) => {
        if (ref) {
            setEditingId(ref.id);
            setFormData({
                name: ref.name,
                phone: ref.phone,
                voucher_code: ref.voucher_code,
                tournament_name: ref.tournament_name || '',
                tournament_date: ref.tournament_date || '',
                tournament_category: ref.tournament_category || '',
                target_reimbursement: ref.target_reimbursement || 1500,
                is_active: ref.is_active !== false
            });
        } else {
            setEditingId(null);
            setFormData({
                name: '',
                phone: '',
                voucher_code: '',
                tournament_name: '',
                tournament_date: new Date().toISOString().split('T')[0],
                tournament_category: '',
                target_reimbursement: 1500,
                is_active: true
            });
        }
        setShowModal(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (editingId) {
                // Update
                const { error } = await supabase
                    .from('referrers')
                    .update(formData)
                    .eq('id', editingId);
                if (error) throw error;
                showToast('Referrer updated', 'success');
            } else {
                // Insert
                // Auto-gen code if empty
                let code = formData.voucher_code;
                if (!code) {
                    const base = formData.name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '') || 'REF';
                    code = `${base}10`;
                }
                
                const { error } = await supabase
                    .from('referrers')
                    .insert([{ ...formData, voucher_code: code.toUpperCase() }]);
                
                if (error) throw error;

                // Also create a voucher for them in transactions
                await supabase.from('transactions').insert([{
                    type: 'voucher',
                    category: 'voucher',
                    description: `Admin Created Referral for ${formData.name}`,
                    details: {
                        code: code.toUpperCase(),
                        discountType: 'percent',
                        value: 10,
                        active: true,
                        isReferral: true
                    },
                    amount: 0,
                    date: new Date().toISOString()
                }]);

                showToast('Referrer added', 'success');
            }
            setShowModal(false);
            fetchReferrers();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (ref) => {
        if (!confirm(`Delete ${ref.name}? Their stats will be lost.`)) return;
        
        try {
            // 1. Delete from referrers
            const { error: refErr, count } = await supabase
                .from('referrers')
                .delete({ count: 'exact' })
                .eq('id', ref.id);

            if (refErr) throw refErr;
            
            // If count is 0, it means RLS or ID mismatch prevented deletion
            if (count === 0) {
                throw new Error('Database rejected deletion. Check your Supabase RLS policies for the "referrers" table.');
            }

            // 2. Delete the associated voucher from transactions
            // We use 'contains' for JSONB objects to be more compatible
            const { error: transErr } = await supabase
                .from('transactions')
                .delete()
                .eq('type', 'voucher')
                .contains('details', { code: ref.voucher_code });

            if (transErr) console.warn('Voucher deletion failed:', transErr.message);

            showToast('Referrer deleted successfully', 'success');
            fetchReferrers();
        } catch (err) {
            console.error('Delete Error:', err);
            showToast(`Delete Failed: ${err.message}`, 'error');
        }
    };

    const filtered = referrers.filter(r => 
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        r.voucher_code.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="h-full flex flex-col gap-6 font-sans">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-primary/20 rounded-xl text-primary">
                        <Trophy size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Event Referrers</h2>
                        <p className="text-slate-400 text-sm">Manage participants and referral codes</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                     <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input 
                            type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Search name or code..."
                            className="glass-input pl-10 py-2 w-full text-sm"
                        />
                    </div>
                    <button onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2 shrink-0">
                        <Plus size={18} /> Add Referrer
                    </button>
                </div>
            </div>

            <div className="glass-panel border-white/5 overflow-hidden flex-1 flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 border-b border-white/10 sticky top-0 z-10">
                            <tr className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                                <th className="p-4">Rank/Status</th>
                                <th className="p-4">Participant Details</th>
                                <th className="p-4">Tournament Info</th>
                                <th className="p-4 text-center">Score</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 overflow-y-auto">
                            {filtered.map((ref, idx) => (
                                <tr key={ref.id} className={clsx("hover:bg-white/2 transition-colors", !ref.is_active && "opacity-60")}>
                                    <td className="p-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center font-bold text-xs">
                                                {idx + 1}
                                            </div>
                                            <span className={clsx(
                                                "w-2 h-2 rounded-full",
                                                ref.is_active ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-slate-600"
                                            )}></span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold text-white leading-none mb-1">{ref.name}</div>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                                            <Phone size={10} /> {ref.phone} 
                                            <span className="text-white/10 mx-1">|</span>
                                            <Ticket size={10} className="text-primary" /> <span className="text-primary font-bold">{ref.voucher_code}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 whitespace-nowrap">
                                        <div className="text-xs text-slate-300 font-medium">{ref.tournament_name || 'Generic Entry'}</div>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1 uppercase">
                                            <Award size={10} /> {ref.tournament_category || 'N/A'}
                                            <span className="mx-1">•</span>
                                            <Calendar size={10} /> {ref.tournament_date ? new Date(ref.tournament_date).toLocaleDateString() : 'TBD'}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="text-xl font-bold text-white">{ref.referral_count}</div>
                                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Verified</div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2 text-slate-400">
                                            <button onClick={() => window.location.href = `/event/dashboard`} title="View as Participant" className="p-2 hover:bg-white/5 rounded-lg transition-colors"><ExternalLink size={16} /></button>
                                            <button onClick={() => handleOpenModal(ref)} className="p-2 hover:bg-white/5 hover:text-white rounded-lg transition-colors"><Edit2 size={16} /></button>
                                            <button onClick={() => handleDelete(ref)} className="p-2 hover:bg-white/5 hover:text-red-400 rounded-lg transition-colors"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-600 gap-4">
                        <Users size={64} className="opacity-10" />
                        <p className="text-sm">No referrers found. Register your first participant!</p>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="glass-panel p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex justify-between items-center mb-8 pb-4 border-b border-white/5">
                                <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                                    <Users size={24} className="text-primary" /> {editingId ? 'Edit Referrer' : 'New Participant'}
                                </h3>
                                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors"><X size={24} /></button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <label className="block">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Participant Name *</span>
                                            <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="glass-input w-full py-3 px-4" placeholder="Juana Dela Cruz" />
                                        </label>
                                        <label className="block">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Phone Number *</span>
                                            <input type="tel" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="glass-input w-full py-3 px-4" placeholder="0917XXXXXXX" />
                                        </label>
                                        <label className="block">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Referral Code</span>
                                            <input type="text" value={formData.voucher_code} onChange={e => setFormData({...formData, voucher_code: e.target.value.toUpperCase()})} className="glass-input w-full py-3 px-4 font-mono text-primary font-bold" placeholder="AUTO-GEN" />
                                        </label>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="block">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Tournament Name</span>
                                            <input type="text" value={formData.tournament_name} onChange={e => setFormData({...formData, tournament_name: e.target.value})} className="glass-input w-full py-3 px-4" placeholder="Manila Summer Open" />
                                        </label>
                                        <div className="grid grid-cols-2 gap-4">
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Category</span>
                                                <input type="text" value={formData.tournament_category} onChange={e => setFormData({...formData, tournament_category: e.target.value})} className="glass-input w-full py-3 px-4" placeholder="U21" />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Date</span>
                                                <input type="date" value={formData.tournament_date} onChange={e => setFormData({...formData, tournament_date: e.target.value})} className="glass-input w-full py-2.5 px-4" />
                                            </label>
                                        </div>
                                        <label className="block">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Target Prize (PHP)</span>
                                            <input type="number" value={formData.target_reimbursement} onChange={e => setFormData({...formData, target_reimbursement: Number(e.target.value)})} className="glass-input w-full py-3 px-4" />
                                        </label>
                                    </div>
                                </div>

                                <div className="border-t border-white/5 pt-6 flex items-center justify-between">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="hidden" />
                                        <div className={clsx("w-10 h-5 rounded-full transition-colors relative", formData.is_active ? "bg-green-500" : "bg-slate-700")}>
                                            <div className={clsx("absolute top-1 w-3 h-3 rounded-full bg-white transition-all", formData.is_active ? "left-6" : "left-1")}></div>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-white transition-colors">Eligible to Win</span>
                                    </label>
                                    <div className="flex gap-4">
                                        <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 rounded-xl hover:bg-white/5 text-slate-400 font-bold transition-all uppercase text-xs">Cancel</button>
                                        <button type="submit" disabled={loading} className="btn-primary px-8 py-3 flex items-center gap-2">
                                            {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                            {editingId ? 'Update Participant' : 'Create Entry'}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
