import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabaseClient';
import { Trophy, Users, Zap, CheckCircle, Smartphone, Award, ExternalLink, ArrowRight, UserPlus, Info, Ticket, Loader2, X } from 'lucide-react';
import { useToast } from '../ui/Toast';
import clsx from 'clsx';

export default function EventRegistration() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [leaderboard, setLeaderboard] = useState([]);
    const [showRegister, setShowRegister] = useState(false); // Default to leaderboard
    const [registeredVoucher, setRegisteredVoucher] = useState(null);

    // Form State
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [tournamentName, setTournamentName] = useState('');
    const [tournamentDate, setTournamentDate] = useState('');
    const [tournamentCategory, setTournamentCategory] = useState('');

    useEffect(() => {
        fetchLeaderboard();
        // Set default date to next month
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        setTournamentDate(nextMonth.toISOString().split('T')[0]);
    }, []);

    const fetchLeaderboard = async () => {
        try {
            const { data, error } = await supabase
                .from('monthly_leaderboard')
                .select('*')
                .limit(10);
            if (error) throw error;
            setLeaderboard(data || []);
        } catch (err) {
            console.error('Leaderboard error:', err);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!name.trim() || !phone.trim()) return showToast('Please fill required fields', 'error');

        setLoading(true);
        try {
            // Check if phone or name already has a voucher
            const { data: existing } = await supabase
                .from('referrers')
                .select('voucher_code')
                .or(`phone.eq.${phone},name.eq.${name}`)
                .single();

            if (existing) {
                showToast('You are already registered! Your code is ' + existing.voucher_code, 'info');
                setRegisteredVoucher(existing.voucher_code);
                return;
            }

            // Generate Voucher Code (NAME10)
            let baseCode = name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '');
            if (!baseCode) baseCode = 'REF'; // Complete fallback only if name has no letters
            let finalCode = `${baseCode}10`;

            // Check uniqueness
            const { data: duplicate } = await supabase
                .from('referrers')
                .select('id')
                .eq('voucher_code', finalCode)
                .single();

            if (duplicate) {
                finalCode = `${baseCode}${Math.floor(Math.random() * 9)}10`;
            }

            const { error } = await supabase
                .from('referrers')
                .insert([{
                    name: name.trim(),
                    phone: phone.trim(),
                    voucher_code: finalCode,
                    tournament_name: tournamentName,
                    tournament_date: tournamentDate || null,
                    tournament_category: tournamentCategory
                }]);

            if (error) throw error;

            // Also insert into transactions as a "voucher" so the storefront recognizes it
            const { error: voucherError } = await supabase.from('transactions').insert([{
                type: 'voucher',
                category: 'voucher', // Match admin filters
                amount: 0,
                date: new Date().toISOString(),
                description: `Referral Event Voucher for ${name}`,
                details: {
                    code: finalCode,
                    discountType: 'percent',
                    value: 10,
                    active: true,
                    isReferral: true,
                    referrerName: name
                }
            }]);

            if (voucherError) throw voucherError;

            setRegisteredVoucher(finalCode);
            showToast('Registration Successful!', 'success');
            fetchLeaderboard();
        } catch (err) {
            console.error(err);
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-primary/30">
            {/* Nav */}
            <nav className="h-20 border-b border-white/5 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-6 lg:px-12">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="SportsTech" className="h-12 w-auto" />
                    <div className="h-6 w-px bg-white/10 hidden sm:block"></div>
                    <span className="hidden sm:block text-xs font-bold tracking-widest text-slate-500 uppercase">Referral Event</span>
                </div>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => window.location.href = '/event/dashboard'}
                        className="text-xs font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                    >
                        <ExternalLink size={14} /> My Dashboard
                    </button>
                    <button 
                         onClick={() => window.location.href = '/'}
                         className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 transition-all"
                    >
                        Back to Shop
                    </button>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="max-w-7xl mx-auto px-6 lg:px-12 py-12 lg:py-20">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-8"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-widest">
                            <Trophy size={14} /> Monthly Challenge
                        </div>
                        <h1 className="text-5xl lg:text-7xl font-bold text-white leading-tight">
                            Refer Friends. <br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-red-500">Win Registration.</span>
                        </h1>
                        <p className="text-lg text-slate-400 max-w-lg leading-relaxed">
                            Top referrers this month get their next tournament registration covered 
                            (up to ₱1,500). Register now, get your unique code, and climb the ranks!
                        </p>

                        <div className="flex flex-wrap gap-4 pt-4">
                                <button 
                                    onClick={() => setShowRegister(true)}
                                    className="px-8 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg hover:bg-white/10 transition-all flex items-center gap-3 group"
                                >
                                    Join the Competition <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                                </button>
                                <button 
                                    onClick={() => {
                                        const sections = document.getElementById('rules');
                                        sections?.scrollIntoView({ behavior: 'smooth' });
                                    } }
                                    className="px-8 py-4 rounded-2xl text-slate-400 font-bold text-lg hover:text-white transition-colors"
                                >
                                    How it Works
                                </button>
                        </div>

                        <div className="grid grid-cols-3 gap-6 pt-8 border-t border-white/5">
                            <div>
                                <h3 className="text-2xl font-bold text-white">10% Off</h3>
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mt-1">For Referrals</p>
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-white">₱1,500</h3>
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mt-1">Winner Prize</p>
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-white">Proof-Only</h3>
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mt-1">Secure Tracking</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative"
                    >
                        <AnimatePresence mode="wait">
                            {showRegister ? (
                                <motion.div 
                                    key="form"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm"
                                >
                                    <div className="glass-panel p-8 lg:p-10 relative overflow-hidden max-w-md w-full shadow-2xl border-white/10">
                                        <button 
                                            onClick={() => setShowRegister(false)}
                                            className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/5 transition-colors text-slate-500 hover:text-white"
                                        >
                                            <X size={20} />
                                        </button>
                                    {/* Success State */}
                                    {registeredVoucher ? (
                                        <div className="text-center py-8 space-y-6">
                                            <div className="w-20 h-20 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mx-auto mb-4 border border-green-500/30">
                                                <CheckCircle size={40} />
                                            </div>
                                            <h2 className="text-3xl font-bold text-white">You're In!</h2>
                                            <p className="text-slate-400">Share your 10% discount code with everyone to climb the leaderboard.</p>
                                            
                                            <div className="bg-black/40 border border-white/10 rounded-2xl p-6 relative overflow-hidden group">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Your Unique Code</p>
                                                <div className="text-4xl font-mono font-bold text-primary tracking-tighter">
                                                    {registeredVoucher}
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(registeredVoucher);
                                                        showToast('Code copied to clipboard!', 'success');
                                                    }}
                                                    className="mt-4 text-xs font-bold text-slate-400 hover:text-white flex items-center gap-2 mx-auto"
                                                >
                                                    <Ticket size={14} /> Click to Copy Code
                                                </button>
                                            </div>

                                            <button 
                                                onClick={() => window.location.href = '/event/dashboard'}
                                                className="w-full btn-primary py-4 mt-6"
                                            >
                                                Go to My Dashboard
                                            </button>
                                        </div>
                                    ) : (
                                        <form onSubmit={handleRegister} className="space-y-4">
                                            <h2 className="text-2xl font-bold text-white mb-6">Register to Compete</h2>
                                            
                                            <div className="space-y-4">
                                                <label className="block">
                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Full Name *</span>
                                                    <input 
                                                        type="text" required value={name} onChange={e => setName(e.target.value)}
                                                        className="glass-input w-full py-3 px-4" placeholder="Juana Dela Cruz"
                                                    />
                                                </label>
                                                <label className="block">
                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Mobile Number *</span>
                                                    <input 
                                                        type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
                                                        className="glass-input w-full py-3 px-4" placeholder="0917XXXXXXX"
                                                    />
                                                </label>
                                                
                                                <div className="grid grid-cols-2 gap-4">
                                                    <label className="block">
                                                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Tournament</span>
                                                        <input 
                                                            type="text" value={tournamentName} onChange={e => setTournamentName(e.target.value)}
                                                            className="glass-input w-full py-3 px-4" placeholder="Summer League"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Category</span>
                                                        <input 
                                                            type="text" value={tournamentCategory} onChange={e => setTournamentCategory(e.target.value)}
                                                            className="glass-input w-full py-3 px-4" placeholder="U21 / Amateur"
                                                        />
                                                    </label>
                                                </div>
                                            </div>

                                            <button 
                                                type="submit" disabled={loading}
                                                className="w-full btn-primary py-4 mt-8 flex items-center justify-center gap-2"
                                            >
                                                {loading ? <Loader2 className="animate-spin" /> : <UserPlus size={18} />}
                                                Register & Get My Code
                                            </button>
                                            <p className="text-[10px] text-center text-slate-500 pt-4 leading-relaxed">
                                                By registering, you agree to the event rules. Only paid orders with QR proof attachments count towards the leaderboard.
                                            </p>
                                        </form>
                                    )}
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div 
                                    key="leaderboard"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="glass-panel p-1 border-white/10 relative bg-white/5 backdrop-blur-3xl overflow-hidden shadow-2xl shadow-primary/10"
                                >
                                    <div className="p-8 border-b border-white/5 bg-gradient-to-br from-primary/10 to-transparent flex flex-col sm:flex-row items-center justify-between gap-6">
                                        <div className="space-y-1">
                                            <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
                                                <Trophy size={24} className="text-yellow-500" /> Active Leaderboard
                                            </h2>
                                            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">March 2026 Season Coverage</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="px-4 py-2 rounded-xl bg-black/40 border border-white/10 text-center">
                                                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Total Pot</p>
                                                <p className="text-sm font-bold text-primary">₱1,500+</p>
                                            </div>
                                            <button 
                                                onClick={() => setShowRegister(true)}
                                                className="px-6 py-3 rounded-xl bg-primary text-white text-xs font-bold uppercase hover:shadow-lg hover:shadow-primary/20 transition-all border border-primary/50"
                                            >
                                                Register Now
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-2 overflow-y-auto max-h-[500px]">
                                        {leaderboard.length > 0 ? (
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                                                        <th className="p-4">Rank</th>
                                                        <th className="p-4">Name</th>
                                                        <th className="p-4 text-right">Referrals</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {leaderboard.map((item, idx) => (
                                                        <tr key={item.voucher_code} className="group hover:bg-white/5 transition-colors">
                                                            <td className="p-4">
                                                                <div className={clsx(
                                                                    "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                                                                    idx === 0 ? "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30" :
                                                                    idx === 1 ? "bg-slate-300/20 text-slate-300 border border-slate-300/30" :
                                                                    idx === 2 ? "bg-orange-500/20 text-orange-500 border border-orange-500/30" :
                                                                    "text-slate-500"
                                                                )}>
                                                                    {idx + 1}
                                                                </div>
                                                            </td>
                                                            <td className="p-4">
                                                                <div className="font-bold text-slate-200 group-hover:text-white transition-colors">{item.name}</div>
                                                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{item.voucher_code}</div>
                                                            </td>
                                                            <td className="p-4 text-right">
                                                                <div className="text-lg font-bold text-primary">{item.referral_count}</div>
                                                                <div className="text-[9px] text-slate-500 uppercase font-bold">Successfully Verified</div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="py-20 text-center text-slate-500 space-y-4">
                                                <Users size={40} className="mx-auto opacity-20" />
                                                <p className="text-sm">Be the first to join the monthly leaderboard!</p>
                                                <button onClick={() => setShowRegister(true)} className="text-primary font-bold text-xs uppercase hover:underline">Register Now</button>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Decor */}
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/20 rounded-full blur-3xl -z-10"></div>
                        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-orange-500/20 rounded-full blur-3xl -z-10"></div>
                    </motion.div>
                </div>
            </main>

            {/* Steps / Info */}
            <section id="rules" className="bg-white/2 bg-slate-900 border-t border-white/5 py-20">
                <div className="max-w-7xl mx-auto px-6 lg:px-12 grid md:grid-cols-3 gap-12">
                    <div className="space-y-4 group">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Zap size={24} />
                        </div>
                        <h4 className="text-xl font-bold text-white">Share Your Code</h4>
                        <p className="text-sm text-slate-400">Register in seconds to get your unique 10% discount code. Anyone who uses it at checkout saves money instantly.</p>
                    </div>
                    <div className="space-y-4 group">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Smartphone size={24} />
                        </div>
                        <h4 className="text-xl font-bold text-white">Attach Proof</h4>
                        <p className="text-sm text-slate-400">For a referral to count, the customer must pay via QR and upload their receipt. This prevents fake orders and keeps it fair.</p>
                    </div>
                    <div className="space-y-4 group">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Award size={24} />
                        </div>
                        <h4 className="text-xl font-bold text-white">Win Reimbursement</h4>
                        <p className="text-sm text-slate-400">Top ranked participant at the end of the month wins a 100% reimbursement of their tournament fee (up to ₱1,500).</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
