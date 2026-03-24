import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabaseClient';
import { Trophy, Users, Zap, CheckCircle, Smartphone, Award, ExternalLink, ArrowRight, UserPlus, Info, Ticket, X, Copy, Phone, LogOut, Loader2, Clock, CheckCircle2, ChevronRight, Share2 } from 'lucide-react';
import { useToast } from '../ui/Toast';
import clsx from 'clsx';

export default function ReferrerDashboard() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [loginLoading, setLoginLoading] = useState(false);
    const [referrer, setReferrer] = useState(null);
    const [referrals, setReferrals] = useState([]);
    const [stats, setStats] = useState({ total: 0, pending: 0, verified: 0 });

    // Login Form
    const [phone, setPhone] = useState('');
    const [voucherCode, setVoucherCode] = useState('');

    useEffect(() => {
        const saved = localStorage.getItem('referrer_session');
        if (saved) {
            const data = JSON.parse(saved);
            setReferrer(data);
            fetchReferrals(data.voucher_code);
        }
    }, []);

    const fetchReferrals = async (code) => {
        setLoading(true);
        try {
            // Fetch all transactions with this voucher code
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('type', 'sale')
                .eq('details->>voucherCode', code.toUpperCase())
                .order('date', { ascending: false });

            if (error) throw error;

            const list = data || [];
            setReferrals(list);

            // Calculate stats
            const verified = list.filter(t => t.details?.proofOfPayment).length;
            const total = list.length;
            const pending = total - verified;

            setStats({ total, pending, verified });
        } catch (err) {
            console.error('Fetch error:', err);
            showToast('Failed to load activity', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!phone.trim() || !voucherCode.trim()) return showToast('Please enter both details', 'error');

        setLoginLoading(true);
        try {
            const { data, error } = await supabase
                .from('referrers')
                .select('*')
                .eq('phone', phone.trim())
                .eq('voucher_code', voucherCode.trim().toUpperCase())
                .single();

            if (error || !data) throw new Error('Invalid Phone Number or Voucher Code');

            setReferrer(data);
            localStorage.setItem('referrer_session', JSON.stringify(data));
            fetchReferrals(data.voucher_code);
            showToast('Welcome back, ' + data.name, 'success');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('referrer_session');
        setReferrer(null);
        setReferrals([]);
        showToast('Logged out', 'info');
    };

    if (!referrer) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-slate-100 font-sans">
               <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-panel max-w-md w-full p-8 lg:p-10 space-y-8 relative overflow-hidden"
                >
                    <div className="text-center space-y-4">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto border border-primary/20">
                            <Trophy size={32} />
                        </div>
                        <h1 className="text-3xl font-bold text-white tracking-tight">Referrer Login</h1>
                        <p className="text-sm text-slate-500">Log in with your unique code and phone number to track your rank.</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest pl-1">Voucher Code</label>
                                <div className="relative">
                                    <Ticket className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                                    <input 
                                        type="text" required value={voucherCode} onChange={e => setVoucherCode(e.target.value)}
                                        className="glass-input w-full py-4 pl-12 pr-4 text-center font-mono text-xl tracking-widest uppercase text-primary placeholder:text-slate-800"
                                        placeholder="JOHN10"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest pl-1">Mobile Number</label>
                                <div className="relative">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                                    <input 
                                        type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
                                        className="glass-input w-full py-4 pl-12 pr-4 font-mono text-lg"
                                        placeholder="0917XXXXXXX"
                                    />
                                </div>
                            </div>
                        </div>

                        <button 
                            type="submit" disabled={loginLoading}
                            className="w-full btn-primary py-4 text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-all"
                        >
                            {loginLoading ? <Loader2 className="animate-spin" /> : <ChevronRight size={20} />}
                            View My Rank
                        </button>
                    </form>

                    <div className="text-center">
                        <button 
                            onClick={() => window.location.href = '/event'}
                            className="text-xs font-bold text-slate-500 hover:text-white transition-colors underline underline-offset-4"
                        >
                            Don't have a code yet? Register here.
                        </button>
                    </div>
                </motion.div>
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -z-10 animate-pulse"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-primary/30">
            {/* Nav */}
            <nav className="h-20 border-b border-white/5 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-6 lg:px-12">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="SportsTech" className="h-10 w-auto" />
                    <div className="h-6 w-px bg-white/10 hidden sm:block"></div>
                    <span className="hidden sm:block text-xs font-bold tracking-widest text-slate-400 uppercase">Referrer HQ</span>
                </div>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleLogout}
                        className="text-[11px] font-bold text-slate-500 hover:text-red-400 transition-colors flex items-center gap-2 uppercase tracking-widest border border-white/5 px-4 py-2 rounded-full"
                    >
                        <LogOut size={14} /> Sign Out
                    </button>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-6 lg:px-12 py-8 lg:py-12 space-y-8">
                {/* Header Profile */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-4 border-b border-white/5">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-bold text-white tracking-tight">Welcome, {referrer.name}!</h1>
                            <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500 border border-green-500/20 text-[10px] font-bold uppercase tracking-widest">Active competitor</span>
                        </div>
                        <p className="text-slate-400 text-sm max-w-md italic">Competing for: <span className="font-bold text-white">{referrer.tournament_name || 'N/A'} ({referrer.tournament_category || 'N/A'})</span></p>
                    </div>
                    
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-4 flex items-center gap-4 min-w-[240px] group cursor-pointer" 
                         onClick={() => {
                            navigator.clipboard.writeText(referrer.voucher_code);
                            showToast('Voucher code copied!', 'success');
                         }}>
                        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                            <Ticket size={24} />
                        </div>
                        <div className="flex-1">
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Your Code</p>
                            <p className="text-2xl font-mono font-bold text-white tracking-widest group-hover:text-primary transition-colors">{referrer.voucher_code}</p>
                        </div>
                        <Copy size={16} className="text-slate-600 group-hover:text-white" />
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Zap size={64} />
                        </div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Referrals</p>
                        <h2 className="text-5xl font-bold text-white">{stats.total}</h2>
                    </div>
                    <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-yellow-500">
                            <Clock size={64} />
                        </div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Pending Proof</p>
                        <h2 className="text-5xl font-bold text-yellow-500">{stats.pending}</h2>
                        <p className="text-[10px] text-slate-600 mt-2 italic">Needs QR proof attachment</p>
                    </div>
                    <div className="glass-panel p-6 border-primary/20 bg-primary/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-primary">
                            <Trophy size={64} />
                        </div>
                        <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Verified Scores</p>
                        <h2 className="text-5xl font-bold text-white">{stats.verified}</h2>
                        <p className="text-[10px] text-primary/60 mt-2 font-bold uppercase tracking-widest">Counted for Leaderboard</p>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Referrals List */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Users size={18} className="text-slate-500" /> My Referral Activity
                            </h3>
                            {loading && <Loader2 size={16} className="animate-spin text-slate-600" />}
                        </div>

                        <div className="glass-panel border-white/5 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="text-[10px] text-slate-500 uppercase tracking-widest font-bold border-b border-white/5">
                                            <th className="p-4">Customer</th>
                                            <th className="p-4">Date</th>
                                            <th className="p-4">Amount</th>
                                            <th className="p-4 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {referrals.length > 0 ? referrals.map((t, idx) => (
                                            <tr key={t.id} className="hover:bg-white/5 transition-colors group">
                                                <td className="p-4">
                                                    <div className="font-bold text-slate-200">{t.details?.customerName || 'Anonymous Customer'}</div>
                                                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{t.details?.orderId || 'WEB-ORDER'}</div>
                                                </td>
                                                <td className="p-4 text-sm text-slate-400">
                                                    {new Date(t.date).toLocaleDateString()}
                                                </td>
                                                <td className="p-4 text-sm font-mono font-bold text-slate-300">
                                                    ₱{Number(t.amount).toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {t.details?.proofOfPayment ? (
                                                        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-green-500 uppercase tracking-widest px-2 py-1 rounded bg-green-500/10 border border-green-500/20">
                                                            <CheckCircle2 size={12} /> Verified
                                                        </div>
                                                    ) : (
                                                        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-yellow-500 uppercase tracking-widest px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/20">
                                                            <Clock size={12} /> Unpaid
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan="4" className="py-20 text-center text-slate-600">
                                                    <Zap size={40} className="mx-auto opacity-10 mb-4" />
                                                    <p>No referrals found yet. Share your code to get started!</p>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* How to win sidebar */}
                    <div className="space-y-6">
                        <div className="glass-panel p-6 border-white/5 bg-white/2 space-y-6 relative overflow-hidden">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Info size={18} className="text-primary" /> Goal Checklist
                            </h3>
                            
                            <ul className="space-y-4">
                                <li className="flex gap-4 items-start">
                                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">1</div>
                                    <p className="text-sm text-slate-400">Share your 10% code <span className="text-white font-bold">{referrer.voucher_code}</span> on Facebook or Instagram.</p>
                                </li>
                                <li className="flex gap-4 items-start">
                                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">2</div>
                                    <p className="text-sm text-slate-400">Instruct customers to **attach their QR proof of payment** during checkout.</p>
                                </li>
                                <li className="flex gap-4 items-start">
                                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">3</div>
                                    <p className="text-sm text-slate-400">Verify your count here. Only orders with proofs are counted on the public leaderboard.</p>
                                </li>
                                <li className="flex gap-4 items-start">
                                    <div className="w-6 h-6 rounded-full border border-primary/20 text-primary/50 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">4</div>
                                    <p className="text-sm text-slate-400">Wait for the end of the month announcement on <span className="text-white font-bold">Facebook</span>.</p>
                                </li>
                            </ul>

                            <button 
                                onClick={() => {
                                    const text = `Shop at SportsTech and get 10% OFF using my code: ${referrer.voucher_code}! Buy here: ${window.location.origin}`;
                                    navigator.clipboard.writeText(text);
                                    showToast('Share message copied!', 'success');
                                }}
                                className="w-full btn-primary py-4 flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-orange-600"
                            >
                                <Share2 size={18} /> Copy Promo Message
                            </button>

                            <div className="absolute bottom-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -z-10"></div>
                        </div>

                        <div className="glass-panel p-6 border-white/5 space-y-4">
                            <h4 className="font-bold text-white uppercase text-xs tracking-widest">Public Rank</h4>
                            <button 
                                onClick={() => window.location.href = '/event'}
                                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-400 hover:text-white transition-all flex items-center justify-center gap-2"
                            >
                                <ExternalLink size={14} /> View Leaderboard
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
