import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, Copy, Send, Truck } from 'lucide-react';
import { SHIPPABLE_STATUSES, lbcCopyText, lbcReceiver, mobileForLbc, normalizeLbcNumber, plainLabelCode } from '../../lib/lbcBooking';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

// One LBC parcel, start to finish: copy the receiver into LBC's pickup booking, save the booking
// number print staff write on the package, then the tracking number LBC gives once the parcel
// ships, which is the customer's. Remount with a key built from both saved numbers and the status
// so the drafts follow what was saved.
export function LbcBookingPanel({ order, canEdit, busy, onCopy, onSaveBooking, onSaveTracking, onShip }) {
    const readOnly = useReadOnly();
    const receiver = lbcReceiver(order);
    const details = order.items[0]?.details || {};
    const savedBooking = details.bookingNumber || '';
    const savedTracking = details.trackingNumber || '';
    const [booking, setBooking] = useState(savedBooking);
    const [tracking, setTracking] = useState(savedTracking);
    const [askTracking, setAskTracking] = useState(false);
    const trackingInput = useRef(null);
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
    const bookingId = `lbc-booking-${order.id}`;
    const trackingId = `lbc-tracking-${order.id}`;
    const nextBooking = normalizeLbcNumber(booking);
    const nextTracking = normalizeLbcNumber(tracking);
    const bookingDirty = nextBooking !== savedBooking;
    const trackingDirty = nextTracking !== savedTracking;
    const bookingHidden = nextBooking && !plainLabelCode(nextBooking);
    const shippable = SHIPPABLE_STATUSES.includes(order.fulfillmentStatus);
    const locked = readOnly || busy;
    // Shipping texts the customer the tracking number, so ask for it instead of shipping without.
    const ship = () => {
        if (!nextTracking) {
            setAskTracking(true);
            trackingInput.current?.focus();
            return;
        }
        onShip(nextTracking);
    };
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
                <p className="mt-1 text-sm text-ink-2">Copy each detail into LBC's pickup booking.</p>
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
        {canEdit ? <div className="mt-4 grid gap-x-6 gap-y-5 border-t border-line pt-4 md:grid-cols-2">
            <form onSubmit={event => { event.preventDefault(); if (bookingDirty) onSaveBooking(nextBooking); }}>
                <label htmlFor={bookingId} className="field-label">LBC booking number</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input id={bookingId} className="field min-w-0 flex-1 font-semibold tracking-wide num" value={booking} inputMode="text" autoComplete="off"
                        spellCheck={false} placeholder="Paste after booking the pickup" aria-describedby={`${bookingId}-help`}
                        disabled={locked} title={readOnly ? READ_ONLY_HINT : undefined}
                        onChange={event => setBooking(event.target.value)} />
                    <button type="submit" className="btn-secondary" disabled={locked || !bookingDirty} title={readOnly ? READ_ONLY_HINT : undefined}
                        aria-label={savedBooking && !nextBooking ? 'Remove the LBC booking number' : 'Save the LBC booking number'}>
                        {savedBooking && !nextBooking ? 'Remove' : 'Save'}
                    </button>
                </div>
                <p id={`${bookingId}-help`} className="mt-2 text-xs text-ink-2">From the pickup booking. Print staff write it on the package with the customer's name.</p>
                {bookingHidden && <p className="mt-1 text-xs text-amber-300" role="status">Print staff only see a plain code: letters, numbers, spaces or dashes. Paste the number, not a link or note.</p>}
            </form>
            <form onSubmit={event => {
                event.preventDefault();
                if (shippable) ship();
                else if (trackingDirty) onSaveTracking(nextTracking);
            }}>
                <label htmlFor={trackingId} className="field-label">LBC tracking number</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input ref={trackingInput} id={trackingId} className="field min-w-0 flex-1 font-semibold tracking-wide num" value={tracking} inputMode="text"
                        autoComplete="off" spellCheck={false} placeholder="Paste once LBC ships it" aria-describedby={`${trackingId}-help`}
                        aria-invalid={askTracking || undefined} disabled={locked} title={readOnly ? READ_ONLY_HINT : undefined}
                        onChange={event => { setTracking(event.target.value); setAskTracking(false); }} />
                    {shippable
                        ? <button type="submit" className="btn-primary" disabled={locked || bookingDirty}
                            title={readOnly ? READ_ONLY_HINT : bookingDirty ? 'Save the booking number first' : undefined}>
                            <Send size={16} aria-hidden="true" /> Mark as shipped
                        </button>
                        : <button type="submit" className="btn-secondary" disabled={locked || !trackingDirty} title={readOnly ? READ_ONLY_HINT : undefined}
                            aria-label={savedTracking && !nextTracking ? 'Remove the LBC tracking number' : 'Save the LBC tracking number'}>
                            {savedTracking && !nextTracking ? 'Remove' : 'Save'}
                        </button>}
                </div>
                <p id={`${trackingId}-help`} className="mt-2 text-xs text-ink-2">{shippable
                    ? 'LBC gives it once the parcel ships. The customer sees it on their order page and gets it by text if SMS is on.'
                    : 'The customer sees it on their order page. A changed number is texted again if SMS is on.'}</p>
                {askTracking && <div role="alert" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    <p>Paste the tracking number LBC gave you, so the customer can follow the parcel.</p>
                    <button type="button" className="mt-1 min-h-11 font-semibold text-amber-200 underline underline-offset-4 hover:text-white"
                        disabled={locked} onClick={() => { setAskTracking(false); onShip(''); }}>
                        Ship without a tracking number
                    </button>
                </div>}
            </form>
        </div> : <div className="mt-4 border-t border-line pt-4">
            <p className="field-label">LBC tracking number</p>
            <p className="font-semibold tracking-wide num">{savedTracking || 'Not shipped yet'}</p>
        </div>}
    </section>;
}
