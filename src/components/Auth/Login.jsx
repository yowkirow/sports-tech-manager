import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { motion } from 'framer-motion';
import { Lock, Loader2, User, ChevronRight, Delete } from 'lucide-react';
import { useToast } from '../ui/Toast';

const SYSTEM_EMAIL = 'manager@sportstech.com'; // Fixed system email

export default function Login() {
    const { showToast } = useToast();
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);

    const handlePinParams = (num) => {
        if (pin.length < 6) {
            setPin(prev => prev + num);
        }
    };

    const handleDelete = () => {
        setPin(prev => prev.slice(0, -1));
    };

    const handleLogin = async (e) => {
        if (e) e.preventDefault();
        if (pin.length < 4) return showToast('PIN must be at least 4 digits', 'error');

        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: SYSTEM_EMAIL,
                password: pin,
            });
            if (error) throw error;
            showToast('Welcome back!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Invalid PIN', 'error');
            setPin(''); // Clear on error
        } finally {
            setLoading(false);
        }
    };

    // Auto-submit when PIN reaches 6 digits (optional, but nice UX)
    React.useEffect(() => {
        if (pin.length === 6) {
            handleLogin();
        }
    }, [pin]);

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900 p-4 font-sans selection:bg-primary/30">
            {/* Background Effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[120px]" />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel w-full max-w-sm p-8 relative z-10 flex flex-col items-center"
            >
                <div className="mb-8 flex flex-col items-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4">
                        <Lock className="text-white" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Manager Access</h1>
                    <p className="text-slate-400 text-sm mt-1">Enter access PIN</p>
                </div>

                {/* PIN Display */}
                <div className="flex gap-4 mb-8">
                    {[...Array(6)].map((_, i) => (
                        <div
                            key={i}
                            className={`w-3 h-3 rounded-full transition-all duration-300 ${i < pin.length ? 'bg-primary scale-125' : 'bg-slate-700'
                                }`}
                        />
                    ))}
                </div>

                {/* Numpad */}
                <div className="grid grid-cols-3 gap-4 w-full max-w-[280px] mb-6">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button
                            key={num}
                            onClick={() => handlePinParams(num)}
                            disabled={loading}
                            className="h-16 w-16 rounded-full bg-white/5 hover:bg-white/10 text-xl font-bold text-white transition-colors flex items-center justify-center mx-auto"
                        >
                            {num}
                        </button>
                    ))}
                    <div /> {/* Spacer */}
                    <button
                        onClick={() => handlePinParams(0)}
                        disabled={loading}
                        className="h-16 w-16 rounded-full bg-white/5 hover:bg-white/10 text-xl font-bold text-white transition-colors flex items-center justify-center mx-auto"
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

                {loading && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                        <Loader2 className="animate-spin text-primary" size={48} />
                    </div>
                )}

                <p className="text-xs text-slate-500 mt-4 text-center">
                    Using system account: <br /> manager@sportstech.com
                </p>

            </motion.div>
        </div>
    );
}
