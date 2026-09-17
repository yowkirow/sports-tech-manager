import React from 'react';
import { motion } from 'framer-motion';
import { Lock, LogOut } from 'lucide-react';
import { api } from '../../lib/apiClient';

export default function Login({ error, onRetry, denied = false }) {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900 p-4 font-sans selection:bg-primary/30">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel w-full max-w-sm p-8 relative z-10 flex flex-col items-center"
            >
                <div className="mb-6 flex flex-col items-center">
                    <img src="/logo.png" alt="SportsTech" className="h-24 w-auto object-contain mb-4" />
                    <h1 className="text-xl font-bold text-white">Manager Access</h1>
                    <p className="text-slate-400 text-sm mt-2 text-center">
                        {denied ? 'Your account does not have access to this workspace. Contact the owner.' : 'Sign in securely with your approved work email.'}
                    </p>
                </div>
                {error && <p role="alert" className="text-sm text-red-300 mb-4">{error}</p>}
                {!denied && <a href="/admin" className="btn-primary w-full py-3"><Lock size={18} /> Continue to secure sign in</a>}
                {onRetry && <button type="button" onClick={onRetry} className="btn-secondary w-full mt-3">Retry account check</button>}
                <div className="mt-6 pt-6 border-t border-white/5 w-full flex justify-center">
                    <button type="button" onClick={api.logout} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-2">
                        <LogOut size={16} /> Sign out / use another account
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
