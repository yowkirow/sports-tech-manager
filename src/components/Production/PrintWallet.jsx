import React, { useId, useState } from 'react';
import { Banknote, Hourglass } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import { payoutSteps, walletPeso } from '../../lib/production.js';
import { useProductionMutation } from './productionHooks.js';
import { MutationNotice, ProductionNotice } from './ProductionParts.jsx';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

const when = at => new Date(at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function WalletActivity({ recent, rateShirts, rate }) {
    if (!recent.length) return null;
    return <details className="production-activity">
        <summary>Wallet activity ({recent.length})</summary>
        <p className="production-help">Pay is {rate} for each complete {rateShirts} shirts the owner accepts. A rejected shirt counts once its reprint is accepted.</p>
        <ol>
            {recent.map((entry, index) => <li key={`${entry.type}:${entry.at}:${index}`}>
                <div>{entry.type === 'credit'
                    ? <><strong className="num">+{entry.shirts} accepted</strong> · <span className="num">{entry.jobCode}</span></>
                    : <strong className="num">Paid {walletPeso(entry.amountCentavos)}</strong>}</div>
                {entry.note && <p>{entry.note}</p>}
                <time dateTime={entry.at}>{when(entry.at)}</time>
            </li>)}
        </ol>
    </details>;
}

/** The print employee's own counter and wallet. Counts and pay only; no order or customer data. */
export function MyShirts({ data }) {
    const titleId = useId();
    const nextId = useId();
    const { wallet, loading, error } = data;
    if (!wallet) {
        return <section className="production-wallet" aria-labelledby={titleId}>
            <div className="production-wallet-head"><h3 id={titleId}>My shirts</h3></div>
            {error
                ? <ProductionNotice error>Your shirt count could not be loaded. {error.message} Your print jobs below still work; use Reload to try again.</ProductionNotice>
                : <p className="production-help" role="status">Loading your shirt count…</p>}
        </section>;
    }
    const rate = walletPeso(wallet.rateCentavos);
    return <section className="production-wallet" aria-labelledby={titleId}>
        <div className="production-wallet-head">
            <h3 id={titleId}>My shirts</h3>
            {loading && <p className="production-wallet-sync" role="status">Updating…</p>}
        </div>
        <div className="production-wallet-top">
            <p className="production-wallet-counter" aria-hidden="true">{wallet.progress}<span>/{wallet.rateShirts}</span></p>
            <dl className="production-wallet-due"><dt>Balance due</dt><dd>{walletPeso(wallet.balanceCentavos)}</dd></dl>
        </div>
        <div className="production-wallet-bar" role="progressbar" aria-label={`Accepted shirts toward your next ${rate}`}
            aria-describedby={nextId} aria-valuemin={0} aria-valuemax={wallet.rateShirts} aria-valuenow={wallet.progress}
            aria-valuetext={`${wallet.progress} of ${wallet.rateShirts} shirts`}>
            <span style={{ transform: `scaleX(${wallet.progress / wallet.rateShirts})` }} />
        </div>
        <p id={nextId} className="production-wallet-next"><strong className="num">{wallet.nextPayoutIn} more</strong> for your next {rate}</p>
        {error && <ProductionNotice error>Could not refresh. Showing your last loaded count. {error.message}</ProductionNotice>}
        <dl className="production-wallet-mini">
            <div><dt>Earned</dt><dd>{walletPeso(wallet.earnedCentavos)}</dd></div>
            <div><dt>Paid</dt><dd>{walletPeso(wallet.paidCentavos)}</dd></div>
            <div><dt>Shirts this week</dt><dd>{wallet.shirtsThisWeek}</dd></div>
            <div><dt>Shirts all time</dt><dd>{wallet.acceptedShirts}</dd></div>
        </dl>
        <p className="production-wallet-waiting"><Hourglass size={18} aria-hidden="true" />
            Printed, waiting for owner check: <strong className="num">{wallet.awaitingQA}</strong></p>
        {wallet.acceptedShirts === 0 && <p className="production-wallet-empty">No accepted shirts yet.</p>}
        <p className="production-help">Shirts count after the owner accepts them. Every complete {wallet.rateShirts} adds {rate}.</p>
        <WalletActivity recent={wallet.recent} rateShirts={wallet.rateShirts} rate={rate} />
    </section>;
}

/** Owner-side counts and pay for one print operator. */
export function OperatorWallet({ wallet }) {
    return <dl className="production-wallet-mini">
        <div><dt>Accepted</dt><dd>{wallet.acceptedShirts}</dd></div>
        <div><dt>Earned</dt><dd>{walletPeso(wallet.earnedCentavos)}</dd></div>
        <div><dt>Paid</dt><dd>{walletPeso(wallet.paidCentavos)}</dd></div>
        <div className={wallet.balanceCentavos > 0 ? 'production-wallet-owed' : undefined}><dt>Balance due</dt><dd>{walletPeso(wallet.balanceCentavos)}</dd></div>
    </dl>;
}

// The mutation lives here, not in the dialog, so an unconfirmed save can only be retried as the
// same request even after the dialog is closed and reopened.
export function OperatorPayout({ wallet, reload, online, stale }) {
    const readOnly = useReadOnly();
    const formId = useId();
    const [open, setOpen] = useState(false);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const mutation = useProductionMutation(reload, { serverErrors: true });
    const steps = payoutSteps(wallet.balanceCentavos, wallet.rateCentavos);
    const selected = steps.includes(Number(amount)) ? Number(amount) : steps[0];
    const locked = readOnly || !online || mutation.busy || mutation.uncertain;
    const start = () => {
        if (!mutation.uncertain) { setAmount(String(steps[0] ?? '')); setNote(''); setConfirmed(false); }
        setOpen(true);
    };
    const close = () => {
        if (mutation.uncertain) reload();
        setOpen(false);
    };
    const submit = event => {
        event.preventDefault();
        if (!confirmed || !selected) return;
        mutation.run('/api/production/payouts', {
            operatorId: wallet.memberId, amountCentavos: selected, ...(note.trim() ? { note: note.trim() } : {})
        }, `${walletPeso(selected)} payout recorded for ${wallet.name}.`, () => setOpen(false));
    };
    return <>
        <button type="button" className="production-button"
            disabled={readOnly || !online || stale || (!steps.length && !mutation.uncertain)}
            title={readOnly ? READ_ONLY_HINT : !steps.length ? 'Nothing is due' : undefined} onClick={start}>
            <Banknote size={18} aria-hidden="true" />Record payout
        </button>
        {open && <Dialog title="Record payout" description={`${wallet.name} · Balance due ${walletPeso(wallet.balanceCentavos)}`}
            onClose={close} size="sm"
            footer={<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="production-button" onClick={close}>Cancel</button>
                <button type="submit" form={formId} className="production-button production-primary"
                    disabled={locked || !confirmed || !selected} title={readOnly ? READ_ONLY_HINT : undefined}>
                    <Banknote size={18} aria-hidden="true" />{selected ? `Record ${walletPeso(selected)}` : 'Record payout'}
                </button>
            </div>}>
            <form id={formId} className="production" onSubmit={submit}>
                <fieldset disabled={locked}>
                    <legend className="production-sr-only">Payout for {wallet.name}</legend>
                    {steps.length ? <label className="production-field">Amount paid
                        <select value={selected} onChange={event => { setAmount(event.target.value); setConfirmed(false); }}>
                            {steps.map((step, index) => <option key={step} value={step}>
                                {walletPeso(step)}{index === 0 ? ' (full balance)' : ''}
                            </option>)}
                        </select>
                    </label> : <p className="production-help">Nothing is due now.</p>}
                    <label className="production-field">Note for {wallet.name} (optional)
                        <input value={note} maxLength={200} autoComplete="off" placeholder="For example: GCash, 6 Oct"
                            onChange={event => setNote(event.target.value)} aria-describedby={`${formId}-note`} />
                    </label>
                    <p id={`${formId}-note`} className="production-help">{wallet.name} sees this payout and note in their wallet.
                        Payouts can’t be edited or deleted. Pay is {walletPeso(wallet.rateCentavos)} for each complete {wallet.rateShirts} accepted shirts.</p>
                    {selected && <label className="production-checkbox">
                        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
                        I have paid {wallet.name} {walletPeso(selected)} outside the app.
                    </label>}
                </fieldset>
                <MutationNotice mutation={mutation} online={online} />
                {mutation.busy && <p role="status">Recording payout…</p>}
            </form>
        </Dialog>}
    </>;
}

export function UnattributedShirts({ unattributed }) {
    if (!unattributed?.shirts) return null;
    const codes = [...new Set(unattributed.recent.map(entry => entry.jobCode))];
    return <ProductionNotice>
        <p><strong className="num">{unattributed.shirts}</strong> accepted {unattributed.shirts === 1 ? 'shirt is' : 'shirts are'} not
            in any wallet, because more than one person printed the batch or the owner recorded the print. Settle these outside the app.</p>
        {codes.length > 0 && <p className="num">Jobs: {codes.join(', ')}</p>}
    </ProductionNotice>;
}
