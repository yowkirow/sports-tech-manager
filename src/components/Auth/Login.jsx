import React from 'react';
import { Lock, LogOut } from 'lucide-react';
import { api } from '../../lib/apiClient';
import Logo from '../ui/Logo';

export default function Login({ error, onRetry, denied = false }) {
    return (
        <div className="fixed inset-0 grid bg-ground text-ink lg:grid-cols-2">
            <div className="relative hidden overflow-hidden border-r border-line lg:block" aria-hidden="true">
                <img src="/hero-court.jpg" alt="" className="size-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-ground via-ground/20 to-transparent" />
                <p className="display absolute bottom-10 left-10 max-w-[12ch] text-6xl italic">SportsTech Manager</p>
            </div>
            <main className="flex items-center justify-center overflow-y-auto p-6">
                <div className="w-full max-w-sm">
                    <Logo className="h-12" />
                    <h1 className="display mt-10 text-5xl">Manager access</h1>
                    <p className="mt-3 text-ink-2">
                        {denied ? 'Your account does not have access to this workspace. Contact the owner.' : 'Sign in securely with your approved work email.'}
                    </p>
                    {error && <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
                    <div className="mt-8 space-y-3">
                        {!denied && <a href="/admin" className="btn-primary h-12 w-full text-base"><Lock size={18} aria-hidden="true" /> Continue to secure sign in</a>}
                        {onRetry && <button type="button" onClick={onRetry} className="btn-secondary h-12 w-full">Retry account check</button>}
                    </div>
                    <div className="mt-8 border-t border-line pt-6">
                        <button type="button" onClick={api.logout} className="btn-ghost -ml-3 text-sm">
                            <LogOut size={16} aria-hidden="true" /> Sign out or use another account
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
