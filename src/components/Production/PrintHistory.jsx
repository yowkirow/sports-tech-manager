import React, { useId, useMemo, useRef, useState } from 'react';
import { Banknote, CheckCircle2, History, Paperclip, Printer, RefreshCw, RotateCcw } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import { groupHistory, historyJobLabel, historyTime, walletPeso } from '../../lib/production.js';
import { usePrintHistory, useProductionMutation, useReceiptUpload } from './productionHooks.js';
import { MutationNotice, ProductionNotice } from './ProductionParts.jsx';
import { OperatorWallet } from './PrintWallet.jsx';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

function JobLine({ job }) {
    if (!job) return null;
    return <p className="print-history-meta">
        {historyJobLabel(job)}
        {job.jobCode && <span className="print-history-code">{job.jobCode}</span>}
        {job.customerName && <span className="print-history-customer">{job.customerName}</span>}
    </p>;
}

// The receipt of a payout: a thumbnail that opens full size. The owner can attach one to a payout
// without a receipt, or replace a wrong image; staff only view.
function PayoutReceipt({ entry, owner, online, onSaved }) {
    const readOnly = useReadOnly();
    const input = useRef(null);
    const uploader = useReceiptUpload();
    const mutation = useProductionMutation(onSaved, { serverErrors: true });
    const blocked = readOnly || !online || uploader.busy || mutation.busy;
    const choose = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const image = await uploader.upload(file);
        if (!image) return;
        URL.revokeObjectURL(image.preview);
        await mutation.run(`/api/production/payouts/${entry.payoutId}/receipt`, { receiptId: image.id },
            entry.receiptUrl ? 'Receipt replaced.' : 'Receipt attached. Your print staff can see it in their history.');
    };
    const pick = () => {
        if (mutation.uncertain) { mutation.retry(); return; }
        input.current?.click();
    };
    if (!owner && !entry.receiptUrl) return null;
    return <div className="print-history-receipt">
        {entry.receiptUrl
            ? <a className="print-history-receipt-link" href={entry.receiptUrl} target="_blank" rel="noopener noreferrer">
                <img src={entry.receiptUrl} alt="" loading="lazy" decoding="async" width="56" height="56" />
                <span>View receipt<span className="production-sr-only"> (opens in a new tab)</span></span>
            </a>
            : <p className="print-history-receipt-missing">No receipt attached</p>}
        {owner && <>
            <input ref={input} type="file" accept="image/*" hidden onChange={choose} />
            <button type="button" className="production-button print-history-receipt-button" disabled={blocked}
                title={readOnly ? READ_ONLY_HINT : undefined} onClick={pick}>
                <Paperclip size={16} aria-hidden="true" />
                {uploader.busy ? 'Uploading…' : mutation.busy ? 'Saving…' : entry.receiptUrl ? 'Replace receipt' : 'Attach receipt'}
            </button>
        </>}
        {uploader.error && <p className="production-validation" role="alert">{uploader.error}</p>}
        <MutationNotice mutation={mutation} online={online} />
    </div>;
}

function HistoryEntry({ entry, owner, online, onSaved }) {
    const time = <time dateTime={entry.at}>{historyTime(entry.at)}</time>;
    if (entry.type === 'payout') {
        return <li className="print-history-entry print-history-paid">
            <span className="print-history-mark" aria-hidden="true"><Banknote size={18} /></span>
            <div className="print-history-body">
                <p className="print-history-title"><strong className="num">Paid {walletPeso(entry.amountCentavos)}</strong></p>
                {entry.note && <p className="print-history-meta">{entry.note}</p>}
                <PayoutReceipt entry={entry} owner={owner} online={online} onSaved={onSaved} />
            </div>
            {time}
        </li>;
    }
    if (entry.type === 'qa') {
        const sentBack = entry.rejected > 0;
        return <li className={`print-history-entry ${entry.accepted ? 'print-history-accepted' : 'print-history-rework'}`}>
            <span className="print-history-mark" aria-hidden="true">{entry.accepted ? <CheckCircle2 size={18} /> : <RotateCcw size={18} />}</span>
            <div className="print-history-body">
                <p className="print-history-title">
                    {entry.accepted > 0 && <strong className="num">{entry.accepted} accepted</strong>}
                    {entry.accepted > 0 && sentBack && <span aria-hidden="true"> · </span>}
                    {sentBack && <span className="print-history-sent-back num">{entry.rejected} sent back for reprint</span>}
                </p>
                <JobLine job={entry.job} />
                {sentBack && entry.note && <p className="print-history-note">“{entry.note}”</p>}
            </div>
            {time}
        </li>;
    }
    return <li className="print-history-entry print-history-printed">
        <span className="print-history-mark" aria-hidden="true"><Printer size={18} /></span>
        <div className="print-history-body">
            <p className="print-history-title"><span className="num">Printed {entry.quantity}</span></p>
            <JobLine job={entry.job} />
        </div>
        {time}
    </li>;
}

