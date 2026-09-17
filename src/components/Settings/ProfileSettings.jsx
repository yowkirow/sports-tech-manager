import React, { useState, useEffect } from 'react';
import { api, apiRequest } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { User, Lock, Save, LogOut, Shield, MessageSquare, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import ActivityLogViewer from './ActivityLogViewer';
import ColorSettings from './ColorSettings';
import BrandSettings from './BrandSettings';
import ExpenseCategorySettings from './ExpenseCategorySettings';

export default function ProfileSettings({ user, onLogout, onProfileChange, transactions = [], onAddTransaction }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);

    const userRole = user?.user_metadata?.role;
    const isAdmin = userRole === 'owner';

    // Profile State
    const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');

    // TextBee State
    const [textbeeApiKey, setTextbeeApiKey] = useState('');
    const [textbeeDeviceId, setTextbeeDeviceId] = useState('');
    const [smsConfigured, setSmsConfigured] = useState(false);
    const [smsLoaded, setSmsLoaded] = useState(false);
    const [smsError, setSmsError] = useState(null);
    const [smsAttempt, setSmsAttempt] = useState(0);
    const [enableSmsNotifications, setEnableSmsNotifications] = useState(false);
    const [enableTrackingSms, setEnableTrackingSms] = useState(false);
    const [trackingSmsTemplate, setTrackingSmsTemplate] = useState('Hi {customerName}, your SportsTech order is on its way! 🚀 Track here: {trackingLink}');
    const [testRecipient, setTestRecipient] = useState('');

    useEffect(() => {
        setFullName(user?.user_metadata?.full_name || '');
    }, [user?.user_metadata?.full_name]);

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        setSmsError(null);
        setSmsLoaded(false);
        apiRequest('/api/settings/sms').then(settings => {
            if (!active) return;
            setSmsConfigured(settings.configured === true);
            setTextbeeDeviceId(settings.deviceId || '');
            setEnableSmsNotifications(settings.enableSmsNotifications === true);
            setEnableTrackingSms(settings.enableTrackingSms === true);
            setTrackingSmsTemplate(settings.trackingSmsTemplate || '');
            setSmsLoaded(true);
        }).catch(error => {
            if (active) setSmsError(error.message);
        });
        return () => { active = false; };
    }, [isAdmin, smsAttempt]);

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { profile } = await api.updateProfile({ full_name: fullName });
            onProfileChange?.(profile);

            showToast('Profile updated!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Failed to update profile', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveTextBeeSettings = async () => {
        setLoading(true);
        try {
            const settings = await apiRequest('/api/settings/sms', {
                method: 'PATCH',
                body: {
                    ...(textbeeApiKey.trim() ? { apiKey: textbeeApiKey.trim() } : {}),
                    deviceId: textbeeDeviceId,
                    enableSmsNotifications,
                    enableTrackingSms,
                    trackingSmsTemplate
                }
            });
            setSmsConfigured(settings.configured === true);
            setTextbeeApiKey('');
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
            await api.sendSms({
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

                {/* Access session */}
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
                            <h3 className="text-xl font-bold text-white">Secure Access</h3>
                            <p className="text-xs text-slate-400">Managed by Cloudflare Access</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Sign-in and verification are handled outside this app. Local passwords and quick PINs are no longer used.</p>
                        <button onClick={onLogout} className="btn-primary w-full">
                            <Lock size={18} /> Lock and sign out
                        </button>
                    </div>
                </motion.div>

                {/* TextBee Gateway Section */}
                {isAdmin && (
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

                        {smsError && <div role="alert" className="text-sm text-red-300">
                            {smsError}
                            <button type="button" onClick={() => setSmsAttempt(value => value + 1)} className="btn-secondary ml-3">Retry</button>
                        </div>}
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="sms-api-key" className="text-xs font-bold text-slate-500 uppercase block mb-2">Replacement API Key</label>
                                    <input
                                        id="sms-api-key"
                                        type="password"
                                        autoComplete="new-password"
                                        value={textbeeApiKey}
                                        onChange={(e) => setTextbeeApiKey(e.target.value)}
                                        placeholder={smsConfigured ? 'Configured — leave blank to keep' : 'Enter a new API key'}
                                        className="glass-input w-full"
                                    />
                                    <p className="text-xs text-slate-400 mt-2">The saved key is never returned to this browser. Save changes before sending a test.</p>
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
                                                {['{customerName}', '{trackingNumber}', '{trackingLink}', '{orderId}'].map(tag => (
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
                                    disabled={loading || !smsLoaded}
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
                                    disabled={loading || !smsLoaded || !smsConfigured || !textbeeDeviceId}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send size={18} /> Send Test SMS
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

            </div>



            {/* AUDIT & DATA MANAGEMENT */}
            {isAdmin && (
                <div className="space-y-8 pt-8 border-t border-white/5">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                    >
                        <ColorSettings
                            transactions={transactions}
                            onAddTransaction={onAddTransaction}
                        />
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        <BrandSettings
                            transactions={transactions}
                            onAddTransaction={onAddTransaction}
                        />
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                    >
                        <ExpenseCategorySettings />
                    </motion.div>

                    {/* Audit Logs Section */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                    >
                        <ActivityLogViewer user={user} userRole={userRole} />
                    </motion.div>
                </div>
            )}

            <div className="text-center text-slate-500 text-sm mt-8">
                <p>Logged in as: <span className="text-white font-mono">{user?.email}</span></p>
            </div>
        </div >
    );
}
