import React, { useState } from 'react';
import { AlertCircle, Check, Printer } from 'lucide-react';
import LoadingState from '../ui/LoadingState.jsx';
import { productionQuantity } from '../../lib/production.js';
import { useProductionData, useProductionMutation } from './productionHooks.js';
import { JobActivity, JobCounts, JobHeading, JobInstructions, MutationNotice, ProductionHeader, ProductionNotice } from './ProductionParts.jsx';
import './Production.css';

function PrintJob({ job, reload, online, stale }) {
    const [quantity, setQuantity] = useState('');
    const [note, setNote] = useState('');
    const [validation, setValidation] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = !online || stale || mutation.busy || mutation.uncertain;
    const submit = (action) => {
        const parsed = productionQuantity(quantity, job.remainingToPrint);
        if (action === 'printed' && parsed === null) {
            setValidation(`Enter a whole quantity from 1 to ${job.remainingToPrint}.`); return;
        }
        if (action === 'problem' && !note.trim()) {
            setValidation('Describe the problem so the owner knows what to check.'); return;
        }
        setValidation('');
        mutation.run(`/api/production/jobs/${job.id}/progress`, {
            expectedVersion: job.version, action, ...(action === 'printed' ? { quantity: parsed } : {}),
            ...(note.trim() ? { note: note.trim() } : {})
        }, action === 'printed' ? 'Printed quantity saved for owner QA.' : action === 'start' ? 'Printing started.' : 'Problem recorded.',
        () => { if (action === 'printed') setQuantity(''); setNote(''); });
    };
    return <li className="production-job">
        <JobHeading job={job} />
        <JobCounts job={job} />
        {job.status !== 'completed' && <>
            <JobInstructions job={job} />
            <fieldset className="production-work" disabled={blocked}>
                <legend className="production-sr-only">Record progress for {job.jobCode}</legend>
                <div className="production-actions">
                    <button type="button" className="production-button" disabled={job.status === 'printing' || !job.remainingToPrint}
                        onClick={() => submit('start')}><Printer size={18} aria-hidden="true" />Start printing</button>
                    <label className="production-field production-quantity">Printed quantity
                        <input type="number" min="1" max={job.remainingToPrint} step="1" inputMode="numeric"
                            value={quantity} onChange={event => setQuantity(event.target.value)}
                            aria-describedby={`print-help-${job.id}`} />
                    </label>
                    <button type="button" className="production-button production-primary" disabled={!job.remainingToPrint}
                        onClick={() => submit('printed')}><Check size={18} aria-hidden="true" />Record printed</button>
                </div>
                <p id={`print-help-${job.id}`} className="production-help">Record only newly printed shirts. Partial quantities are welcome; the owner accepts them after QA.</p>
                <label className="production-field">Print note or problem
                    <textarea rows="2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)}
                        placeholder="For example: print alignment needs checking" />
                </label>
                <button type="button" className="production-button production-warning" onClick={() => submit('problem')}>
                    <AlertCircle size={18} aria-hidden="true" />Report problem
                </button>
            </fieldset>
            {validation && <p className="production-validation" role="alert">{validation}</p>}
            <MutationNotice mutation={mutation} online={online} />
            {mutation.busy && <p role="status">Saving progress…</p>}
        </>}
        <JobActivity job={job} />
    </li>;
}

export default function PrintQueue() {
    const data = useProductionData();
    const [filter, setFilter] = useState('active');
    const jobs = data.jobs.filter(job => filter === 'all' || (filter === 'completed' ? job.status === 'completed' : job.status !== 'completed'));
    return <section className="production" aria-label="Employee print queue">
        <ProductionHeader title="Print queue" subtitle="Only jobs assigned and released to you appear here."
            loading={data.loading} onReload={data.load} />
        {!data.online && <ProductionNotice error>You are offline. Notes stay on this screen. Reconnect and reload before saving.</ProductionNotice>}
        {data.error?.status === 404 ? <ProductionNotice>Print production is not enabled yet. The owner will release access after setup.</ProductionNotice>
            : <>
                {data.error && <ProductionNotice error>Queue could not be refreshed. {data.error.message} Saving is paused; use Reload to try again.</ProductionNotice>}
                {data.loading && !data.jobs.length ? <LoadingState label="Loading your print jobs…" /> : <>
                    <label className="production-field production-filter">Show jobs
                        <select value={filter} onChange={event => setFilter(event.target.value)}>
                            <option value="active">In progress</option><option value="completed">Accepted</option><option value="all">All recent jobs</option>
                        </select>
                    </label>
                    {!jobs.length && !data.error && <div className="production-empty">
                        <h3>{filter === 'completed' ? 'No accepted jobs yet' : 'No released jobs to print'}</h3>
                        <p>{filter === 'completed' ? 'Owner-accepted jobs will appear here.' : 'Wait for the owner to assign and release a shirt job. Do not print unreleased orders.'}</p>
                    </div>}
                    <ul className="production-jobs">{jobs.map(job => <PrintJob key={job.id} job={job}
                        reload={data.load} online={data.online} stale={!!data.error} />)}</ul>
                    {data.jobs.length === 100 && <p className="production-help">Showing the latest 100 available jobs.</p>}
                </>}
            </>}
    </section>;
}
