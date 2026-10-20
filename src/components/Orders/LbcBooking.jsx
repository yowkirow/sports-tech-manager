import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, Copy, Send, Truck } from 'lucide-react';
import { lbcCopyText, lbcReceiver, mobileForLbc, normalizeTracking, plainTrackingCode } from '../../lib/lbcBooking';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

const SHIPPABLE = ['pending', 'in_progress', 'ready'];

// Receiver details to book the parcel with LBC, one copy button per LBC form field, then the
// tracking number the print staff write on the package label.
// Remount with key={trackingNumber} so the draft follows the saved value.
export function LbcBookingPanel({ order, canEditTracking, busy, onCopy, onSaveTracking, onMarkShipped }) {
    const readOnly = useReadOnly();
    const receiver = lbcReceiver(order);
    const saved = order.items[0]?.details?.trackingNumber || '';
    const [draft, setDraft] = useState(saved);
    // Copy feedback stays on the button, so copying field after field doesn't stack toasts.
    const [copied, setCopied] = useState('');
    const copiedTimer = useRef(null);
    useEffect(() => () => clearTimeout(copiedTimer.current), []);
    const copy = async (value, label) => {
        if (!(await onCopy(value, label, { quiet: true }))) return;
        clearTimeout(copiedTimer.current);
        setCopied(label);
        copiedTimer.current = setTimeout(() => setCopied(''), 1600);
    };
    const inputId = `lbc-tracking-${order.id}`;
    const helpId = `${inputId}-help`;
    const next = normalizeTracking(draft);
    const dirty = next !== saved;
    const hidden = next && !plainTrackingCode(next);
    const rows = [
        ['Name', receiver.name, receiver.name],
        ['Mobile', receiver.mobile, mobileForLbc(receiver.mobile), 'Copies the 10 digits that start with 9'],
        ['Street address', receiver.street, receiver.street],
        ['Barangay', receiver.barangay, receiver.barangay],
        ['City / municipality', receiver.city, receiver.city],
        ['Province', receiver.province, receiver.province]
    ];
    return <section className="rounded-xl border border-line bg-raised p-4 sm:p-5" aria-label={`LBC booking for ${receiver.name || 'this order'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h4 className="section-title flex items-center gap-2"><Truck size={16} aria-hidden="true" /> Book with LBC</h4>
                <p className="mt-1 text-sm text-ink-2">Copy each detail into LBC's booking form.</p>
            </div>
            <button type="button" className="btn-secondary min-h-11" onClick={() => copy(lbcCopyText(receiver), 'Receiver details')}>
                {copied === 'Receiver details'
                    ? <><Check size={16} className="text-emerald-400" aria-hidden="true" /> Copied</>
                    : <><ClipboardCopy size={16} aria-hidden="true" /> Copy all</>}
            </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{copied ? `${copied} copied` : ''}</p>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(([label, shown, copiedValue, hint]) => <div key={label} className="flex items-center gap-2 border-t border-line py-2">
                <div className="min-w-0 flex-1">
                    <dt className="text-xs font-medium text-ink-2">{label}</dt>
                    <dd className={shown ? 'break-words text-base text-ink' : 'text-base text-amber-300'}>{shown || 'Missing'}</dd>
                </div>
                {shown && <button type="button" className="icon-btn" onClick={() => copy(copiedValue, label)}
                    aria-label={`Copy ${label.toLowerCase()}`} title={hint || `Copy ${label.toLowerCase()}`}>
                    {copied === label ? <Check size={17} className="text-emerald-400" aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                </button>}
            </div>)}
        </dl>
        {canEditTracking ? <form className="mt-4 border-t border-line pt-4" onSubmit={event => { event.preventDefault(); if (dirty) onSaveTracking(next); }}>
            <label htmlFor={inputId} className="field-label">LBC tracking number</label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <input id={inputId} className="field min-w-0 flex-1 font-semibold tracking-wide num" value={draft} inputMode="text" autoComplete="off"
                    spellCheck={false} placeholder="Paste after booking" aria-describedby={helpId}
                    disabled={readOnly || busy} title={readOnly ? READ_ONLY_HINT : undefined}
                    onChange={event => setDraft(event.target.value)} />
                <button type="submit" className="btn-primary" disabled={readOnly || busy || !dirty} title={readOnly ? READ_ONLY_HINT : undefined}>
                    {saved && !next ? 'Remove tracking' : 'Save tracking'}
                </button>
            </div>
            <p id={helpId} className="mt-2 text-xs text-ink-2">Print staff see it with the customer's name to write on the package. Saving it doesn't mark the order shipped.</p>
            {hidden && <p className="mt-1 text-xs text-amber-300" role="status">Print staff only see a plain tracking code: letters, numbers, spaces or dashes. Paste the code, not a link or note.</p>}
            {SHIPPABLE.includes(order.fulfillmentStatus) && <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" className="btn-secondary" disabled={readOnly || busy || dirty} title={readOnly ? READ_ONLY_HINT : dirty ? 'Save the tracking number first' : undefined}
                    onClick={onMarkShipped}>
                    <Send size={16} aria-hidden="true" /> Mark as shipped
                </button>
                <p className="text-xs text-ink-2">When LBC picks up the parcel. {saved ? 'Texts the tracking link if SMS is on.' : ''}</p>
            </div>}
        </form> : <div className="mt-4 border-t border-line pt-4">
            <p className="field-label">LBC tracking number</p>
            <p className="font-semibold tracking-wide num">{saved || 'Not booked yet'}</p>
        </div>}
    </section>;
}
