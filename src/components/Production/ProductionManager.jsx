import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Pause, Send, UserPlus, UserX } from 'lucide-react';
import LoadingState from '../ui/LoadingState.jsx';
import {
    MAX_BATCH_JOBS, productionBatchLines, productionCandidates, productionCustomerOf, productionGroupMatches,
    productionLineKey, productionOrderGroups, productionQuantity, walletPeso
} from '../../lib/production.js';
import { useProductionData, useProductionMutation, useProductionWallet } from './productionHooks.js';
import { DesignThumb, JobActivity, JobCounts, JobHeading, JobInstructions, JobPhoto, MutationNotice, ProductionHeader, ProductionNotice } from './ProductionParts.jsx';
import { OperatorPayout, OperatorWallet, UnattributedShirts } from './PrintWallet.jsx';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import './Production.css';

const isActive = member => member.active === true || member.active === 1;
const employeeName = member => member.name || member.displayName || member.email;

function EmployeeAccounts({ members, wallets, reload, online, stale }) {
    const readOnly = useReadOnly();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = readOnly || !online || stale || mutation.busy || mutation.uncertain;
    const employees = members.filter(member => member.role === 'print_operator');
    const walletOf = new Map(wallets.wallets.map(wallet => [wallet.memberId, wallet]));
    const due = wallets.wallets.reduce((total, wallet) => total + Math.max(0, wallet.balanceCentavos), 0);
    const invite = event => {
        event.preventDefault();
        mutation.run('/api/members', { email: email.trim(), name: name.trim() || 'Print operator', role: 'print_operator' },
            'Employee account prepared. They sign in with a code sent to this email.', () => { setEmail(''); setName(''); });
    };
    return <details className="production-section">
        <summary>Employee accounts{employees.length ? ` (${employees.length})` : ''}{due > 0 ? ` · ${walletPeso(due)} due` : ''}</summary>
        <p className="production-help">Prepare one employee at a time. This does not send an invitation or grant Cloudflare access.</p>
        <ProductionNotice>Only emails on your team can open the print queue. They sign in with a code sent to their email, then create their own PIN. No employee is added automatically.</ProductionNotice>
        <form onSubmit={invite}>
            <fieldset disabled={blocked} className="production-form-grid">
                <legend className="production-sr-only">Prepare employee account</legend>
                <label className="production-field">Employee name
                    <input value={name} maxLength={80} autoComplete="off" onChange={event => setName(event.target.value)} />
                </label>
                <label className="production-field">Individual email address
                    <input type="email" value={email} required maxLength={254} autoComplete="off" onChange={event => setEmail(event.target.value)} />
                </label>
                <button type="submit" className="production-button" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}><UserPlus size={18} aria-hidden="true" />Prepare account</button>
            </fieldset>
        </form>
        {wallets.error && <ProductionNotice error>Shirt counts and wallets could not be loaded. {wallets.error.message} Payouts are paused; use Reload.</ProductionNotice>}
        <ul className="production-employees">
            {employees.map(member => {
                const wallet = walletOf.get(member.id);
                return <li key={member.id}>
                    <div className="production-employee">
                        <strong>{employeeName(member)}</strong>{member.name && <p>{member.email}</p>}
                        <span>{isActive(member) ? 'Active print operator' : 'Access revoked'}</span>
                        {wallet ? <OperatorWallet wallet={wallet} />
                            : !wallets.error && wallets.loading && <p role="status">Loading shirt count…</p>}
                    </div>
                    <div className="production-employee-actions">
                        {wallet && <OperatorPayout wallet={wallet} reload={reload} online={online} stale={stale || !!wallets.error} />}
                        <button type="button" className="production-button" disabled={blocked} title={readOnly ? READ_ONLY_HINT : undefined}
                            onClick={() => mutation.run(`/api/members/${member.id}`, { active: !isActive(member) },
                                isActive(member) ? 'Employee access revoked; unfinished jobs are on hold.' : 'Employee account reactivated. Jobs stay on hold until re-released.',
                                undefined, 'PATCH')}>
                            <UserX size={18} aria-hidden="true" />{isActive(member) ? 'Revoke access' : 'Reactivate'}
                        </button>
                    </div>
                </li>;
            })}
        </ul>
        {!employees.length && <p className="production-help">No print-operator accounts are prepared yet.</p>}
        {wallets.wallets[0] && <p className="production-help">Pay rule: {walletPeso(wallets.wallets[0].rateCentavos)} for each complete {wallets.wallets[0].rateShirts} shirts
            you accept in QA, credited to the person who printed them. Partial batches carry over as a count; they are never paid in fractions.</p>}
        <UnattributedShirts unattributed={wallets.unattributed} />
        <MutationNotice mutation={mutation} online={online} />
    </details>;
}

