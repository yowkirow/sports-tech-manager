import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

const printQueueEnabled = import.meta.env.VITE_PRINT_QUEUE_ENABLED === 'true';
const SIGN_IN_URL = 'https://www.sportstechph.store/admin';

export const ROLES = {
    owner: { label: 'Owner', detail: 'Everything: sales, money, stock, orders, team and settings.' },
    reseller: { label: 'Reseller', detail: 'POS at the reseller price, and only their own orders.' },
    print_operator: {
        label: 'Print staff',
        detail: printQueueEnabled
            ? 'Only the print jobs you release. No customer or money details.'
            : 'Only the print jobs you release. The print queue is off, so they cannot start yet.'
    }
};

export function inviteMessage(member) {
    const greeting = member.name ? `Hi ${member.name.split(' ')[0]}, you` : 'You';
    return `${greeting} now have access to SportsTech.\n\n1. Open ${SIGN_IN_URL}\n2. Enter ${member.email} and type the code we email you.\n3. Create your own PIN. You will use it to open the app.`;
}

function statusOf(member) {
    if (!member.active) return { label: 'No access', tone: 'border-line text-ink-3' };
    if (!member.signedIn) return { label: 'Invited, not signed in yet', tone: 'border-amber-500/40 text-amber-200' };
    if (!member.hasPin) return { label: 'Signed in, no PIN yet', tone: 'border-amber-500/40 text-amber-200' };
    return { label: 'Active', tone: 'border-emerald-500/40 text-emerald-300' };
}

function CopyInvite({ member }) {
    const { showToast } = useToast();
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(inviteMessage(member));
            showToast('Sign-in instructions copied. Send them by chat or text.', 'success');
        } catch {
            showToast('Copy failed. Select the message and copy it instead.', 'error');
        }
    };
    return <button type="button" onClick={copy} className="btn-secondary min-h-10 px-4 py-2 text-sm"><Copy size={16} aria-hidden="true" /> Copy sign-in steps</button>;
}

