import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Pause, Send, UserPlus, UserX } from 'lucide-react';
import LoadingState from '../ui/LoadingState.jsx';
import { productionCandidates, productionLineKey, productionQuantity } from '../../lib/production.js';
import { useProductionData, useProductionMutation } from './productionHooks.js';
import { JobActivity, JobCounts, JobHeading, JobInstructions, MutationNotice, ProductionHeader, ProductionNotice } from './ProductionParts.jsx';
import './Production.css';

const isActive = member => member.active === true || member.active === 1;
const employeeName = member => member.name || member.displayName || member.email;

function EmployeeAccounts({ members, reload, online, stale }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = !online || stale || mutation.busy || mutation.uncertain;
    const employees = members.filter(member => member.role === 'print_operator');
    const invite = event => {
        event.preventDefault();
        mutation.run('/api/members', { email: email.trim(), name: name.trim() || 'Print operator', role: 'print_operator' },
            'Employee account prepared. Cloudflare Access must also allow this email.', () => { setEmail(''); setName(''); });
    };
    return <details className="production-section">
        <summary>Employee accounts{employees.length ? ` (${employees.length})` : ''}</summary>
        <p className="production-help">Prepare one employee at a time. This does not send an invitation or grant Cloudflare access.</p>
        <ProductionNotice>Login also requires the employee’s exact email to be allowed in the Cloudflare Access policy. No employee is added automatically.</ProductionNotice>
        <form onSubmit={invite}>
            <fieldset disabled={blocked} className="production-form-grid">
                <legend className="production-sr-only">Prepare employee account</legend>
                <label className="production-field">Employee name
                    <input value={name} maxLength={80} autoComplete="off" onChange={event => setName(event.target.value)} />
                </label>
                <label className="production-field">Individual email address
                    <input type="email" value={email} required maxLength={254} autoComplete="off" onChange={event => setEmail(event.target.value)} />
                </label>
                <button type="submit" className="production-button"><UserPlus size={18} aria-hidden="true" />Prepare account</button>
            </fieldset>
        </form>
        <ul className="production-employees">
            {employees.map(member => <li key={member.id}>
                <div><strong>{employeeName(member)}</strong>{member.name && <p>{member.email}</p>}
                    <span>{isActive(member) ? 'Active print operator' : 'Access revoked'}</span></div>
                <button type="button" className="production-button" disabled={blocked}
                    onClick={() => mutation.run(`/api/members/${member.id}`, { active: !isActive(member) },
                        isActive(member) ? 'Employee access revoked; unfinished jobs are on hold.' : 'Employee account reactivated. Jobs stay on hold until re-released.',
                        undefined, 'PATCH')}>
                    <UserX size={18} aria-hidden="true" />{isActive(member) ? 'Revoke access' : 'Reactivate'}
                </button>
            </li>)}
        </ul>
        {!employees.length && <p className="production-help">No print-operator accounts are prepared yet.</p>}
        <MutationNotice mutation={mutation} online={online} />
    </details>;
}

function PrepareJob({ candidates, employees, reload, online, stale }) {
    const [selected, setSelected] = useState('');
    const [assignee, setAssignee] = useState('');
    const [instructions, setInstructions] = useState('');
    const [validation, setValidation] = useState('');
    const mutation = useProductionMutation(reload);
    const source = candidates.find(candidate => productionLineKey(candidate) === selected);
    const blocked = !online || stale || mutation.busy || mutation.uncertain;
    const submit = event => {
        event.preventDefault();
        if (!source || !employees.some(employee => employee.id === assignee)) {
            setValidation('Choose a current shirt line and an active print operator.'); return;
        }
        setValidation('');
        mutation.run('/api/production/jobs', {
            sourceId: source.sourceId, itemIndex: source.itemIndex, expectedSourceToken: source.sourceToken,
            assigneeId: assignee, instructions: instructions.trim()
        }, 'Job prepared. It is hidden from the employee until you release it.',
        () => { setSelected(''); setInstructions(''); });
    };
    return <details className="production-section">
        <summary>Prepare a shirt job</summary>
        <p className="production-help">One job per shirt variant, for the full order quantity. No past orders are released automatically.</p>
        {!employees.length && <ProductionNotice>Prepare an active print-operator account first, then choose a shirt line.</ProductionNotice>}
        <form onSubmit={submit}>
            <fieldset disabled={blocked || !employees.length}>
                <legend className="production-sr-only">Shirt job preparation</legend>
                <div className="production-form-grid">
                    <label className="production-field">Unprepared shirt line
                        <select value={selected} required onChange={event => setSelected(event.target.value)}>
                            <option value="">Choose a shirt line</option>
                            {candidates.map(candidate => <option key={productionLineKey(candidate)} value={productionLineKey(candidate)}>
                                {candidate.orderId} · {candidate.designName} · {candidate.brand} / {candidate.color || 'No color'} / {candidate.size} · {candidate.required} shirts
                            </option>)}
                        </select>
                    </label>
                    <label className="production-field">Assign to
                        <select value={assignee} required onChange={event => setAssignee(event.target.value)}>
                            <option value="">Choose employee</option>
                            {employees.map(employee => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}
                        </select>
                    </label>
                </div>
                <label className="production-field">Owner print instructions
                    <textarea rows="3" maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)}
                        aria-describedby="production-instructions-help" />
                </label>
                <p id="production-instructions-help" className="production-help">Visible to the assigned employee. Include only print instructions — no customer names, contacts, addresses, payment details or private comments. Provide artwork separately.</p>
                {source && <p>Prepare <strong>{source.required} shirts</strong>. This does not release the job or change payment or inventory.</p>}
                <button type="submit" className="production-button production-primary" disabled={!source || !assignee}>
                    Prepare job
                </button>
            </fieldset>
        </form>
        {!candidates.length && <p className="production-help">No unprepared active shirt lines are available. Reload after adding an order.</p>}
        {validation && <p className="production-validation" role="alert">{validation}</p>}
        <MutationNotice mutation={mutation} online={online} />
    </details>;
}

