import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import { User, Lock, Save, LogOut, Shield, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import ActivityLogViewer from './ActivityLogViewer';

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
        const passwordToSet = confirmPin; // Using confirmPin state for password input
        if (passwordToSet.length < 6) return showToast('Password must be at least 6 characters', 'error');

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: passwordToSet
            });
            if (error) throw error;
            showToast('Password updated successfully!', 'success');
            setConfirmPin('');
        } catch (error) {
            console.error(error);
            showToast('Failed to update password', 'error');
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

                {/* Security Section - Quick PIN */}
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
                        <div>
                            <h3 className="text-xl font-bold text-white">Quick Access PIN</h3>
                            <p className="text-xs text-slate-400">Used for Lock Screen only (Metadata)</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Set Quick PIN (4-6 digits)</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="password"
                                    value={newPin}
                                    onChange={(e) => setNewPin(e.target.value)}
                                    placeholder="Enter Lock Screen PIN"
                                    className="glass-input w-full pl-10"
                                />
                            </div>
                        </div>

                        {/* Sync Checkbox */}
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                            <input
                                type="checkbox"
                                id="syncPassword"
                                className="mt-1"
                                defaultChecked={true}
                                onChange={(e) => {
                                    // Make this accessible to the save handler
                                    window.syncPassword = e.target.checked;
                                }}
                            />
                            <label htmlFor="syncPassword" className="text-sm text-orange-200 cursor-pointer">
                                <strong>Also use as Login Password</strong>
                                <p className="text-xs text-orange-200/70 mt-0.5">Check this if you want to use this PIN to log in from the main screen.</p>
                            </label>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={async () => {
                                    if (newPin.length < 4) return showToast('PIN must be at least 4 digits', 'error');
                                    setLoading(true);
                                    try {
                                        const updates = {
                                            data: { pos_pin: newPin }
                                        };
                                        const sync = document.getElementById('syncPassword')?.checked;

                                        if (sync) {
                                            updates.password = newPin;
                                        }

                                        const { error } = await supabase.auth.updateUser(updates);

                                        if (error) throw error;
                                        showToast(sync ? 'PIN & Password updated!' : 'Quick PIN updated!', 'success');
                                        setNewPin('');
                                    } catch (err) {
                                        console.error(err);
                                        showToast('Failed to update PIN', 'error');
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                disabled={loading}
                                className="btn-primary w-full bg-gradient-to-r from-purple-600 to-indigo-600"
                            >
                                <Save size={18} /> Save PIN
                            </button>
                        </div>
                    </div>
                </motion.div>

                {/* Password Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="glass-card space-y-6"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                            <Lock size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Account Password</h3>
                            <p className="text-xs text-slate-400">Main login credentials</p>
                        </div>
                    </div>

                    <form onSubmit={handleChangePin} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-2">New Password</label>
                            <input
                                type="password"
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value)}
                                placeholder="Enter new password"
                                className="glass-input w-full"
                            />
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={loading} className="btn-primary w-full bg-emerald-600 hover:bg-emerald-500">
                                <Save size={18} /> Update Password
                            </button>
                        </div>
                    </form>
                </motion.div>
            </motion.div>
        </div>
            
            {/* Twilio Test Section */ }
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card space-y-6"
    >
        <div className="flex items-center gap-3 border-b border-white/5 pb-4">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                <MessageSquare size={24} />
            </div>
            <div>
                <h3 className="text-xl font-bold text-white">Twilio Integration Test</h3>
                <p className="text-xs text-slate-400">Send a test SMS to verify your configuration</p>
            </div>

            <div className="flex gap-4 items-end">
                <div className="flex-1">
                    <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Target Phone Number</label>
                    <input
                        type="text"
                        id="testPhoneInput"
                        placeholder="+639..."
                        className="glass-input w-full"
                    />
                </div>
                <button
                    onClick={async () => {
                        const phone = document.getElementById('testPhoneInput').value;
                        if (!phone) return showToast('Enter a phone number', 'error');
                        setLoading(true);
                        try {
                            const { error } = await supabase.functions.invoke('send-tracking-sms', {
                                body: {
                                    phoneNumber: phone,
                                    customerName: 'Test User',
                                    trackingNumber: 'TEST-12345',
                                    orderItems: '1x Test Shirt'
                                }
                            });
                            if (error) throw error;
                            showToast('Test SMS Sent!', 'success');
                        } catch (err) {
                            console.error(err);
                            showToast('Failed to send SMS', 'error');
                        } finally {
                            setLoading(false);
                        }
                    }}
                    disabled={loading}
                    className="btn-primary bg-indigo-600 hover:bg-indigo-500 mb-0.5"
                >
                    Send Test SMS
                </button>
            </div>
    </motion.div>

    {/* Audit Logs Section */ }
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="pt-8 border-t border-white/5"
            >
                <ActivityLogViewer />
            </motion.div>

            <div className="text-center text-slate-500 text-sm mt-8">
                <p>Logged in as: <span className="text-white font-mono">{user?.email}</span></p>
            </div>
        </div >
    );
}
