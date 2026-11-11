import { useMemo, useState } from 'react';
import { CalendarX, Edit2, Plus, Repeat } from 'lucide-react';
import SubscriptionDialog from './SubscriptionDialog';
import { apiRequest } from '../../lib/apiClient';
import { useActivityLog } from '../../hooks/useActivityLog';
import { useToast } from '../ui/Toast';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import {
    formatDay, formatPeso, manilaToday, monthlyCost, nextChargeDay, readSubscription, RECURRING_EXPENSE, scheduleText
} from '../../lib/recurringExpenses';

const CLUB_SLUG = 'downtown-dinks';

/** The owner's subscriptions: each one's charges go into Expenses on their day (src/lib/recurringExpenses.js). */
export default function Subscriptions({ transactions, onAddTransaction, onUpdateTransaction, onDeleteTransaction, onChargesRecorded }) {
    const readOnly = useReadOnly();
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const [editing, setEditing] = useState(null);
    const today = manilaToday();
    const subscriptions = useMemo(() => transactions
        .filter(transaction => transaction.type === RECURRING_EXPENSE)
        .map(record => ({ record, subscription: readSubscription(record.details) }))
        .filter(item => item.subscription)
        .map(item => ({ ...item, next: nextChargeDay(item.subscription, today) }))
        .sort((a, b) => (a.next ?? '').localeCompare(b.next ?? '') || a.subscription.name.localeCompare(b.subscription.name)),
    [transactions, today]);
    const perMonth = monthlyCost(subscriptions.map(item => item.subscription));
    const spread = subscriptions.some(item => item.subscription.frequency === 'yearly');

    const add = async (subscription, due) => {
        // The draft's ID and date stay fixed while its dialog is open: a retry after a lost response
        // sends the same request and replays the first save, so the subscription (and every charge) is never doubled.
        const record = {
            ...editing.draft, type: RECURRING_EXPENSE, category: 'subscription', amount: 0,
            description: subscription.name, details: subscription
        };
        await onAddTransaction(record);
        void logActivity('Add Subscription', { name: subscription.name, amount: subscription.amount, frequency: subscription.frequency,
            startsOn: subscription.startsOn }, record.id);
        setEditing(null);
        if (!due) {
            showToast(`${subscription.name} added. The first charge goes into Expenses on ${formatDay(subscription.startsOn)}.`, 'success');
            return;
        }
        // The charges due now, instead of at the next nightly run; that run still records any this misses.
        try {
            await apiRequest('/api/recurring-expenses/charge', { method: 'POST', body: {} });
            await onChargesRecorded?.();
            showToast(`${subscription.name} added. ${due === 1 ? 'Its charge is' : `${due} charges are`} in Expenses.`, 'success');
        } catch {
            showToast(`${subscription.name} added. Its charges due so far go into Expenses tonight.`, 'info');
        }
    };
    const change = async (subscription) => {
        const { record } = editing;
        await onUpdateTransaction(record.id, { description: subscription.name, details: { ...record.details, ...subscription } });
        void logActivity('Update Subscription', { name: subscription.name, amount: subscription.amount }, record.id);
        setEditing(null);
        showToast(`${subscription.name} saved. Changes apply from the next charge.`, 'success');
    };
    const stop = async ({ record, subscription }) => {
        if (!window.confirm(`Stop ${subscription.name}? No new charges go into Expenses. Charges already there stay.`)) return;
        try {
            await onDeleteTransaction(record.id, true);
            void logActivity('Stop Subscription', { name: subscription.name }, record.id);
            showToast(`${subscription.name} stopped.`, 'success');
        } catch {
            // The workspace already showed why the change failed.
        }
    };

    return (
        <section className="surface overflow-hidden" aria-labelledby="subscriptions-title">
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                    <h2 id="subscriptions-title" className="section-title flex items-center gap-2">
                        <Repeat size={20} className="text-ink-3" aria-hidden="true" /> Subscriptions
                    </h2>
                    <p className="mt-1 text-sm text-ink-2">
                        {subscriptions.length
                            ? <><span className="num">{spread ? `About ${formatPeso(Math.round(perMonth))}` : formatPeso(Math.round(perMonth * 100) / 100)}</span> a month. Each charge goes into Expenses on its day.</>
                            : 'Each charge goes into Expenses on its day, so you don’t enter it by hand.'}
                    </p>
                </div>
                <button type="button" onClick={() => setEditing({ draft: { id: crypto.randomUUID(), date: new Date().toISOString() } })}
                    disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}
                    className="btn-secondary w-full whitespace-nowrap sm:w-auto">
                    <Plus size={16} aria-hidden="true" /> Add subscription
                </button>
            </div>

            {subscriptions.length === 0 ? (
                <p className="px-4 py-5 text-sm text-ink-2 sm:px-5">No subscriptions yet. Add the software, rent or anything else you pay every month or year.</p>
            ) : (
                <ul className="divide-y divide-line">
                    {subscriptions.map(item => {
                        const { record, subscription, next } = item;
                        return (
                            <li key={record.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
                                <div className="min-w-0 flex-1">
                                    <p className="break-words font-medium text-ink">{subscription.name}</p>
                                    <p className="mt-0.5 text-sm text-ink-2">
                                        {scheduleText(subscription)}{next && <> · Next <span className="num whitespace-nowrap">{formatDay(next)}</span></>}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <span className="badge border-slate-600 text-ink-2">{subscription.subCategory}</span>
                                        {subscription.club === CLUB_SLUG && <span className="badge border-emerald-500/40 text-emerald-300">Downtown Dinks</span>}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-3 sm:justify-end">
                                    <p className="whitespace-nowrap">
                                        <span className="num font-semibold text-red-400">{formatPeso(subscription.amount)}</span>
                                        <span className="text-sm text-ink-2"> a {subscription.frequency === 'yearly' ? 'year' : 'month'}</span>
                                    </p>
                                    <div className="flex gap-1">
                                        <button type="button" onClick={() => setEditing(item)} disabled={readOnly}
                                            className="icon-btn" title={readOnly ? READ_ONLY_HINT : 'Edit'} aria-label={`Edit ${subscription.name}`}>
                                            <Edit2 size={16} aria-hidden="true" />
                                        </button>
                                        <button type="button" onClick={() => stop(item)} disabled={readOnly}
                                            className="icon-btn hover:text-red-300" title={readOnly ? READ_ONLY_HINT : 'Stop subscription'}
                                            aria-label={`Stop ${subscription.name}`}>
                                            <CalendarX size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {editing && (
                <SubscriptionDialog
                    subscription={editing.draft ? null : editing.subscription}
                    onClose={() => setEditing(null)}
                    onSave={editing.draft ? add : change}
                />
            )}
        </section>
    );
}