function PrepareJobs({ candidates, transactions, employees, reload, online, stale }) {
    const readOnly = useReadOnly();
    const [selected, setSelected] = useState(() => new Set());
    const [search, setSearch] = useState('');
    const [assignee, setAssignee] = useState('');
    const [instructions, setInstructions] = useState('');
    const [releaseNow, setReleaseNow] = useState(false);
    const [artwork, setArtwork] = useState(false);
    const [blanks, setBlanks] = useState(false);
    const [validation, setValidation] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = readOnly || !online || stale || mutation.busy || mutation.uncertain;
    const groups = useMemo(() => productionOrderGroups(candidates, transactions), [candidates, transactions]);
    const visibleGroups = groups.filter(group => productionGroupMatches(group, search));
    // Lines that were prepared elsewhere or changed drop out of the selection automatically.
    const chosen = candidates.filter(candidate => selected.has(productionLineKey(candidate)));
    const shirts = chosen.reduce((total, line) => total + line.required, 0);
    const tooMany = chosen.length > MAX_BATCH_JOBS;
    const employee = employees.find(item => item.id === assignee);
    const toggle = (keys, on) => setSelected(current => {
        const next = new Set(current);
        for (const key of keys) { if (on) next.add(key); else next.delete(key); }
        return next;
    });
    const submit = event => {
        event.preventDefault();
        if (!chosen.length || tooMany || !employee) {
            setValidation(tooMany ? `Choose up to ${MAX_BATCH_JOBS} shirt lines at a time.` : 'Choose at least one shirt line and an active print operator.');
            return;
        }
        if (releaseNow && (!artwork || !blanks)) { setValidation('Confirm the artwork and blank shirts before releasing.'); return; }
        setValidation('');
        const count = `${chosen.length} job${chosen.length === 1 ? '' : 's'}`;
        mutation.run('/api/production/jobs/batch', {
            lines: productionBatchLines(chosen), assigneeId: assignee, instructions: instructions.trim(),
            ...(releaseNow ? { release: true, artworkReady: true, blanksReady: true } : {})
        }, releaseNow ? `${count} released to ${employeeName(employee)}. They can start printing.`
            : `${count} prepared for ${employeeName(employee)}. Release them when artwork and blanks are ready.`,
        () => { setSelected(new Set()); setInstructions(''); setArtwork(false); setBlanks(false); });
    };
    return <details className="production-section" open={candidates.length > 0 || undefined}>
        <summary>Prepare shirt jobs{candidates.length ? ` (${candidates.length} lines waiting)` : ''}</summary>
        <p className="production-help">Tick the shirt lines to print, grouped by the customer who ordered. Each line becomes one job for its full quantity.</p>
        {!employees.length && <ProductionNotice>Add an active print-operator account first, then choose shirt lines.</ProductionNotice>}
        <form onSubmit={submit}>
            <fieldset disabled={blocked || !employees.length}>
                <legend className="production-sr-only">Shirt job preparation</legend>
                {candidates.length > 0 && <label className="production-field">Find customer, order or design
                    <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
                </label>}
                {candidates.length > 0 && !visibleGroups.length && <p className="production-help">No waiting shirt lines match “{search.trim()}”.</p>}
                <ul className="production-picker">
                    {visibleGroups.map(group => {
                        const keys = group.lines.map(productionLineKey);
                        const picked = keys.filter(key => selected.has(key)).length;
                        return <li key={group.orderId} className="production-order-group">
                            <label className="production-order-check">
                                <input type="checkbox" checked={picked === keys.length}
                                    ref={element => { if (element) element.indeterminate = picked > 0 && picked < keys.length; }}
                                    onChange={event => toggle(keys, event.target.checked)} />
                                <span className="production-order-name">{group.customerName}</span>
                                <span className="production-order-meta">
                                    <span className="production-order-ref">{group.orderId}</span>
                                    {group.date && <span>{new Date(group.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>}
                                    <span>{group.shirts} shirt{group.shirts === 1 ? '' : 's'}</span>
                                </span>
                            </label>
                            <ul className="production-lines">
                                {group.lines.map(line => {
                                    const key = productionLineKey(line);
                                    return <li key={key}>
                                        <label className="production-line">
                                            <input type="checkbox" checked={selected.has(key)} onChange={event => toggle([key], event.target.checked)} />
                                            <DesignThumb src={line.designImageUrl} />
                                            <span className="production-line-text">
                                                <strong>{line.designName}</strong>
                                                <span>{[line.brand, line.color || 'No color', line.size].join(' · ')}</span>
                                            </span>
                                            <span className="production-line-qty"><strong>{line.required}</strong> shirt{line.required === 1 ? '' : 's'}</span>
                                        </label>
                                    </li>;
                                })}
                            </ul>
                        </li>;
                    })}
                </ul>
                {candidates.length > 0 && <>
                    <div className="production-form-grid">
                        <label className="production-field">Assign to
                            <select value={assignee} required onChange={event => setAssignee(event.target.value)}>
                                <option value="">Choose employee</option>
                                {employees.map(item => <option key={item.id} value={item.id}>{employeeName(item)}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className="production-field">Print instructions for these jobs
                        <textarea rows="2" maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)}
                            aria-describedby="production-instructions-help" />
                    </label>
                    <p id="production-instructions-help" className="production-help">Visible to the employee with each job's design photo. Print details only. No customer names, contacts, addresses or payment details.</p>
                    <label className="production-checkbox"><input type="checkbox" checked={releaseNow} onChange={event => setReleaseNow(event.target.checked)} />
                        Release now so they can start printing</label>
                    {releaseNow && <div className="production-release">
                        <label className="production-checkbox"><input type="checkbox" checked={artwork} onChange={event => setArtwork(event.target.checked)} />
                            I have supplied the correct artwork for every chosen line.</label>
                        <label className="production-checkbox"><input type="checkbox" checked={blanks} onChange={event => setBlanks(event.target.checked)} />
                            I have checked the blanks, colors, sizes and quantities.</label>
                        <p className="production-help">Releasing moves each chosen order to In progress and stops customer self-edits. Payment does not release print jobs.</p>
                    </div>}
                    <div className="production-batch-bar" role="status">
                        <p><strong>{chosen.length}</strong> line{chosen.length === 1 ? '' : 's'} · <strong>{shirts}</strong> shirt{shirts === 1 ? '' : 's'} selected
                            {tooMany && <span className="production-validation"> Choose up to {MAX_BATCH_JOBS} at a time.</span>}</p>
                        <div className="production-actions">
                            {chosen.length > 0 && <button type="button" className="production-button" onClick={() => setSelected(new Set())}>Clear</button>}
                            <button type="submit" className="production-button production-primary"
                                disabled={readOnly || !chosen.length || tooMany || !assignee || (releaseNow && (!artwork || !blanks))}
                                title={readOnly ? READ_ONLY_HINT : undefined}>
                                {releaseNow ? <Send size={18} aria-hidden="true" /> : null}
                                {releaseNow ? 'Prepare and release' : 'Prepare'} {chosen.length || ''} job{chosen.length === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                </>}
            </fieldset>
        </form>
        {!candidates.length && <p className="production-help">No unprepared active shirt lines are waiting. Reload after adding an order.</p>}
        {validation && <p className="production-validation" role="alert">{validation}</p>}
        <MutationNotice mutation={mutation} online={online} />
    </details>;
}

function OwnerJob({ job, customer, sources, employees, reload, online, stale }) {
    const readOnly = useReadOnly();
    const [artwork, setArtwork] = useState(false);
    const [blanks, setBlanks] = useState(false);
    const [assignee, setAssignee] = useState('');
    const [accepted, setAccepted] = useState('');
    const [rejected, setRejected] = useState('');
    const [note, setNote] = useState('');
    const [validation, setValidation] = useState('');
    const [revisedLine, setRevisedLine] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = readOnly || !online || stale || mutation.busy || mutation.uncertain;
    const canRelease = ['draft', 'held'].includes(job.status);
    const replacements = sources.filter(source => source.sourceId === job.sourceId);
    const revise = retireOnly => {
        const source = replacements.find(source => productionLineKey(source) === revisedLine);
        if (!note.trim() || (!retireOnly && !source)) {
            setValidation('Add a review reason and choose the current shirt variant before preparing a replacement.'); return;
        }
        if (!window.confirm(retireOnly
            ? 'Retire this held job? All original counts and events stay in history. It will no longer block this order.'
            : 'Replace this held job with a new draft for the selected current variant? Original counts remain in history and will not transfer.')) return;
        mutation.run(`/api/production/jobs/${job.id}/revise`, {
            expectedVersion: job.version, confirmed: true, note: note.trim(), retireOnly,
            ...(!retireOnly ? { itemIndex: source.itemIndex, expectedSourceToken: source.sourceToken,
                assigneeId: assignee || job.assignee.id, instructions: job.instructions } : {})
        }, retireOnly ? 'Job retired; original production history is preserved.' : 'Revised draft prepared. Review and release it before printing.',
        () => { setNote(''); setRevisedLine(''); });
    };
    const submit = action => {
        setValidation('');
        let body = { expectedVersion: job.version };
        if (action === 'release') {
            body = { ...body, artworkReady: artwork, blanksReady: blanks, ...(assignee ? { assigneeId: assignee } : {}) };
        } else if (action === 'qa') {
            const good = productionQuantity(accepted || '0', job.awaitingQA, true);
            const bad = productionQuantity(rejected || '0', job.awaitingQA, true);
            if (good === null || bad === null || good + bad === 0 || good + bad > job.awaitingQA) {
                setValidation(`Accept or reject a total from 1 to ${job.awaitingQA}, using whole quantities.`); return;
            }
            if (bad && !note.trim()) { setValidation('Describe what needs rework.'); return; }
            body = { ...body, accepted: good, rejected: bad, note: note.trim() };
        } else {
            if (!note.trim()) { setValidation('Add a reason before putting this job on hold.'); return; }
            body = { ...body, note: note.trim() };
        }
        mutation.run(`/api/production/jobs/${job.id}/${action}`, body,
            action === 'release' ? 'Job released. The full order is now in progress.' : action === 'hold' ? 'Job withdrawn from the employee queue.' : 'QA recorded. Rejected shirts return to the print count.',
            () => { setArtwork(false); setBlanks(false); setAccepted(''); setRejected(''); setNote(''); });
    };
    return <li className="production-job">
        <JobHeading job={job} owner customer={customer} />
        <JobPhoto job={job} />
        <JobCounts job={job} />
        <JobInstructions job={job} />
        {job.sourceChanged && <ProductionNotice error>
            The source shirt line changed or was removed. Printing is stopped. Review the original variant and quantity shown above.
            Prepare an explicitly reviewed replacement or retire the old job. Original print and quality counts remain in its history.
        </ProductionNotice>}
        {!['completed', 'superseded'].includes(job.status) && <fieldset className="production-work" disabled={blocked}>
            <legend className="production-sr-only">Manage {job.jobCode}</legend>
            {canRelease && <div className="production-release">
                <h4>{job.status === 'held' ? 'Review and re-release' : 'Release to employee'}</h4>
                <label className="production-field">Print operator
                    <select value={assignee || job.assignee.id} onChange={event => setAssignee(event.target.value)}>
                        {!employees.some(employee => employee.id === job.assignee.id) && <option value={job.assignee.id} disabled>{job.assignee.name} — inactive</option>}
                        {employees.map(employee => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}
                    </select>
                </label>
                <label className="production-checkbox"><input type="checkbox" checked={artwork} onChange={event => setArtwork(event.target.checked)} />
                    I have supplied the correct artwork separately.</label>
                <label className="production-checkbox"><input type="checkbox" checked={blanks} onChange={event => setBlanks(event.target.checked)} />
                    I have checked the blanks, color, size and quantity.</label>
                <p className="production-help">Manual release starts fulfillment for every active row in this order and stops customer self-edits. Payment does not release print jobs.</p>
                <button type="button" className="production-button production-primary"
                    disabled={readOnly || job.sourceChanged || !artwork || !blanks || !employees.some(employee => employee.id === (assignee || job.assignee.id))}
                    title={readOnly ? READ_ONLY_HINT : undefined}
                    onClick={() => submit('release')}><Send size={18} aria-hidden="true" />{job.status === 'held' ? 'Re-release job' : 'Release job'}</button>
            </div>}
            {job.awaitingQA > 0 && !job.sourceChanged && <div className="production-qa">
                <h4>Owner quality check</h4>
                <div className="production-actions">
                    <label className="production-field production-quantity">Accept quantity
                        <input type="number" min="0" max={job.awaitingQA} step="1" inputMode="numeric"
                            value={accepted} onChange={event => setAccepted(event.target.value)} />
                    </label>
                    <label className="production-field production-quantity">Reject for rework
                        <input type="number" min="0" max={job.awaitingQA} step="1" inputMode="numeric"
                            value={rejected} onChange={event => setRejected(event.target.value)} />
                    </label>
                    <button type="button" className="production-button production-primary" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => submit('qa')}>
                        <CheckCircle2 size={18} aria-hidden="true" />Save quality check
                    </button>
                </div>
                <p className="production-help">Accepted shirts count toward completion. Rejected shirts need printing again; the original print event stays in the audit.</p>
            </div>}
            <label className="production-field">QA, rework or hold note
                <textarea rows="2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)}
                    placeholder="Print details only — no customer or payment information" />
            </label>
            {job.status === 'held' && <div className="production-release">
                <h4>Replace or retire this job</h4>
                <label className="production-field">Current source variant
                    <select value={revisedLine} onChange={event => setRevisedLine(event.target.value)}>
                        <option value="">Choose the reviewed current variant</option>
                        {replacements.map(source => <option key={productionLineKey(source)} value={productionLineKey(source)}>
                            {source.designName} / {source.color || 'No color'} / {source.size} / {source.required} shirts
                        </option>)}
                    </select>
                </label>
                <p className="production-help">Replacement starts a fresh draft with zero accepted shirts. Do not transfer completed work to a different design or variant.</p>
                <div className="production-actions">
                    <button type="button" className="production-button" disabled={readOnly || !revisedLine || !note.trim()} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => revise(false)}>Prepare revised job</button>
                    <button type="button" className="production-button production-warning" disabled={readOnly || !note.trim()} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => revise(true)}>Retire held job</button>
                </div>
            </div>}
            {job.status !== 'held' && <button type="button" className="production-button production-warning" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => submit('hold')}>
                <Pause size={18} aria-hidden="true" />Hold and withdraw
            </button>}
        </fieldset>}
        {job.status === 'completed' && <p className="production-help">All shirts accepted. Finish packing and mark the whole order Ready in Orders; printing alone does not mark the order Ready.</p>}
        {validation && <p className="production-validation" role="alert">{validation}</p>}
        <MutationNotice mutation={mutation} online={online} />
        {mutation.busy && <p role="status">Saving job…</p>}
        <JobActivity job={job} />
    </li>;
}

