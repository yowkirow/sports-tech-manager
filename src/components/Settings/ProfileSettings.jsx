import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import { User, Lock, Save, LogOut, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ProfileSettings({ user, onLogout }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);

    // Profile State
    const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');

    // Security State
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    useEffect(() => {
        if (user?.user_metadata?.full_name) {
            setFullName(user.user_metadata.full_name);
        }
    }, [user]);

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                data: { full_name: fullName }
            });
            if (error) throw error;
            showToast('Profile updated!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Failed to update profile', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleChangePin = async (e) => {
        e.preventDefault();
        if (newPin.length < 4) return showToast('PIN must be at least 4 digits', 'error');
        if (newPin !== confirmPin) return showToast('PINs do not match', 'error');

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: newPin
            });
            if (error) throw error;
            showToast('PIN updated successfully!', 'success');
            setNewPin('');
            setConfirmPin('');
        } catch (error) {
            console.error(error);
            showToast('Failed to update PIN', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-1">Settings</h2>
                    <p className="text-slate-400">Manage your account preferences</p>
                </div>
                <button
                    onClick={onLogout}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/20 transition-colors"
                >
                    <LogOut size={18} /> Sign Out
                </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Profile Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card space-y-6"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                            <User size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white">Profile Information</h3>
                    </div>

                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Display Name</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="e.g. Juan Dela Cruz"
                                className="glass-input w-full"
                            />
                            <p className="text-xs text-slate-500 mt-2">This name will be displayed in the sidebar.</p>
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={loading} className="btn-primary w-full">
                                <Save size={18} /> Save Changes
                            </button>
                        </div>
                    </form>
                </motion.div>

                {/* Security Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="glass-card space-y-6"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg">
                            <Shield size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white">Security</h3>
                    </div>

                    <form onSubmit={handleChangePin} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">New PIN / Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="password"
                                    value={newPin}
                                    onChange={(e) => setNewPin(e.target.value)}
                                    placeholder="Enter new 4-6 digit PIN"
                                    className="glass-input w-full pl-10"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Confirm New PIN</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="password"
                                    value={confirmPin}
                                    onChange={(e) => setConfirmPin(e.target.value)}
                                    placeholder="Confirm new PIN"
                                    className="glass-input w-full pl-10"
                                />
                            </div>
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={loading} className="btn-primary w-full bg-gradient-to-r from-purple-600 to-indigo-600">
                                <Save size={18} /> Update PIN
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>

            <div className="text-center text-slate-500 text-sm mt-8">
                <p>Logged in as: <span className="text-white font-mono">{user?.email}</span></p>
            </div>
        </div>
    );
}
