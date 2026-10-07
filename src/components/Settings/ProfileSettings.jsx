import React, { useState, useEffect } from 'react';
import { api, apiRequest } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { User, Lock, Save, LogOut, Shield, MessageSquare, Send } from 'lucide-react';
import ActivityLogViewer from './ActivityLogViewer';
import ColorSettings from './ColorSettings';
import BrandSettings from './BrandSettings';
import ExpenseCategorySettings from './ExpenseCategorySettings';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

function ChangePinForm() {
    const { showToast } = useToast();
    const [form, setForm] = useState({ current: '', next: '', confirm: '' });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const set = key => event => setForm(current => ({ ...current, [key]: event.target.value.replace(/\D/g, '').slice(0, 6) }));
    const submit = async event => {
        event.preventDefault();
        if (form.next !== form.confirm) { setMessage('The new PINs do not match.'); return; }
        setBusy(true);
        setMessage(null);
        try {
            await api.pin.change(form.current, form.next);
            setForm({ current: '', next: '', confirm: '' });
            showToast('PIN changed. Other devices will ask for the new PIN.', 'success');
        } catch (error) {
            setMessage(error.code === 'pin_incorrect' ? 'Your current PIN is incorrect.'
                : error.code === 'pin_locked' ? 'Too many incorrect PINs. Try again later.' : error.message);
        } finally {
            setBusy(false);
        }
    };
    const field = (key, label) => (
        <div>
            <label htmlFor={`pin-${key}`} className="field-label">{label}</label>
            <input id={`pin-${key}`} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6}
                value={form[key]} onChange={set(key)} className="field tracking-[0.4em]" />
        </div>
    );
    return (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line p-4" aria-labelledby="change-pin-title">
            <h4 id="change-pin-title" className="text-sm font-semibold text-ink">Change PIN</h4>
            {field('current', 'Current PIN')}
            {field('next', 'New PIN (4–6 digits)')}
            {field('confirm', 'New PIN again')}
            {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
            <button type="submit" className="btn-secondary w-full"
                disabled={busy || form.current.length < 4 || form.next.length < 4 || form.confirm.length < 4}>
                {busy ? 'Saving…' : 'Change PIN'}
            </button>
        </form>
    );
}