export default function ProductionManager({ transactions = [], refetch }) {
    const readOnly = useReadOnly();
    const data = useProductionData(true);
    const wallets = useProductionWallet(true);
    const [filter, setFilter] = useState('active');
    const [search, setSearch] = useState('');
    const [orderRefreshError, setOrderRefreshError] = useState(false);
    const { load: loadWallets } = wallets;
    const reload = useCallback(async () => {
        await Promise.all([data.load(), loadWallets()]);
        try { await refetch?.(); setOrderRefreshError(false); }
        catch { setOrderRefreshError(true); }
    }, [data.load, loadWallets, refetch]);
    const candidates = useMemo(() => productionCandidates(transactions, data.sources, data.jobs), [transactions, data.sources, data.jobs]);
    const customerOf = useMemo(() => productionCustomerOf(transactions), [transactions]);
    const employees = data.members.filter(member => member.role === 'print_operator' && isActive(member));
    const jobs = data.jobs.filter(job => (filter === 'all' || (filter === 'completed' ? job.status === 'completed' : !['completed', 'superseded'].includes(job.status)))
        && `${job.jobCode} ${job.orderId} ${job.designName} ${customerOf(job)}`.toLowerCase().includes(search.toLowerCase().trim()));
    return <section className="production" aria-label="Owner print production">
        <ProductionHeader title="Print production" subtitle="Prepare, release and quality-check shirt jobs. Artwork is provided separately."
            loading={data.loading} onReload={reload} />
        {!data.online && <ProductionNotice error>You are offline. Your inputs remain here. Reconnect and reload before saving.</ProductionNotice>}
        {data.error?.status === 404 ? <ProductionNotice>Production is disabled until the database migration and access setup are complete. No employee queue is exposed.</ProductionNotice>
            : <>
                {data.error && <ProductionNotice error>Production data could not be refreshed. {data.error.message} Saving is paused; use Reload.</ProductionNotice>}
                {orderRefreshError && <ProductionNotice error>The print save was confirmed, but Orders could not refresh. Reload before preparing another job.</ProductionNotice>}
                {data.loading && !data.jobs.length && !data.members.length ? <LoadingState label="Loading print production…" /> : <>
                    <EmployeeAccounts members={data.members} wallets={wallets} reload={reload} online={data.online} stale={!!data.error} />
                    <PrepareJobs candidates={candidates} transactions={transactions} employees={employees} reload={reload} online={data.online} stale={!!data.error || orderRefreshError} />
                    <div className="production-toolbar">
                        <label className="production-field production-filter">Show jobs
                            <select value={filter} onChange={event => setFilter(event.target.value)}>
                                <option value="active">Not yet accepted</option><option value="completed">Accepted</option><option value="all">All recent jobs</option>
                            </select>
                        </label>
                        <label className="production-field">Find customer, order or job
                            <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
                        </label>
                    </div>
                    {!jobs.length && !data.error && <div className="production-empty">
                        <h3>{search ? 'No matching print jobs' : 'No print jobs in this view'}</h3>
                        <p>{search ? 'Try another customer name, order reference or job code.' : 'Prepare shirt lines above. Employees see nothing until you release a job.'}</p>
                    </div>}
                    <ul className="production-jobs">{jobs.map(job => <OwnerJob key={job.id} job={job} customer={customerOf(job)} sources={data.sources} employees={employees}
                        reload={reload} online={data.online} stale={!!data.error} />)}</ul>
                </>}
            </>}
    </section>;
}