/**
 * A print operator's record, newest first, by day (owner request 2026-11-03): shirts recorded as
 * printed, the owner's quality checks credited to them and their payouts with the receipt.
 */
export function PrintHistory({ history, owner = false, wallet = null, online = true, heading = true }) {
    const titleId = useId();
    const days = useMemo(() => groupHistory(history.entries), [history.entries]);
    return <section className={`print-history${heading ? '' : ' print-history-plain'}`}
        aria-labelledby={heading ? titleId : undefined} aria-label={heading ? undefined : 'History'}>
        {heading && <div className="print-history-head">
            <h3 id={titleId}>My history</h3>
            {history.loading && history.loaded && <p className="production-wallet-sync" role="status">Updating…</p>}
        </div>}
        {wallet && <OperatorWallet wallet={wallet} />}
        <p className="production-help">{owner
            ? 'Every print they recorded, your quality checks and the payouts you made. Pay counts only accepted shirts.'
            : 'Every print you recorded, the owner’s checks and your payouts. Only accepted shirts count toward pay.'}</p>
        {history.error && !history.olderFailed && <ProductionNotice error>
            <p>History could not be loaded. {history.error.message}</p>
            <button type="button" className="production-button" disabled={history.loading} onClick={history.load}>
                <RefreshCw size={18} aria-hidden="true" />Try again
            </button>
        </ProductionNotice>}
        {!history.loaded && !history.error && <p className="production-help" role="status">Loading history…</p>}
        {history.loaded && !history.entries.length && <div className="production-empty">
            <h3>Nothing here yet</h3>
            <p>{owner ? 'Prints, quality checks and payouts for this person will appear here.' : 'Shirts you record as printed, the owner’s checks and your payouts will appear here.'}</p>
        </div>}
        {days.map(day => <section key={day.key} className="print-history-day" aria-label={day.label}>
            <h4>{day.label}</h4>
            <ol className="print-history-list">
                {day.entries.map(entry => <HistoryEntry key={entry.id} entry={entry} owner={owner} online={online} onSaved={history.load} />)}
            </ol>
        </section>)}
        {history.error && history.olderFailed && <p className="production-validation print-history-older-error" role="alert">
            Older history could not be loaded. {history.error.message}
        </p>}
        {history.next && <button type="button" className="production-button print-history-more" disabled={history.loading} onClick={history.more}>
            {history.loading ? 'Loading…' : history.olderFailed ? 'Try older history again' : 'Show older history'}
        </button>}
    </section>;
}

/** Owner: one print operator's history in a dialog, where receipts can be attached or replaced. */
export function OperatorHistory({ memberId, name, wallet, online }) {
    const [open, setOpen] = useState(false);
    const history = usePrintHistory({ memberId, enabled: open });
    const due = wallet && wallet.balanceCentavos > 0 ? ` · ${walletPeso(wallet.balanceCentavos)} due` : '';
    return <>
        <button type="button" className="production-button" onClick={() => setOpen(true)}>
            <History size={18} aria-hidden="true" />History
        </button>
        {open && <Dialog title={name} description={`Prints, quality checks and payouts${due}`} onClose={() => setOpen(false)} size="lg">
            <div className="production">
                <PrintHistory history={history} owner wallet={wallet} online={online} heading={false} />
            </div>
        </Dialog>}
    </>;
}