export default function TeamSettings({ currentUserId }) {
    const { showToast } = useToast();
    const readOnly = useReadOnly();
    const [members, setMembers] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [form, setForm] = useState({ name: '', email: '', role: 'reseller' });
    const [busy, setBusy] = useState(false);
    const [invited, setInvited] = useState(null);

    const load = useCallback(async () => {
        setLoadError(null);
        try { setMembers((await apiRequest('/api/team')).members); }
        catch (error) { setLoadError(error.message); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const run = async (path, method, body, success) => {
        setBusy(true);
        try {
            const result = await apiRequest(path, { method, body: { ...body, requestId: crypto.randomUUID() } });
            if (success) showToast(success, 'success');
            await load();
            return result;
        } catch (error) {
            showToast(error.message, 'error');
            return null;
        } finally {
            setBusy(false);
        }
    };

    const invite = async event => {
        event.preventDefault();
        const result = await run('/api/team', 'POST', { email: form.email.trim(), name: form.name.trim(), role: form.role });
        if (result?.member) { setInvited(result.member); setForm({ name: '', email: '', role: form.role }); }
    };

    const setRole = (member, role) => {
        if (role === member.role) return;
        if (role === 'owner' && !window.confirm(`Give ${member.name || member.email} full owner access, including money and team settings?`)) return;
        void run(`/api/team/${encodeURIComponent(member.id)}`, 'PATCH', { role }, `${member.name || member.email} is now ${ROLES[role].label}.`);
    };
    const setActive = member => {
        if (member.active && !window.confirm(`Remove access for ${member.name || member.email}? They are signed out right away. Their past sales stay.`)) return;
        void run(`/api/team/${encodeURIComponent(member.id)}`, 'PATCH', { active: !member.active },
            member.active ? 'Access removed.' : 'Access restored.');
    };
    const resetPin = member => {
        if (!window.confirm(`Reset the PIN for ${member.name || member.email}? They will create a new PIN the next time they open the app.`)) return;
        void run(`/api/team/${encodeURIComponent(member.id)}/reset-pin`, 'POST', {}, 'PIN reset. They will create a new one next time.');
    };
    const disabled = busy || readOnly;

    return (
        <section className="surface space-y-5 p-5 sm:p-6 md:col-span-2" aria-labelledby="team-title">
            <div className="flex items-start gap-3 border-b border-line pb-4">
                <Users size={22} aria-hidden="true" className="mt-0.5 text-ink-3" />
                <div>
                    <h3 id="team-title" className="section-title">Team</h3>
                    <p className="mt-1 text-xs text-ink-2">Invite people by email and choose what they can open.</p>
                </div>
            </div>

            <form onSubmit={invite} className="grid gap-4 sm:grid-cols-2" aria-labelledby="invite-title">
                <h4 id="invite-title" className="text-sm font-semibold text-ink sm:col-span-2">Invite someone</h4>
                <div>
                    <label htmlFor="team-name" className="field-label">Name</label>
                    <input id="team-name" value={form.name} maxLength={80} autoComplete="off" disabled={disabled}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="field" />
                </div>
                <div>
                    <label htmlFor="team-email" className="field-label">Their email</label>
                    <input id="team-email" type="email" required value={form.email} maxLength={254} autoComplete="off" disabled={disabled}
                        onChange={event => setForm(current => ({ ...current, email: event.target.value }))} className="field" />
                </div>
                <fieldset className="sm:col-span-2" disabled={disabled}>
                    <legend className="field-label">What they can do</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {Object.entries(ROLES).map(([value, role]) => (
                            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${form.role === value ? 'border-ink bg-raised' : 'border-line hover:border-slate-600'}`}>
                                <input type="radio" name="team-role" value={value} checked={form.role === value}
                                    onChange={() => setForm(current => ({ ...current, role: value }))} className="mt-1 size-4 accent-primary" />
                                <span>
                                    <span className="block text-sm font-semibold text-ink">{role.label}</span>
                                    <span className="mt-0.5 block text-xs text-ink-2">{role.detail}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div className="sm:col-span-2">
                    <button type="submit" disabled={disabled || !form.email.trim()} title={readOnly ? READ_ONLY_HINT : undefined} className="btn-primary w-full sm:w-auto">
                        <UserPlus size={18} aria-hidden="true" /> {busy ? 'Adding…' : 'Add to team'}
                    </button>
                </div>
            </form>

            {invited && (
                <div role="status" className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                    <p className="text-sm font-semibold text-emerald-100">{invited.name || invited.email} was added as {ROLES[invited.role]?.label}.</p>
                    <p className="text-sm text-ink-2">Send them these steps. No email is sent from the app.</p>
                    <pre className="whitespace-pre-wrap rounded-lg border border-line bg-ground p-3 font-sans text-sm text-ink">{inviteMessage(invited)}</pre>
                    <div className="flex flex-wrap items-center gap-3">
                        <CopyInvite member={invited} />
                        <button type="button" onClick={() => setInvited(null)} className="btn-ghost text-sm">Done</button>
                    </div>
                    <p className="text-xs text-ink-3">If their code never arrives, their email still needs to be allowed in Cloudflare Access.</p>
                </div>
            )}

            <div>
                <h4 className="mb-2 text-sm font-semibold text-ink">People with access</h4>
                {loadError && (
                    <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                        {loadError}
                        <button type="button" onClick={load} className="btn-secondary ml-3 min-h-10 px-4 py-2">Retry</button>
                    </div>
                )}
                {!members && !loadError && <p role="status" className="text-sm text-ink-2">Loading team…</p>}
                {members && (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                        {members.map(member => {
                            const self = member.id === currentUserId;
                            const status = statusOf(member);
                            const printStaff = member.role === 'print_operator';
                            return (
                                <li key={member.id} className={`flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between ${member.active ? '' : 'opacity-70'}`}>
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-ink">{member.name || member.email}{self && <span className="ml-2 text-xs font-normal text-ink-3">(you)</span>}</p>
                                        {member.name && <p className="truncate text-sm text-ink-2">{member.email}</p>}
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className="badge border-line text-ink-2">{ROLES[member.role]?.label || member.role}</span>
                                            <span className={`badge ${status.tone}`}>{status.label}</span>
                                        </div>
                                    </div>
                                    {!self && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            {!printStaff && member.active && (
                                                <>
                                                    <label htmlFor={`role-${member.id}`} className="sr-only">Role for {member.name || member.email}</label>
                                                    <select id={`role-${member.id}`} value={member.role} disabled={disabled}
                                                        onChange={event => setRole(member, event.target.value)} className="field min-h-10 w-auto py-2 text-sm">
                                                        <option value="owner">Owner</option>
                                                        <option value="reseller">Reseller</option>
                                                    </select>
                                                </>
                                            )}
                                            {member.active && !member.signedIn && <CopyInvite member={member} />}
                                            {member.active && member.hasPin && (
                                                <button type="button" onClick={() => resetPin(member)} disabled={disabled} title={readOnly ? READ_ONLY_HINT : undefined}
                                                    className="btn-ghost min-h-10 px-3 py-2 text-sm"><KeyRound size={16} aria-hidden="true" /> Reset PIN</button>
                                            )}
                                            <button type="button" onClick={() => setActive(member)} disabled={disabled} title={readOnly ? READ_ONLY_HINT : undefined}
                                                className={`${member.active ? 'btn-danger' : 'btn-success'} min-h-10 px-4 py-2 text-sm`}>
                                                {member.active ? <><UserX size={16} aria-hidden="true" /> Remove access</> : <><UserCheck size={16} aria-hidden="true" /> Restore access</>}
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
}
