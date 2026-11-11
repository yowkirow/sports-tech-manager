import { useEffect, useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { api } from '../../lib/apiClient';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../lib/expenseCategories';
import {
    addMonths, chargeDaysThrough, FIRST_CHARGE_RANGE_MONTHS, firstChargeProblem, formatDay, formatPeso, manilaToday, nextChargeDay,
    readSubscription, scheduleText, SUBSCRIPTION_AMOUNT_MAX, SUBSCRIPTION_NAME_MAX, SUBSCRIPTIONS_CATEGORY
} from '../../lib/recurringExpenses';

const CLUB_SLUG = 'downtown-dinks';

function amountProblem(text) {
    const value = Number(text);
    if (!text.trim() || !(value > 0)) return 'Enter what each charge costs.';
    if (value > SUBSCRIPTION_AMOUNT_MAX) return 'Each charge can be at most ₱1,000,000.';
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return 'Enter the amount to the centavo, with at most 2 decimal places.';
    return '';
}

// What saving does, in the owner's terms: the charges due now go into Expenses, then the next one.
function summary(subscription, today, editing) {
    const next = nextChargeDay(subscription, today);
    const then = next ? ` Next: ${formatDay(next)}.` : '';
    if (editing) return `Changes apply from the next charge; charges already in Expenses keep theirs.${then}`;
    const due = chargeDaysThrough(subscription, today);
    if (!due.length) return `The first charge goes into Expenses on ${formatDay(subscription.startsOn)}.`;
    const now = due.length === 1
        ? `${due[0] === today ? 'Today’s charge goes' : `The ${formatDay(due[0], { year: false })} charge goes`} into Expenses when you save.`
        : `${due.length} charges since ${formatDay(due[0])} go into Expenses when you save.`;
    return `${now}${then}`;
}

/** Adds a subscription, or changes the name, amount, category and assignment of one. The schedule is fixed once saved. */
export default function SubscriptionDialog({ subscription = null, onClose, onSave }) {
    const formId = useId();
    const today = manilaToday();
    const editing = subscription !== null;
    const [name, setName] = useState(subscription?.name ?? '');
    const [amount, setAmount] = useState(subscription ? String(subscription.amount) : '');
    const [frequency, setFrequency] = useState(subscription?.frequency ?? 'monthly');
    const [startsOn, setStartsOn] = useState(subscription?.startsOn ?? today);
    const [subCategory, setSubCategory] = useState(subscription?.subCategory ?? SUBSCRIPTIONS_CATEGORY);
    const [club, setClub] = useState(subscription?.club ?? null);
    const [categories, setCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        api.getCurrentUser().then(user => {
            const saved = user?.user_metadata?.expense_categories;
            if (active && Array.isArray(saved) && saved.length) setCategories(saved);
        }).catch(() => {});
        return () => { active = false; };
    }, []);
    // The owner's categories ('Other' asks for a name in the expense form; here they pick one they have).
    const options = useMemo(() => [...new Set([SUBSCRIPTIONS_CATEGORY, subscription?.subCategory,
        ...categories.filter(category => typeof category === 'string' && category.trim() && category !== 'Other')].filter(Boolean))],
    [categories, subscription]);

    const values = { name: name.replace(/\s+/g, ' ').trim(), amount: Number(amount), subCategory, frequency, startsOn, club };
    const problem = !values.name ? 'Name the subscription.'
        : amountProblem(amount) || (editing ? '' : firstChargeProblem(startsOn, today));
    const valid = problem ? null : readSubscription(values);
    const shown = (checked && problem) || error;

    const submit = async event => {
        event.preventDefault();
        setChecked(true);
        if (!valid || busy) return;
        setBusy(true);
        setError('');
        try { await onSave(valid, editing ? 0 : chargeDaysThrough(valid, today).length); }
        catch (failure) {
            setError(failure?.message || 'The subscription couldn’t be saved. Try again.');
            setBusy(false);
        }
    };

    return (
        <Dialog
            onClose={() => { if (!busy) onClose(); }}
            title={editing ? 'Edit subscription' : 'Add subscription'}
            description="Each charge goes into Expenses on its day, so you don’t enter it by hand."
            footer={(
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
                    <button type="submit" form={formId} disabled={busy} className="btn-primary">
                        {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
                        {busy ? 'Saving…' : editing ? 'Save changes' : 'Add subscription'}
                    </button>
                </div>
            )}
        >
            <form id={formId} onSubmit={submit} noValidate className="space-y-4">
                <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
                    <div>
                        <label htmlFor={`${formId}-name`} className="field-label">Name</label>
                        <input id={`${formId}-name`} value={name} maxLength={SUBSCRIPTION_NAME_MAX} autoComplete="off" data-autofocus
                            onChange={event => setName(event.target.value)} className="field" placeholder="e.g. Canva Pro, shop rent" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor={`${formId}-amount`} className="field-label">Each charge (₱)</label>
                            <input id={`${formId}-amount`} type="number" inputMode="decimal" min="0.01" max={SUBSCRIPTION_AMOUNT_MAX} step="0.01"
                                value={amount} onChange={event => setAmount(event.target.value)} className="field num" placeholder="0.00" />
                        </div>
                        <div>
                            <label htmlFor={`${formId}-frequency`} className="field-label">Repeats</label>
                            <select id={`${formId}-frequency`} value={frequency} disabled={editing} aria-describedby={editing ? `${formId}-fixed` : undefined}
                                onChange={event => setFrequency(event.target.value)} className="field">
                                <option value="monthly">Every month</option>
                                <option value="yearly">Every year</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor={`${formId}-starts`} className="field-label">First charge</label>
                            <input id={`${formId}-starts`} type="date" value={startsOn} disabled={editing}
                                min={addMonths(today, -FIRST_CHARGE_RANGE_MONTHS)} max={addMonths(today, FIRST_CHARGE_RANGE_MONTHS)}
                                aria-describedby={editing ? `${formId}-fixed` : undefined}
                                onChange={event => setStartsOn(event.target.value)} className="field w-full" />
                        </div>
                        <div>
                            <label htmlFor={`${formId}-category`} className="field-label">Category</label>
                            <select id={`${formId}-category`} value={subCategory} onChange={event => setSubCategory(event.target.value)} className="field">
                                {options.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label htmlFor={`${formId}-club`} className="field-label">Assign to</label>
                        <select id={`${formId}-club`} value={club ?? 'business'} onChange={event => setClub(event.target.value === CLUB_SLUG ? CLUB_SLUG : null)} className="field">
                            <option value="business">SportsTech</option>
                            <option value={CLUB_SLUG}>Downtown Dinks</option>
                        </select>
                    </div>
                </fieldset>

                <div className="rounded-xl border border-line bg-raised p-4" aria-live="polite">
                    {valid ? <>
                        <p className="font-semibold text-ink"><span className="num">{formatPeso(valid.amount)}</span> · {scheduleText(valid)}</p>
                        <p className="mt-1 text-sm text-ink-2">{summary(valid, today, editing)}</p>
                    </> : <p className="text-sm text-ink-2">Fill in the name, amount and first charge to see when charges go into Expenses.</p>}
                    {editing && <p id={`${formId}-fixed`} className="mt-2 text-sm text-ink-2">
                        The schedule stays as saved. To change it, stop this subscription and add a new one that starts at its next charge.
                    </p>}
                </div>
                {shown && <p role="alert" className="text-sm text-red-300">{shown}</p>}
            </form>
        </Dialog>
    );
}
