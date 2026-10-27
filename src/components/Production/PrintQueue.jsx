import React, { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Printer } from 'lucide-react';
import LoadingState from '../ui/LoadingState.jsx';
import { packageItems, packageStatus, packageSummary, printPackages, productionQuantity, visiblePrintPackages } from '../../lib/production.js';
import { useProductionData, useProductionMutation, useProductionWallet } from './productionHooks.js';
import { JobActivity, JobCounts, JobCustomer, JobHeading, JobInstructions, JobPhoto, MutationNotice, ProductionHeader, ProductionNotice } from './ProductionParts.jsx';
import { MyShirts } from './PrintWallet.jsx';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import './Production.css';

function PrintJob({ job, reload, online, stale }) {
    const readOnly = useReadOnly();
    const [quantity, setQuantity] = useState('');
    const [note, setNote] = useState('');
    const [validation, setValidation] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = readOnly || !online || stale || mutation.busy || mutation.uncertain;
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
        <JobPhoto job={job} large />
        <JobCounts job={job} />
        {job.status !== 'completed' && <>
            <JobInstructions job={job} />
            <fieldset className="production-work" disabled={blocked}>
                <legend className="production-sr-only">Record progress for {job.jobCode}</legend>
                <div className="production-actions">
                    <button type="button" className="production-button" disabled={readOnly || job.status === 'printing' || !job.remainingToPrint} title={readOnly ? READ_ONLY_HINT : undefined}
                        onClick={() => submit('start')}><Printer size={18} aria-hidden="true" />Start printing</button>
                    <label className="production-field production-quantity">Printed quantity
                        <input type="number" min="1" max={job.remainingToPrint} step="1" inputMode="numeric"
                            value={quantity} onChange={event => setQuantity(event.target.value)}
                            aria-describedby={`print-help-${job.id}`} />
                    </label>
                    <button type="button" className="production-button production-primary" disabled={readOnly || !job.remainingToPrint} title={readOnly ? READ_ONLY_HINT : undefined}
                        onClick={() => submit('printed')}><Check size={18} aria-hidden="true" />Record printed</button>
                </div>
                <p id={`print-help-${job.id}`} className="production-help">Record only newly printed shirts. Partial quantities are welcome; the owner accepts them after QA.</p>
                <label className="production-field">Print note or problem
                    <textarea rows="2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)}
                        placeholder="For example: print alignment needs checking" />
                </label>
                <button type="button" className="production-button production-warning" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => submit('problem')}>
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

const PACKAGE_STATUS_STYLE = { ready_to_pack: 'completed', problem: 'problem', awaiting_qa: 'awaiting_qa', to_print: 'released' };

// One customer's parcel: what to write on it, where it stands, and its shirts. The job cards stay
// mounted while collapsed, so a typed quantity or note survives closing and reopening.
function PrintPackage({ pkg, open, onToggle, reload, online, stale }) {
    const listId = `print-package-${pkg.key}`;
    const count = pkg.visibleJobs.length;
    return <li className="print-package">
        <section aria-label={`Package for ${pkg.customerName || 'a customer without a name'}`}>
            <div className="print-package-head">
                <JobCustomer job={pkg} />
                {pkg.sharedName && <p className="production-rework">Another package has the same name. Keep the two parcels separate.</p>}
                <div className="print-package-summary">
                    <span className={`production-status production-status-${PACKAGE_STATUS_STYLE[pkg.state]}`}>
                        {pkg.state === 'ready_to_pack' && <CheckCircle2 size={16} aria-hidden="true" />}
                        {packageStatus[pkg.state]}
                    </span>
                    <p>{packageSummary(pkg)}</p>
                </div>
                <p className="print-package-items">{packageItems(pkg)}</p>
                <button type="button" className="production-button print-package-toggle" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
                    {open ? 'Hide jobs' : `Show ${count} job${count === 1 ? '' : 's'}`}<ChevronDown size={18} aria-hidden="true" />
                </button>
            </div>
            <ul id={listId} className="production-jobs print-package-jobs" hidden={!open}>
                {pkg.visibleJobs.map(job => <PrintJob key={job.id} job={job} reload={reload} online={online} stale={stale} />)}
            </ul>
        </section>
    </li>;
}

export default function PrintQueue({ userRole }) {
    const data = useProductionData();
    const showWallet = userRole === 'print_operator';
    const wallet = useProductionWallet(showWallet);
    const { load: loadJobs } = data;
    const { load: loadWallet } = wallet;
    const reload = useCallback(() => Promise.all([loadJobs(), loadWallet()]), [loadJobs, loadWallet]);
    const [filter, setFilter] = useState('active');
    const [query, setQuery] = useState('');
    // Packages start collapsed, like Orders. A search opens every match, and a lone package opens
    // by itself; after that, the printer's own open/close choice wins until the search changes.
    const [opened, setOpened] = useState(() => new Map());
    const packages = useMemo(() => printPackages(data.jobs), [data.jobs]);
    const shown = useMemo(() => visiblePrintPackages(packages, filter, query), [packages, filter, query]);
    const searching = query.trim() !== '';
    const isOpen = pkg => opened.has(pkg.key) ? opened.get(pkg.key) : searching || shown.length === 1;
    const toggle = pkg => setOpened(current => new Map(current).set(pkg.key, !isOpen(pkg)));
    const search = value => { setQuery(value); setOpened(new Map()); };
    const toPrint = shown.reduce((total, pkg) => total + pkg.visibleJobs.reduce((sum, job) => sum + job.remainingToPrint, 0), 0);
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return <section className="production" aria-label="Employee print queue">
        <ProductionHeader title="Print queue" subtitle="Only jobs assigned and released to you appear here."
            loading={data.loading} onReload={reload} />
        {!data.online && <ProductionNotice error>You are offline. Notes stay on this screen. Reconnect and reload before saving.</ProductionNotice>}
        {data.error?.status === 404 ? <ProductionNotice>Print production is not enabled yet. The owner will release access after setup.</ProductionNotice>
            : <>
                {showWallet && <MyShirts data={wallet} />}
                {data.error && <ProductionNotice error>Queue could not be refreshed. {data.error.message} Saving is paused; use Reload to try again.</ProductionNotice>}
                {data.loading && !data.jobs.length ? <LoadingState label="Loading your print jobs…" /> : <>
                    <div className="production-toolbar">
                        <label className="production-field production-filter">Show jobs
                            <select value={filter} onChange={event => setFilter(event.target.value)}>
                                <option value="active">In progress</option><option value="completed">Accepted</option><option value="all">All recent jobs</option>
                            </select>
                        </label>
                        <label className="production-field">Find customer, booking number or design
                            <input type="search" value={query} autoComplete="off" spellCheck={false} enterKeyHint="search"
                                onChange={event => search(event.target.value)} />
                        </label>
                    </div>
                    {shown.length > 0 && <p className="production-help print-queue-count" role="status">
                        {searching ? `${plural(shown.length, 'package')} ${shown.length === 1 ? 'matches' : 'match'} “${query.trim()}”`
                            : `${plural(shown.length, 'package')} · ${plural(toPrint, 'shirt')} to print`}
                    </p>}
                    {!shown.length && !data.error && (searching ? <div className="production-empty" role="status">
                        <h3>No packages match “{query.trim()}”</h3>
                        <p>Search by customer name, LBC booking number, design, color, size or job code.</p>
                        <button type="button" className="production-button print-queue-clear" onClick={() => search('')}>Clear search</button>
                    </div> : <div className="production-empty">
                        <h3>{filter === 'completed' ? 'No accepted jobs yet' : 'No released jobs to print'}</h3>
                        <p>{filter === 'completed' ? 'Owner-accepted jobs will appear here.' : 'Wait for the owner to assign and release a shirt job. Do not print unreleased orders.'}</p>
                    </div>)}
                    <ul className="print-packages">{shown.map(pkg => <PrintPackage key={pkg.key} pkg={pkg} open={isOpen(pkg)}
                        onToggle={() => toggle(pkg)} reload={reload} online={data.online} stale={!!data.error} />)}</ul>
                    {data.jobs.length === 100 && <p className="production-help">Showing the latest 100 available jobs.</p>}
                </>}
            </>}
    </section>;
}
