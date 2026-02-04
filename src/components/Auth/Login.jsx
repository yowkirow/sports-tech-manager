import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Loader2, User, Delete, KeyRound, ArrowLeft, LogOut } from 'lucide-react';
import { useToast } from '../ui/Toast';

const ADMIN_ACCOUNTS = [
    { name: 'Manager', email: 'manager@sportstech.com' },
    { name: 'Admin 2', email: 'admin2@sportstech.com' }
];

export default function Login({ unlockMode = false, user = null, onUnlock, onLogout }) {
    const { showToast } = useToast();
    const [mode, setMode] = useState('pin'); // Default to PIN for everyone

    // PIN State (Unlock)
    const [pin, setPin] = useState('');

    // Password State (Login)
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

    const handleUnlock = async () => {
        if (pin.length < 4) return showToast('PIN must be at least 4 digits', 'error');
        setLoading(true);

        // Simulating a delay for effect
        setTimeout(async () => {
            const storedPin = user?.user_metadata?.pos_pin;

            if (storedPin && storedPin === pin) {
                showToast('Unlocked', 'success');
                if (onUnlock) onUnlock();
            } else {
                showToast('Invalid Quick PIN', 'error');
                setPin('');
            }
            setLoading(false);
        }, 500);
    };

    // Login with PIN (Tries specific admin emails)
    const handlePinLogin = async () => {
        if (pin.length < 4) return showToast('PIN must be at least 4 digits', 'error');
        setLoading(true);
        try {
            let success = false;
            for (const adminEmail of ADMIN_ACCOUNTS.map(a => a.email)) {
                const { error } = await supabase.auth.signInWithPassword({
                    email: adminEmail,
                    password: pin,
                });
                if (!error) {
                    success = true;
                    break;
                }
            }
            if (!success) throw new Error('Invalid PIN or Password');
            showToast('Welcome back!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Invalid PIN', 'error');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordLogin = async (e) => {
        e.preventDefault();
        if (!email || !password) return showToast('Please enter password', 'error');

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
        if (unlockMode && pin.length >= 4 && pin.length === (user?.user_metadata?.pos_pin?.length || 6)) {
            handleUnlock();
        } else if (!unlockMode && mode === 'pin' && pin.length === 6) {
            handlePinLogin();
        }
    }, [pin, unlockMode, user, mode, handleUnlock, handlePinLogin]);

    React.useEffect(() => {
        const handleKeyDown = (e) => {
            if (loading) return;
            if (mode === 'pin') {
                if (e.key >= '0' && e.key <= '9') handlePinParams(e.key);
                else if (e.key === 'Backspace') handleDelete();
                else if (e.key === 'Enter') unlockMode ? handleUnlock() : handlePinLogin();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [loading, pin, mode, unlockMode]);

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
                    <img src="/logo.png" alt="SportsTech" className="h-24 w-auto object-contain mb-4" />
                    <h1 className="text-xl font-bold text-white">{unlockMode ? `Welcome, ${user?.user_metadata?.full_name || 'Admin'}` : 'Manager Access'}</h1>
                    <p className="text-slate-400 text-sm mt-1">
                        {unlockMode ? 'Enter Quick PIN' : 'Sign in to continue'}
                    </p>
                </div>

                <AnimatePresence mode="wait">
                    {mode === 'password' && !unlockMode ? (
                        <motion.div
                            key="password"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="w-full space-y-4"
                        >
                            {/* User Selector */}
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                {ADMIN_ACCOUNTS.map(acc => (
                                    <button
                                        key={acc.email}
                                        onClick={() => setSelectedEmail(acc.email)}
                                        className={`p-3 rounded-xl border text-sm font-medium transition-all ${selectedEmail === acc.email
                                            ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                                            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                                            }`}
                                    >
                                        {acc.name}
                                    </button>
                                ))}
                            </div>

                            <form onSubmit={handlePasswordLogin} className="space-y-4">
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
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <button type="submit" disabled={loading} className="btn-primary w-full py-3 shadow-lg shadow-primary/20">
                                    Sign In
                                </button>
                            </form>
                        </motion.div>
                    ) : (
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
                    )}
                </AnimatePresence>

                {unlockMode ? (
                    <div className="mt-6 pt-6 border-t border-white/5 w-full flex justify-center">
                        <button
                            onClick={onLogout}
                            className="text-red-400 hover:text-red-300 text-sm flex items-center gap-2 transition-colors"
                        >
                            <LogOut size={16} /> Sign Out
                        </button>
                    </div>
                ) : (
                    <div className="mt-6 pt-6 border-t border-white/5 w-full flex justify-center">
                        <button
                            onClick={() => {
                                setMode(mode === 'pin' ? 'password' : 'pin');
                                setPin('');
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
                )}


                {loading && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-2xl z-20">
                        <Loader2 className="animate-spin text-primary" size={48} />
                    </div>
                )}
            </motion.div>
        </div>
    );
}
