import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import { User, Lock, Save, LogOut, Shield, MessageSquare, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import ActivityLogViewer from './ActivityLogViewer';
import { sendSMS } from '../../lib/textbee';

export default function ProfileSettings({ user, onLogout }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);

    // Profile State
    const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');

    // Security State
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    // TextBee State
    const [textbeeApiKey, setTextbeeApiKey] = useState(user?.user_metadata?.textbee_api_key || '');
    const [textbeeDeviceId, setTextbeeDeviceId] = useState(user?.user_metadata?.textbee_device_id || '');
    const [enableSmsNotifications, setEnableSmsNotifications] = useState(user?.user_metadata?.enable_sms_notifications || false);
    const [enableTrackingSms, setEnableTrackingSms] = useState(user?.user_metadata?.enable_tracking_sms || false);
    const [trackingSmsTemplate, setTrackingSmsTemplate] = useState(user?.user_metadata?.tracking_sms_template || 'Hi {customerName}, your SportsTech order is on its way! 🚀 Tracking Details: {trackingNumber}');
    const [testRecipient, setTestRecipient] = useState('');

    useEffect(() => {
        if (user?.user_metadata) {
            if (user.user_metadata.full_name) setFullName(user.user_metadata.full_name);
            if (user.user_metadata.textbee_api_key) setTextbeeApiKey(user.user_metadata.textbee_api_key);
            if (user.user_metadata.textbee_device_id) setTextbeeDeviceId(user.user_metadata.textbee_device_id);
            if (user.user_metadata.enable_sms_notifications !== undefined) setEnableSmsNotifications(user.user_metadata.enable_sms_notifications);
            if (user.user_metadata.enable_tracking_sms !== undefined) setEnableTrackingSms(user.user_metadata.enable_tracking_sms);
            if (user.user_metadata.tracking_sms_template) setTrackingSmsTemplate(user.user_metadata.tracking_sms_template);
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

            // Sync to Public Admin Directory (so Activity Logs show names)
            if (user?.email) {
                await supabase.from('admin_directory').upsert({
                    email: user.email,
                    name: fullName
                }, { onConflict: 'email' });
            }

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

    const handleSaveTextBeeSettings = async () => {
        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                data: {
                    textbee_api_key: textbeeApiKey,
                    textbee_device_id: textbeeDeviceId,
                    enable_sms_notifications: enableSmsNotifications,
                    enable_tracking_sms: enableTrackingSms,
                    tracking_sms_template: trackingSmsTemplate
                }
            });
            if (error) throw error;
            showToast('SMS Gateway settings updated!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Failed to update settings', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSendTestSms = async () => {
        if (!testRecipient) return showToast('Please enter a recipient number', 'error');
        setLoading(true);
        try {
            await sendSMS({
                apiKey: textbeeApiKey,
                deviceId: textbeeDeviceId,
                recipient: testRecipient,
                message: 'Sports-Tech: This is a test SMS from your manager app! 🚀'
            });
            showToast('Test SMS sent successfully!', 'success');
        } catch (error) {
            console.error(error);
            showToast(`Failed to send SMS: ${error.message}`, 'error');
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

                {/* TextBee Gateway Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="glass-card md:col-span-2 space-y-6"
                >
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 bg-orange-500/20 text-orange-400 rounded-lg">
                            <MessageSquare size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">TextBee SMS Gateway</h3>
                            <p className="text-xs text-slate-400">Send automated notifications via textbee.dev</p>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">API Key</label>
                                <input
                                    type="password"
                                    value={textbeeApiKey}
                                    onChange={(e) => setTextbeeApiKey(e.target.value)}
                                    placeholder="your-textbee-api-key"
                                    className="glass-input w-full"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Device ID</label>
                                <input
                                    type="text"
                                    value={textbeeDeviceId}
                                    onChange={(e) => setTextbeeDeviceId(e.target.value)}
                                    placeholder="your-android-device-id"
                                    className="glass-input w-full"
                                />
                            </div>
                            <div className="flex items-center gap-2 py-2">
                                <input
                                    type="checkbox"
                                    id="enableSms"
                                    checked={enableSmsNotifications}
                                    onChange={(e) => setEnableSmsNotifications(e.target.checked)}
                                    className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary"
                                />
                                <label htmlFor="enableSms" className="text-sm text-slate-300 cursor-pointer">
                                    Enable SMS Notifications for Sales
                                </label>
                            </div>

                            <div className="space-y-4 pt-2 border-t border-white/5">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="enableTrackingSms"
                                        checked={enableTrackingSms}
                                        onChange={(e) => setEnableTrackingSms(e.target.checked)}
                                        className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary"
                                    />
                                    <label htmlFor="enableTrackingSms" className="text-sm text-slate-300 cursor-pointer">
                                        Enable Tracking SMS for Orders
                                    </label>
                                </div>

                                {enableTrackingSms && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="space-y-2"
                                    >
                                        <label className="text-[10px] font-bold text-slate-500 uppercase block">Tracking SMS Template</label>
                                        <textarea
                                            value={trackingSmsTemplate}
                                            onChange={(e) => setTrackingSmsTemplate(e.target.value)}
                                            rows={3}
                                            placeholder="Hi {customerName}, your order has been shipped! Tracking: {trackingNumber}"
                                            className="glass-input w-full text-sm resize-none"
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            {['{customerName}', '{trackingNumber}', '{orderId}'].map(tag => (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    onClick={() => setTrackingSmsTemplate(prev => prev + tag)}
                                                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                                                >
                                                    {tag}
                                                </button>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </div>

                            <button
                                onClick={handleSaveTextBeeSettings}
                                disabled={loading}
                                className="btn-primary w-full bg-orange-600 hover:bg-orange-500"
                            >
                                <Save size={18} /> Save Settings
                            </button>
                        </div>

                        <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/5">
                            <h4 className="text-sm font-bold text-white">Verification</h4>
                            <p className="text-xs text-slate-400">Send a test SMS to verify your connection.</p>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Test Recipient Number</label>
                                <input
                                    type="text"
                                    value={testRecipient}
                                    onChange={(e) => setTestRecipient(e.target.value)}
                                    placeholder="+639123456789"
                                    className="glass-input w-full"
                                />
                            </div>
                            <button
                                onClick={handleSendTestSms}
                                disabled={loading || !textbeeApiKey || !textbeeDeviceId}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send size={18} /> Send Test SMS
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>



            {/* Audit Logs Section */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="pt-8 border-t border-white/5"
            >
                <ActivityLogViewer user={user} userRole={user?.user_metadata?.role || 'admin'} />
            </motion.div>

            <div className="text-center text-slate-500 text-sm mt-8">
                <p>Logged in as: <span className="text-white font-mono">{user?.email}</span></p>
            </div>
        </div >
    );
}
