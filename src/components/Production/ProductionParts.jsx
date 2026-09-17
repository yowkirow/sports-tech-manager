import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { productionStatus } from '../../lib/production.js';

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
    if (!mutation.error) return null;
    return <ProductionNotice error>
        <p>{mutation.error}</p>
        {mutation.uncertain && <button className="production-button" type="button"
            disabled={mutation.busy || !online} onClick={mutation.retry}>
            <RefreshCw size={18} aria-hidden="true" />Retry same save
        </button>}
    </ProductionNotice>;
}
export function JobHeading({ job, owner = false }) {
    return <div className="production-job-heading">
        <div>
            <h3>{job.designName}</h3>
            <p>{[job.brand, job.color || 'Color not specified', job.size].join(' · ')}</p>
            <p className="production-reference">{job.jobCode}{owner && ` · ${job.orderId} · ${job.assignee.name}`}</p>
        </div>
        <span className={`production-status production-status-${job.status}`}>
            {job.status === 'completed' && <CheckCircle2 size={16} aria-hidden="true" />}
            {productionStatus[job.status] || job.status}
        </span>
    </div>;
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
