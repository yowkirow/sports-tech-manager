import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Truck } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { useActivityLog } from '../../hooks/useActivityLog';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import { FLAT_SHIPPING, MAX_BALL_TIERS, MAX_SHIPPING_FEE, MAX_TIER_START, ballShippingTiers, currentBallTiers } from '../../lib/shippingRates';

// Ball shipping rates (owner request 2026-11-10): LBC charges more to ship balls than the flat fee covers, so the
// owner sets ball shipping by how many balls an order has. Checkout reads the newest record (src/lib/shippingRates.js).
const COLUMNS = 'grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2';
const peso = value => `₱${Number(value).toLocaleString()}`;
const whole = text => (/^\d+$/.test(String(text).trim()) ? Number(String(text).trim()) : NaN);
const toRows = tiers => (tiers.length ? tiers : [{ from: 1, mm: '', provincial: '' }]).map(tier => ({
    key: crypto.randomUUID(), from: String(tier.from), mm: String(tier.mm), provincial: String(tier.provincial)
}));
const startOf = (row, index) => (index === 0 ? 1 : whole(row.from));
const tiersOf = rows => rows.map((row, index) => ({ from: startOf(row, index), mm: whole(row.mm), provincial: whole(row.provincial) }));

/** The first thing to fix in the rows as typed, or null when they make a valid set of rates. */
function problemWith(rows) {
    for (const [index, row] of rows.entries()) {
        const from = startOf(row, index);
        if (!(from >= 1 && from <= MAX_TIER_START) || (index > 0 && from < 2)) return 'Enter how many balls each added tier starts from: 2 or more.';
        const tier = index === 0 ? 'the first tier' : `the tier from ${from} balls`;
        if (!(whole(row.mm) <= MAX_SHIPPING_FEE)) return `Enter the Metro Manila fee for ${tier} in whole pesos.`;
        if (!(whole(row.provincial) <= MAX_SHIPPING_FEE)) return `Enter the provincial fee for ${tier} in whole pesos.`;
    }
    const starts = rows.map(startOf);
    if (new Set(starts).size !== starts.length) return 'Two tiers start at the same number of balls.';
    return null;
}

export default function BallShippingSettings({ transactions, onAddTransaction }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const readOnly = useReadOnly();
    const saved = useMemo(() => currentBallTiers(transactions), [transactions]);
    // Edits in progress; null shows the saved rates, so a save (or a change from another device) refreshes the form.
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const rows = draft ?? toRows(saved);
    const problem = problemWith(rows);
    const tiers = problem ? null : ballShippingTiers({ balls: tiersOf(rows) });
    const changed = Boolean(tiers) && JSON.stringify(tiers) !== JSON.stringify(saved);

    const edit = (key, field, value) => setDraft(rows.map(row => (row.key === key ? { ...row, [field]: value } : row)));
    const store = async (balls, message) => {
        setSaving(true);
        try {
            const transaction = {
                id: crypto.randomUUID(), type: 'shipping_rates', category: 'settings', amount: 0, date: new Date().toISOString(),
                description: balls.length ? 'Ball shipping rates' : 'Ball shipping rates turned off', details: { balls }
            };
            await onAddTransaction(transaction);
            await logActivity(balls.length ? 'Set ball shipping rates' : 'Turn off ball shipping rates', { tiers: balls.length }, transaction.id);
            setDraft(null);
            showToast(message, 'success');
        } catch (error) {
            console.error(error);
            showToast('The rates could not be saved. Try again.', 'error');
        } finally {
            setSaving(false);
        }
    };
    const turnOff = () => {
        if (window.confirm('Turn off ball shipping rates? Balls will ship at the flat fee with everything else again.')) {
            void store([], 'Ball shipping rates turned off');
        }
    };
    const locked = readOnly || saving;
    const lockedTitle = readOnly ? READ_ONLY_HINT : undefined;

    return (
        <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="ball-shipping-title">
            <div>
                <h3 id="ball-shipping-title" className="section-title flex items-center gap-2">
                    <Truck className="text-ink-3" size={20} aria-hidden="true" />
                    Ball shipping
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-ink-2">
                    LBC charges more to ship balls than the flat {peso(FLAT_SHIPPING.MM)} Metro Manila and {peso(FLAT_SHIPPING.Provincial)} provincial
                    fee covers. Set what balls cost to ship by how many are in the order. It&apos;s added to the flat fee for everything else, and an
                    order of only balls pays just this.
                </p>
                <p className="mt-3 text-sm font-semibold text-ink">
                    {saved.length ? 'In use at checkout.' : 'Not set yet: balls ship at the flat fee with everything else.'}
                </p>
            </div>

            <div className="max-w-xl">
                <div aria-hidden="true" className={`${COLUMNS} pb-1.5 text-xs font-medium text-ink-2`}>
                    <span>From (balls)</span>
                    <span>Metro Manila</span>
                    <span>Provincial</span>
                    <span />
                </div>
                <ul className="space-y-2">
                    {rows.map((row, index) => {
                        const from = startOf(row, index);
                        const tier = index === 0 ? 'the first tier' : `the tier from ${Number.isFinite(from) ? `${from} balls` : 'the new count'}`;
                        return (
                            <li key={row.key} className={COLUMNS}>
                                {index === 0
                                    ? <span className="num px-3.5 text-base text-ink">1</span>
                                    : <input value={row.from} onChange={event => edit(row.key, 'from', event.target.value)} inputMode="numeric" autoComplete="off"
                                        aria-label={`Tier ${index + 1}: from how many balls`} disabled={locked} title={lockedTitle} className="field num" />}
                                {['mm', 'provincial'].map(field => (
                                    <div key={field} className="relative">
                                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">₱</span>
                                        <input value={row[field]} onChange={event => edit(row.key, field, event.target.value)} inputMode="numeric" autoComplete="off"
                                            aria-label={`${field === 'mm' ? 'Metro Manila' : 'Provincial'} fee for ${tier}`} disabled={locked} title={lockedTitle}
                                            className="field num pl-7" />
                                    </div>
                                ))}
                                {index === 0 ? <span /> : (
                                    <button type="button" onClick={() => setDraft(rows.filter(entry => entry.key !== row.key))} disabled={locked} title={lockedTitle}
                                        aria-label={`Remove ${tier}`} className="icon-btn hover:text-red-300">
                                        <Trash2 size={18} aria-hidden="true" />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
                <p className="mt-3 text-xs text-ink-2">Each tier covers its count and up, until the next tier starts.</p>
            </div>

            {problem && draft && <p role="status" className="text-sm text-amber-200">{problem}</p>}

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setDraft([...rows, { key: crypto.randomUUID(), from: '', mm: '', provincial: '' }])}
                    disabled={locked || rows.length >= MAX_BALL_TIERS} title={lockedTitle} className="btn-secondary">
                    <Plus size={16} aria-hidden="true" /> <span>Add a tier</span>
                </button>
                <div className="ml-auto flex flex-wrap gap-3">
                    {draft && <button type="button" onClick={() => setDraft(null)} disabled={saving} className="btn-ghost">Cancel</button>}
                    {saved.length > 0 && !draft && (
                        <button type="button" onClick={turnOff} disabled={locked} title={lockedTitle} className="btn-ghost">Turn off</button>
                    )}
                    <button type="button" onClick={() => store(tiers, 'Ball shipping rates saved')} disabled={locked || !changed} title={lockedTitle} className="btn-primary">
                        {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
                        <span>{saving ? 'Saving…' : 'Save rates'}</span>
                    </button>
                </div>
            </div>
        </section>
    );
}