export default function ProfileSettings({ user, onLogout, onProfileChange, transactions = [], onAddTransaction }) {
    const { showToast } = useToast();
    const readOnly = useReadOnly();
    const [loading, setLoading] = useState(false);

    const userRole = user?.user_metadata?.role;
    const isAdmin = userRole === 'owner';

    const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');

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
        <div className="mx-auto max-w-4xl space-y-6 pb-20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="section-title">Settings</h2>
                    <p className="mt-1 text-sm text-ink-2">Manage your account preferences</p>
                </div>
                <button type="button" onClick={onLogout} className="btn-danger">
                    <LogOut size={18} aria-hidden="true" /> Sign Out
                </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="profile-info-title">
                    <div className="flex items-start gap-3 border-b border-line pb-4">
                        <User size={22} aria-hidden="true" className="mt-0.5 text-ink-3" />
                        <h3 id="profile-info-title" className="section-title">Profile Information</h3>
                    </div>

                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div>
                            <label htmlFor="settings-display-name" className="field-label">Display Name</label>
                            <input
                                id="settings-display-name"
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="e.g. Juan Dela Cruz"
                                disabled={readOnly}
                                className="field"
                            />
                            <p className="mt-2 text-xs text-ink-2">This name will be displayed in the sidebar.</p>
                        </div>
                        <button type="submit" disabled={readOnly || loading} title={readOnly ? READ_ONLY_HINT : undefined} className="btn-primary w-full">
                            <Save size={18} aria-hidden="true" /> Save Changes
                        </button>
                    </form>
                </section>

                <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="secure-access-title">
                    <div className="flex items-start gap-3 border-b border-line pb-4">
                        <Shield size={22} aria-hidden="true" className="mt-0.5 text-ink-3" />
                        <div>
                            <h3 id="secure-access-title" className="section-title">Secure Access</h3>
                            <p className="mt-1 text-xs text-ink-2">Managed by Cloudflare Access</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm text-ink-2">
                            Each device stays signed in after you enter an emailed code. Your PIN opens the app,
                            and the app locks again after 12 hours or when you choose Lock.
                        </p>
                        <ChangePinForm />
                        <button type="button" onClick={onLogout} className="btn-danger w-full">
                            <Lock size={18} aria-hidden="true" /> Sign out of this device
                        </button>
                    </div>
                </section>

                {isAdmin && (
                    <section className="surface space-y-5 p-5 sm:p-6 md:col-span-2" aria-labelledby="textbee-title">
                        <div className="flex items-start gap-3 border-b border-line pb-4">
                            <MessageSquare size={22} aria-hidden="true" className="mt-0.5 text-ink-3" />
                            <div>
                                <h3 id="textbee-title" className="section-title">TextBee SMS Gateway</h3>
                                <p className="mt-1 text-xs text-ink-2">Send automated notifications via textbee.dev</p>
                            </div>
                        </div>

                        {smsError && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                            {smsError}
                            <button type="button" onClick={() => setSmsAttempt(value => value + 1)} className="btn-secondary ml-3 min-h-10 px-4 py-2">Retry</button>
                        </div>}
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="sms-api-key" className="field-label">Replacement API Key</label>
                                    <input
                                        id="sms-api-key"
                                        type="password"
                                        autoComplete="new-password"
                                        value={textbeeApiKey}
                                        onChange={(e) => setTextbeeApiKey(e.target.value)}
                                        placeholder={smsConfigured ? 'Configured — leave blank to keep' : 'Enter a new API key'}
                                        disabled={readOnly}
                                        className="field"
                                    />
                                    <p className="mt-2 text-xs text-ink-2">The saved key is never returned to this browser. Save changes before sending a test.</p>
                                </div>
                                <div>
                                    <label htmlFor="sms-device-id" className="field-label">Device ID</label>
                                    <input
                                        id="sms-device-id"
                                        type="text"
                                        value={textbeeDeviceId}
                                        onChange={(e) => setTextbeeDeviceId(e.target.value)}
                                        placeholder="your-android-device-id"
                                        disabled={readOnly}
                                        className="field"
                                    />
                                </div>
                                <div className="flex min-h-11 items-center gap-3">
                                    <input
                                        type="checkbox"
                                        id="enableSms"
                                        checked={enableSmsNotifications}
                                        onChange={(e) => setEnableSmsNotifications(e.target.checked)}
                                        disabled={readOnly}
                                        className="size-5 rounded border-line bg-raised text-primary"
                                    />
                                    <label htmlFor="enableSms" className="cursor-pointer text-sm text-ink-2">
                                        Enable SMS Notifications for Sales
                                    </label>
                                </div>

                                <div className="space-y-4 border-t border-line pt-4">
                                    <div className="flex min-h-11 items-center gap-3">
                                        <input
                                            type="checkbox"
                                            id="enableTrackingSms"
                                            checked={enableTrackingSms}
                                            onChange={(e) => setEnableTrackingSms(e.target.checked)}
                                            disabled={readOnly}
                                            className="size-5 rounded border-line bg-raised text-primary"
                                        />
                                        <label htmlFor="enableTrackingSms" className="cursor-pointer text-sm text-ink-2">
                                            Enable Tracking SMS for Orders
                                        </label>
                                    </div>

                                    {enableTrackingSms && (
                                        <div className="space-y-2">
                                            <label htmlFor="tracking-sms-template" className="field-label">Tracking SMS Template</label>
                                            <textarea
                                                id="tracking-sms-template"
                                                value={trackingSmsTemplate}
                                                onChange={(e) => setTrackingSmsTemplate(e.target.value)}
                                                rows={3}
                                                placeholder="Hi {customerName}, your order has been shipped! Tracking: {trackingNumber}"
                                                disabled={readOnly}
                                                className="field resize-none text-sm"
                                            />
                                            <div className="flex flex-wrap gap-2">
                                                {['{customerName}', '{trackingNumber}', '{trackingLink}', '{orderId}'].map(tag => (
                                                    <button
                                                        key={tag}
                                                        type="button"
                                                        onClick={() => setTrackingSmsTemplate(prev => prev + tag)}
                                                        disabled={readOnly}
                                                        title={readOnly ? READ_ONLY_HINT : undefined}
                                                        className="chip h-9 px-3 font-mono text-xs"
                                                    >
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={handleSaveTextBeeSettings}
                                    disabled={readOnly || loading || !smsLoaded}
                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                    className="btn-primary w-full"
                                >
                                    <Save size={18} aria-hidden="true" /> Save Settings
                                </button>
                            </div>

                            <div className="space-y-4 rounded-xl border border-line bg-raised p-4">
                                <h4 className="font-semibold text-ink">Verification</h4>
                                <p className="text-xs text-ink-2">Send a test SMS to verify your connection.</p>
                                <div>
                                    <label htmlFor="test-recipient-number" className="field-label">Test Recipient Number</label>
                                    <input
                                        id="test-recipient-number"
                                        type="text"
                                        value={testRecipient}
                                        onChange={(e) => setTestRecipient(e.target.value)}
                                        placeholder="+639123456789"
                                        disabled={readOnly}
                                        className="field"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSendTestSms}
                                    disabled={readOnly || loading || !smsLoaded || !smsConfigured || !textbeeDeviceId}
                                    title={readOnly ? READ_ONLY_HINT : undefined}
                                    className="btn-secondary w-full"
                                >
                                    <Send size={18} aria-hidden="true" /> Send Test SMS
                                </button>
                            </div>
                        </div>
                    </section>
                )}
            </div>

            {isAdmin && (
                <div className="space-y-6 border-t border-line pt-6">
                    <ColorSettings
                        transactions={transactions}
                        onAddTransaction={onAddTransaction}
                    />

                    <BrandSettings
                        transactions={transactions}
                        onAddTransaction={onAddTransaction}
                    />

                    <ExpenseCategorySettings />

                    <ActivityLogViewer user={user} userRole={userRole} />
                </div>
            )}

            <div className="text-center text-sm text-ink-2">
                <p>Logged in as: <span className="num font-semibold text-ink">{user?.email}</span></p>
            </div>
        </div>
    );
}
