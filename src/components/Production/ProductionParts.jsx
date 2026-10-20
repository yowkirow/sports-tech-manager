import React from 'react';
import { AlertCircle, CheckCircle2, ImageOff, Maximize2, RefreshCw } from 'lucide-react';
import { productionStatus } from '../../lib/production.js';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

export function ProductionHeader({ title, subtitle, loading, onReload }) {
    return <header className="production-header">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <button type="button" className="production-button" disabled={loading} onClick={onReload}>
            <RefreshCw size={18} aria-hidden="true" />{loading ? 'Refreshing…' : 'Reload'}
        </button>
    </header>;
}
export function ProductionNotice({ children, error = false }) {
    return <div className={`production-notice${error ? ' production-error' : ''}`} role={error ? 'alert' : 'status'}>
        <AlertCircle size={20} aria-hidden="true" /><div>{children}</div>
    </div>;
}
export function MutationNotice({ mutation, online }) {
    const readOnly = useReadOnly();
    if (!mutation.error) return null;
    return <ProductionNotice error>
        <p>{mutation.error}</p>
        {mutation.uncertain && <button className="production-button" type="button"
            disabled={readOnly || mutation.busy || !online} title={readOnly ? READ_ONLY_HINT : undefined} onClick={mutation.retry}>
            <RefreshCw size={18} aria-hidden="true" />Retry same save
        </button>}
    </ProductionNotice>;
}
export function JobHeading({ job, owner = false, customer = '', orderDate = '' }) {
    return <div className="production-job-heading">
        <div>
            <h3>{job.designName}</h3>
            <p>{[job.brand, job.color || 'Color not specified', job.size].join(' · ')}</p>
            <p className="production-reference">{job.jobCode}</p>
            {owner && <p className="production-owner-reference">
                {(customer || job.customerName) && <strong className="production-owner-customer">{customer || job.customerName}</strong>}
                {[job.orderId, orderDate && `Ordered ${orderDate}`, job.assignee.name].filter(Boolean).join(' · ')}
            </p>}
        </div>
        <span className={`production-status production-status-${job.status}`}>
            {job.status === 'completed' && <CheckCircle2 size={16} aria-hidden="true" />}
            {productionStatus[job.status] || job.status}
        </span>
    </div>;
}
// What the employee writes on the package: the customer's name (owner decision 2026-10-13) and
// the LBC tracking code once the owner has booked the parcel (owner decision 2026-10-20).
export function JobCustomer({ job }) {
    return <div className="production-customer">
        <span>Write on package</span>
        {job.customerName
            ? <strong>{job.customerName}</strong>
            : <strong className="production-customer-missing">No name on this order. Ask the owner before packing.</strong>}
        <div className="production-tracking">
            <span>LBC tracking</span>
            {job.trackingNumber
                ? <strong className="production-tracking-code">{job.trackingNumber}</strong>
                : <p className="production-tracking-missing">Not booked yet. The owner adds it after booking with LBC.</p>}
        </div>
    </div>;
}
// Small product photo for the owner's line picker. Decorative: the label names the design.
export function DesignThumb({ src }) {
    return src
        ? <img className="production-thumb" src={src} alt="" loading="lazy" decoding="async" width="56" height="56" />
        : <span className="production-thumb production-thumb-empty" aria-hidden="true"><ImageOff size={18} /></span>;
}
// The design photo the employee copies. Opens full size in a new tab for close checking.
export function JobPhoto({ job, large = false }) {
    if (!job.designImageUrl) {
        return <p className="production-photo-missing"><ImageOff size={18} aria-hidden="true" />No design photo on this order. Use the artwork the owner supplied.</p>;
    }
    return <a className={`production-photo${large ? ' production-photo-large' : ''}`} href={job.designImageUrl} target="_blank" rel="noopener noreferrer">
        <img src={job.designImageUrl} alt={`Design photo: ${job.designName}, ${job.color || 'color not specified'}`} loading="lazy" decoding="async" />
        <span><Maximize2 size={16} aria-hidden="true" />Open full size</span>
    </a>;
}
export function JobCounts({ job }) {
    return <>
        <dl className="production-counts">
            <div><dt>Required</dt><dd>{job.required}</dd></div>
            <div><dt>To print</dt><dd>{job.remainingToPrint}</dd></div>
            <div><dt>Awaiting QA</dt><dd>{job.awaitingQA}</dd></div>
            <div><dt>Accepted</dt><dd>{job.accepted}</dd></div>
        </dl>
        {job.reworkRemaining > 0 && <p className="production-rework">{job.reworkRemaining} to rework — included in “To print”.</p>}
    </>;
}
export function JobInstructions({ job }) {
    return <div className="production-instructions">
        <strong>Print instructions</strong>
        <p>{job.instructions || 'Use the artwork and instructions supplied separately by the owner.'}</p>
    </div>;
}
export function JobActivity({ job }) {
    return <details className="production-activity">
        <summary>Activity{job.events.length ? ` (${job.events.length})` : ''}</summary>
        <ol>
            {job.events.map(event => <li key={event.id}>
                <div><strong>{event.actorName}</strong> · {({
                    prepared: 'Prepared job', release: 'Released to print', hold: 'Put on hold',
                    revised: 'Prepared revised job', superseded: 'Retired original job; history preserved',
                    start: 'Started printing', printed: `Printed ${event.quantity}`,
                    problem: 'Reported a problem', qa: `QA: ${event.accepted} accepted, ${event.rejected} for rework`,
                    source_changed: 'Source changed — printing held', source_deleted: 'Source removed',
                    operator_revoked: 'Employee access revoked'
                })[event.action] || event.action}</div>
                {event.note && <p>{event.note}</p>}
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </li>)}
        </ol>
        {job.events.length === 100 && <p>Showing the latest 100 events. Earlier events are retained.</p>}
    </details>;
}
