import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Loader2, User, Delete, KeyRound, ArrowLeft } from 'lucide-react';
import { useToast } from '../ui/Toast';

const ADMIN_EMAILS = [
    'manager@sportstech.com',
    'admin2@sportstech.com'
];

export default function Login() {
    const { showToast } = useToast();
    const [mode, setMode] = useState('pin'); // 'pin' | 'password'

    // PIN State
    const [pin, setPin] = useState('');

    // Password State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [loading, setLoading] = useState(false);

    // PIN Handlers
    const handlePinParams = (num) => {
        if (pin.length < 6) setPin(prev => prev + num);
    };

    const handleDelete = () => {
        setPin(prev => prev.slice(0, -1));
    };

    const handlePinLogin = async () => {
        if (pin.length < 4) return showToast('PIN must be at least 4 digits', 'error');
        setLoading(true);
        try {
            let success = false;
            for (const adminEmail of ADMIN_EMAILS) {
                const { error } = await supabase.auth.signInWithPassword({
                    email: adminEmail,
                    password: pin,
                });
                if (!error) {
                    success = true;
                    break;
                }
            }
            if (!success) throw new Error('Invalid PIN');
            showToast('Welcome back!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Invalid PIN', 'error');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    // Password Handler
    const handlePasswordLogin = async (e) => {
        e.preventDefault();
        if (!email || !password) return showToast('Please fill in all fields', 'error');

        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) throw error;
            showToast('Welcome back!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Effects
    React.useEffect(() => {
        if (mode === 'pin' && pin.length === 6) handlePinLogin();
    }, [pin, mode]);

    React.useEffect(() => {
        if (mode !== 'pin') return;
        const handleKeyDown = (e) => {
            if (loading) return;
            if (e.key >= '0' && e.key <= '9') handlePinParams(e.key);
            else if (e.key === 'Backspace') handleDelete();
            else if (e.key === 'Enter') handlePinLogin();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [loading, pin, mode]);

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900 p-4 font-sans selection:bg-primary/30">
            {/* Background Effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[120px]" />

            <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel w-full max-w-sm p-8 relative z-10 flex flex-col items-center"
            >
                <div className="mb-6 flex flex-col items-center">
                    <img src="/logo.png" alt="SportsTech" className="h-32 w-auto object-contain mb-4" />
                    <h1 className="text-2xl font-bold text-white">Manager Access</h1>
                    <p className="text-slate-400 text-sm mt-1">
                        {mode === 'pin' ? 'Enter access PIN' : 'Login with Password'}
                    </p>
                </div>

                <AnimatePresence mode="wait">
                    {mode === 'pin' ? (
                        <motion.div
                            key="pin"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="w-full flex flex-col items-center"
                        >
                            {/* Visible PIN Display */}
                            <div className="flex gap-3 mb-8">
                                {[...Array(6)].map((_, i) => (
                                    <div
                                        key={i}
                                        className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${i < pin.length
                                                ? 'border-primary bg-primary/20 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                                                : 'border-slate-700 bg-slate-800/50 text-slate-500'
                                            }`}
                                    >
                                        {pin[i] || ''}
                                    </div>
                                ))}
                            </div>

                            {/* Numpad */}
                            <div className="grid grid-cols-3 gap-4 w-full max-w-[280px] mb-6">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                                    <button
                                        key={num}
                                        onClick={() => handlePinParams(num)}
                                        disabled={loading}
                                        className="h-16 w-16 rounded-full bg-white/5 hover:bg-white/10 text-xl font-bold text-white transition-colors flex items-center justify-center mx-auto hover:scale-105 active:scale-95"
                                    >
                                        {num}
                                    </button>
                                ))}
                                <div />
                                <button
                                    onClick={() => handlePinParams(0)}
                                    disabled={loading}
                                    className="h-16 w-16 rounded-full bg-white/5 hover:bg-white/10 text-xl font-bold text-white transition-colors flex items-center justify-center mx-auto hover:scale-105 active:scale-95"
                                >
                                    0
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={loading}
                                    className="h-16 w-16 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-colors flex items-center justify-center mx-auto"
                                >
                                    <Delete size={24} />
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="password"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="w-full space-y-4"
                        >
                            <form onSubmit={handlePasswordLogin} className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1.5">Email Address</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            className="glass-input pl-10 w-full"
                                            placeholder="admin@sportstech.com"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1.5">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="password"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            className="glass-input pl-10 w-full"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>
                                <button type="submit" disabled={loading} className="btn-primary w-full py-3 shadow-lg shadow-primary/20">
                                    Sign In
                                </button>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Switch */}
                <div className="mt-6 pt-6 border-t border-white/5 w-full flex justify-center">
                    <button
                        onClick={() => {
                            setMode(mode === 'pin' ? 'password' : 'pin');
                            setPin('');
                            setEmail('');
                            setPassword('');
                        }}
                        className="text-slate-400 hover:text-white text-sm flex items-center gap-2 transition-colors"
                    >
                        {mode === 'pin' ? (
                            <>
                                <KeyRound size={16} /> Login using Password
                            </>
                        ) : (
                            <>
                                <ArrowLeft size={16} /> Back to PIN Access
                            </>
                        )}
                    </button>
                </div>

                {loading && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-2xl z-20">
                        <Loader2 className="animate-spin text-primary" size={48} />
                    </div>
                )}
            </motion.div>
        </div>
    );
}