function OwnerJob({ job, sources, employees, reload, online, stale }) {
    const [artwork, setArtwork] = useState(false);
    const [blanks, setBlanks] = useState(false);
    const [assignee, setAssignee] = useState('');
    const [accepted, setAccepted] = useState('');
    const [rejected, setRejected] = useState('');
    const [note, setNote] = useState('');
    const [validation, setValidation] = useState('');
    const [revisedLine, setRevisedLine] = useState('');
    const mutation = useProductionMutation(reload);
    const blocked = !online || stale || mutation.busy || mutation.uncertain;
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
        <JobHeading job={job} owner />
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
                    disabled={job.sourceChanged || !artwork || !blanks || !employees.some(employee => employee.id === (assignee || job.assignee.id))}
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
                    <button type="button" className="production-button production-primary" onClick={() => submit('qa')}>
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
                    <button type="button" className="production-button" disabled={!revisedLine || !note.trim()} onClick={() => revise(false)}>Prepare revised job</button>
                    <button type="button" className="production-button production-warning" disabled={!note.trim()} onClick={() => revise(true)}>Retire held job</button>
                </div>
            </div>}
            {job.status !== 'held' && <button type="button" className="production-button production-warning" onClick={() => submit('hold')}>
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
    const data = useProductionData(true);
    const [filter, setFilter] = useState('active');
    const [search, setSearch] = useState('');
    const [orderRefreshError, setOrderRefreshError] = useState(false);
    const reload = useCallback(async () => {
        await data.load();
        try { await refetch?.(); setOrderRefreshError(false); }
        catch { setOrderRefreshError(true); }
    }, [data.load, refetch]);
    const candidates = useMemo(() => productionCandidates(transactions, data.sources, data.jobs), [transactions, data.sources, data.jobs]);
    const employees = data.members.filter(member => member.role === 'print_operator' && isActive(member));
    const jobs = data.jobs.filter(job => (filter === 'all' || (filter === 'completed' ? job.status === 'completed' : !['completed', 'superseded'].includes(job.status)))
        && `${job.jobCode} ${job.orderId} ${job.designName}`.toLowerCase().includes(search.toLowerCase().trim()));
    return <section className="production" aria-label="Owner print production">
        <ProductionHeader title="Print production" subtitle="Prepare, release and quality-check shirt jobs. Artwork is provided separately."
            loading={data.loading} onReload={reload} />
        {!data.online && <ProductionNotice error>You are offline. Your inputs remain here. Reconnect and reload before saving.</ProductionNotice>}
        {data.error?.status === 404 ? <ProductionNotice>Production is disabled until the database migration and access setup are complete. No employee queue is exposed.</ProductionNotice>
            : <>
                {data.error && <ProductionNotice error>Production data could not be refreshed. {data.error.message} Saving is paused; use Reload.</ProductionNotice>}
                {orderRefreshError && <ProductionNotice error>The print save was confirmed, but Orders could not refresh. Reload before preparing another job.</ProductionNotice>}
                {data.loading && !data.jobs.length && !data.members.length ? <LoadingState label="Loading print production…" /> : <>
                    <EmployeeAccounts members={data.members} reload={reload} online={data.online} stale={!!data.error} />
                    <PrepareJob candidates={candidates} employees={employees} reload={reload} online={data.online} stale={!!data.error || orderRefreshError} />
                    <div className="production-toolbar">
                        <label className="production-field production-filter">Show jobs
                            <select value={filter} onChange={event => setFilter(event.target.value)}>
                                <option value="active">Not yet accepted</option><option value="completed">Accepted</option><option value="all">All recent jobs</option>
                            </select>
                        </label>
                        <label className="production-field">Find order or job
                            <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
                        </label>
                    </div>
                    {!jobs.length && !data.error && <div className="production-empty">
                        <h3>{search ? 'No matching print jobs' : 'No print jobs in this view'}</h3>
                        <p>{search ? 'Try another order reference or job code.' : 'Prepare an active shirt line above. Employees see nothing until you release a job.'}</p>
                    </div>}
                    <ul className="production-jobs">{jobs.map(job => <OwnerJob key={job.id} job={job} sources={data.sources} employees={employees}
                        reload={reload} online={data.online} stale={!!data.error} />)}</ul>
                </>}
            </>}
    </section>;
}
