import React, { useCallback, useMemo, useState } from 'react';
import { Archive, CheckCheck, CheckCircle2, Hourglass, Pause, RefreshCw, Send, UserPlus, UserX } from 'lucide-react';
import LoadingState from '../ui/LoadingState.jsx';
import {
    MAX_BATCH_JOBS, acceptAllPayload, acceptAllQueue, heldJobReview, orderDateLabel, packageReadiness, packageWaitingFor, productionBatchLines,
    productionCandidates, productionCustomerOf, productionGroupMatches, productionLineKey, productionOrderDateOf, productionOrderGroups,
    productionQuantity, qaWaitingQueue, shirtLabel, walletPeso
} from '../../lib/production.js';
import { useProductionData, useProductionMutation, useProductionWallet } from './productionHooks.js';
import { DesignThumb, JobActivity, JobCounts, JobHeading, JobInstructions, JobPhoto, MutationNotice, ProductionHeader, ProductionNotice } from './ProductionParts.jsx';
import { OperatorPayout, OperatorWallet, UnattributedShirts } from './PrintWallet.jsx';
import { OperatorHistory } from './PrintHistory.jsx';
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
                        <OperatorHistory memberId={member.id} name={employeeName(member)} wallet={wallet} online={online} />
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
    // Oldest order first, so a selection above the per-save ceiling prepares the oldest lines
    // and keeps the rest ticked for the next save. There is no selection limit.
    const chosen = groups.flatMap(group => group.lines).filter(line => selected.has(productionLineKey(line)));
    const shirts = chosen.reduce((total, line) => total + line.required, 0);
    const batch = chosen.slice(0, MAX_BATCH_JOBS);
    const later = chosen.length - batch.length;
    const employee = employees.find(item => item.id === assignee);
    const toggle = (keys, on) => setSelected(current => {
        const next = new Set(current);
        for (const key of keys) { if (on) next.add(key); else next.delete(key); }
        return next;
    });
    const submit = event => {
        event.preventDefault();
        if (!chosen.length || !employee) {
            setValidation('Choose at least one shirt line and an active print operator.');
            return;
        }
        if (releaseNow && (!artwork || !blanks)) { setValidation('Confirm the artwork and blank shirts before releasing.'); return; }
        setValidation('');
        const count = `${batch.length} job${batch.length === 1 ? '' : 's'}`;
        const rest = later ? ` ${later} more line${later === 1 ? ' stays' : 's stay'} ticked for your next save.` : '';
        mutation.run('/api/production/jobs/batch', {
            lines: productionBatchLines(batch), assigneeId: assignee, instructions: instructions.trim(),
            ...(releaseNow ? { release: true, artworkReady: true, blanksReady: true } : {})
        }, (releaseNow ? `${count} released to ${employeeName(employee)}. They can start printing.`
            : `${count} prepared for ${employeeName(employee)}. Release them when artwork and blanks are ready.`) + rest,
        () => {
            if (later) {
                setSelected(current => {
                    const next = new Set(current);
                    for (const line of batch) next.delete(productionLineKey(line));
                    return next;
                });
                return;
            }
            setSelected(new Set()); setInstructions(''); setArtwork(false); setBlanks(false);
        });
    };
    return <details className="production-section" open={candidates.length > 0 || undefined}>
        <summary>Prepare shirt jobs{candidates.length ? ` (${candidates.length} lines waiting)` : ''}</summary>
        <p className="production-help">Oldest orders first. Tick the shirt lines to print, grouped by the customer who ordered. Each line becomes one job for its full quantity.</p>
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
                                    {group.date && <span>{orderDateLabel(group.date)}</span>}
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
                    <p id="production-instructions-help" className="production-help">Visible to the employee with each job's design photo and the customer's name for the package. Don't add contacts, addresses or payment details.</p>
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
                            {later > 0 && <span className="production-batch-note">This save prepares the {MAX_BATCH_JOBS} oldest; the other {later} stay ticked for the next save.</span>}</p>
                        <div className="production-actions">
                            {chosen.length > 0 && <button type="button" className="production-button" onClick={() => setSelected(new Set())}>Clear</button>}
                            <button type="submit" className="production-button production-primary"
                                disabled={readOnly || !chosen.length || !assignee || (releaseNow && (!artwork || !blanks))}
                                title={readOnly ? READ_ONLY_HINT : undefined}>
                                {releaseNow ? <Send size={18} aria-hidden="true" /> : null}
                                {releaseNow ? 'Prepare and release' : 'Prepare'} {later > 0 ? `${batch.length} of ${chosen.length}` : chosen.length || ''} job{chosen.length === 1 ? '' : 's'}
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

// One tap to accept every printed shirt waiting for QA (owner request 2026-10-21). Rejections
// stay on each job's own quality check, so problem shirts are sent back before accepting all.
// Only whole printed packages qualify (owner decision 2026-11-03); printed shirts on an order that
// still has shirts to print are listed below with what the package waits for.
function AcceptAllQA({ jobs, readiness, customerOf, reload, online, stale }) {
    const readOnly = useReadOnly();
    const mutation = useProductionMutation(reload);
    const queue = acceptAllQueue(jobs, readiness);
    const waiting = useMemo(() => {
        const orders = new Map();
        for (const job of qaWaitingQueue(jobs, readiness)) {
            if (!orders.has(job.orderId)) {
                orders.set(job.orderId, { orderId: job.orderId, customer: customerOf(job) || job.customerName || 'Unknown customer',
                    printed: 0, readiness: readiness.get(job.orderId) });
            }
            orders.get(job.orderId).printed += job.awaitingQA;
        }
        return [...orders.values()];
    }, [jobs, readiness, customerOf]);
    if (!queue.length && !waiting.length && !mutation.error) return null;
    const batch = queue.slice(0, MAX_BATCH_JOBS);
    const later = queue.length - batch.length;
    const shirts = batch.reduce((total, job) => total + job.awaitingQA, 0);
    const blocked = readOnly || !online || stale || mutation.busy || mutation.uncertain;
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const accept = () => {
        if (!window.confirm(`Accept all ${plural(shirts, 'shirt')} across ${plural(batch.length, 'job')} as good?\n\nThey count toward the printer's pay, and orders whose shirts are all accepted move to Ready. To send any back for rework, cancel and use that job's quality check first.`)) return;
        mutation.run('/api/production/qa', { jobs: acceptAllPayload(batch) },
            result => `Accepted ${plural(shirts, 'shirt')} across ${plural(batch.length, 'job')}.`
                + (result?.readyOrders ? ` ${plural(result.readyOrders, 'order')} moved to Ready.` : '')
                + (later ? ` ${plural(later, 'more job')} still ${later === 1 ? 'waits' : 'wait'} for QA.` : ''));
    };
    return <section className="production-qa-all" aria-label="Quality check">
        {queue.length > 0 && <>
            <div className="production-qa-all-head">
                <div>
                    <h3>Waiting for your QA</h3>
                    <p><strong>{plural(queue.reduce((total, job) => total + job.awaitingQA, 0), 'shirt')}</strong> printed across <strong>{plural(queue.length, 'job')}</strong>, all from fully printed packages.</p>
                </div>
                <button type="button" className="production-button production-primary" disabled={blocked}
                    title={readOnly ? READ_ONLY_HINT : undefined} onClick={accept}>
                    <CheckCheck size={18} aria-hidden="true" />Accept all {later ? `${shirts} shirts (oldest ${batch.length} jobs)` : plural(shirts, 'shirt')}
                </button>
            </div>
            <details className="production-qa-all-list">
                <summary>Show the jobs</summary>
                <ul>
                    {queue.map(job => <li key={job.id}>
                        <span className="production-qa-all-job">{job.jobCode}</span>
                        <span className="production-qa-all-name">{job.designName} · {job.size}{customerOf(job) || job.customerName ? ` · ${customerOf(job) || job.customerName}` : ''}</span>
                        <strong>{job.awaitingQA}</strong>
                    </li>)}
                </ul>
            </details>
            <p className="production-help">Check the shirts first. To send some back for rework, use Reject on that job below, then accept the rest here.</p>
        </>}
        {waiting.length > 0 && <div className="production-qa-wait">
            <h3><Hourglass size={18} aria-hidden="true" />Printed, not ready for QA</h3>
            <p className="production-help">QA opens when every shirt on an order is printed, so you check each package at once.</p>
            <ul>
                {waiting.map(order => <li key={order.orderId}>
                    <span className="production-qa-wait-name">{order.customer}<span className="production-order-ref">{order.orderId}</span></span>
                    <span className="production-qa-wait-what"><strong className="num">{order.printed} printed</strong> · waiting for {packageWaitingFor(order.readiness)}</span>
                    {order.readiness?.notPrepared.length > 0 && <span className="production-qa-wait-lines">
                        Not in the print queue: {order.readiness.notPrepared.map(line => `${line.designName} · ${line.size} ×${line.required}`).join(', ')}.
                        If it needs printing, prepare it under Prepare shirt jobs.
                    </span>}
                </li>)}
            </ul>
        </div>}
        <MutationNotice mutation={mutation} online={online} />
        {mutation.busy && <p role="status">Accepting shirts…</p>}
    </section>;
}

// A held job's reason decides its notice, actions and default history note (owner report 2026-11-03).
const HELD_HELP = {
    same: 'Keeping clears the hold: nothing is reprinted and every count stays. Retire only if this shirt is no longer needed.',
    changed: 'A revised job starts at zero for the shirt now on the order. This job’s printed and accepted counts stay in its history. Retire it if the shirt isn’t needed.',
    gone: 'Retiring clears it from the queue. Its print and QA history and the printer’s pay stay.',
    hold: 'Re-release it above to continue, prepare a revised job, or retire it. Its print and QA history stays.'
};
const RETIRE_REASON = {
    changed: 'Retired after the shirt changed on the order.', gone: 'Retired: the shirt is no longer on an open order.'
};
function HeldNotice({ review }) {
    if (review.reason === 'same') {
        return <ProductionNotice>On hold because the order was edited. The shirt is still the same as when this job was prepared,
            so nothing needs reprinting.</ProductionNotice>;
    }
    if (review.reason === 'changed') {
        return <ProductionNotice error>On hold: this shirt changed on the order, so printing stopped.
            {review.current ? ` On the order now: ${shirtLabel(review.current)}.` : ' Choose the shirt now on the order below.'}</ProductionNotice>;
    }
    if (review.reason === 'gone') {
        return <ProductionNotice error>On hold: this shirt is no longer on an open order, so nothing here needs printing.</ProductionNotice>;
    }
    return null;
}

function OwnerJob({ job, readiness, customer, orderDate, sources, employees, reload, online, stale }) {
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
    const review = useMemo(() => heldJobReview(job, sources), [job, sources]);
    const canRelease = job.status === 'draft' || review?.reason === 'hold';
    const replacements = review?.lines ?? [];
    const chosenLine = revisedLine || (review?.current ? productionLineKey(review.current) : '');
    const canReplace = (review?.reason === 'changed' || review?.reason === 'hold') && replacements.length > 0;
    const revise = retireOnly => {
        const source = replacements.find(source => productionLineKey(source) === chosenLine);
        if (!retireOnly && !source) { setValidation('Choose the shirt now on the order first.'); return; }
        setValidation('');
        if (!window.confirm(retireOnly
            ? 'Retire this job?\n\nIt leaves the print queue and no longer holds this order. Its print and QA history and the printer’s pay stay.'
            : 'Replace this job with a new draft for the chosen shirt?\n\nThe new job starts at zero. This job’s printed and accepted counts stay in its history and don’t transfer.')) return;
        mutation.run(`/api/production/jobs/${job.id}/revise`, {
            expectedVersion: job.version, confirmed: true, retireOnly,
            note: note.trim() || (retireOnly ? RETIRE_REASON[review?.reason] || 'Retired by the owner.' : 'Replaced after the order changed.'),
            ...(!retireOnly ? { itemIndex: source.itemIndex, expectedSourceToken: source.sourceToken,
                assigneeId: assignee || job.assignee.id, instructions: job.instructions } : {})
        }, retireOnly ? 'Job retired. Its print and QA history stays.' : 'Revised draft prepared. Review and release it before printing.',
        () => { setNote(''); setRevisedLine(''); });
    };
    const keep = () => {
        setValidation('');
        if (!window.confirm('Keep this job?\n\nThe shirt is the same, so nothing is reprinted and its counts stay. If every shirt on the order is accepted, the order is Ready again.')) return;
        mutation.run(`/api/production/jobs/${job.id}/keep`, { expectedVersion: job.version, confirmed: true, ...(note.trim() ? { note: note.trim() } : {}) },
            result => result?.orderReady ? 'Job kept. Every shirt on this order is accepted, so the order is Ready again.' : 'Job kept. Nothing needs reprinting.',
            () => setNote(''));
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
            action === 'release' ? 'Job released. The full order is now in progress.' : action === 'hold' ? 'Job withdrawn from the employee queue.'
                : result => result?.orderReady ? 'QA recorded. Every shirt on this order is accepted, so the order is now Ready.' : 'QA recorded. Rejected shirts return to the print count.',
            () => { setArtwork(false); setBlanks(false); setAccepted(''); setRejected(''); setNote(''); });
    };
    return <li className="production-job">
        <JobHeading job={job} owner customer={customer} orderDate={orderDate ? orderDateLabel(orderDate) : ''} />
        <JobPhoto job={job} />
        <JobCounts job={job} />
        <JobInstructions job={job} />
        {review && <HeldNotice review={review} />}
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
            {job.awaitingQA > 0 && !job.sourceChanged && readiness && !readiness.printed && <div className="production-qa production-qa-waiting">
                <h4>Owner quality check</h4>
                <p>Opens when every shirt on {customer || job.customerName ? `${customer || job.customerName}’s` : 'this'} order is printed, so you check the whole package at once.</p>
                <p className="production-qa-waiting-for"><Hourglass size={18} aria-hidden="true" />Waiting for {packageWaitingFor(readiness)}</p>
                {readiness.notPrepared.length > 0 && <p className="production-help">
                    Not in the print queue: {readiness.notPrepared.map(line => `${line.designName} · ${line.size} ×${line.required}`).join(', ')}. If it needs printing, prepare it under Prepare shirt jobs.
                </p>}
            </div>}
            {job.awaitingQA > 0 && !job.sourceChanged && (!readiness || readiness.printed) && <div className="production-qa">
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
            {job.status !== 'held' && <label className="production-field">QA, rework or hold note
                <textarea rows="2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)}
                    placeholder="Print details only. No contact or payment information" />
            </label>}
            {review && <div className="production-release production-held">
                <h4>{review.reason === 'hold' ? 'Replace or retire this job' : 'Clear the hold'}</h4>
                {canReplace && <label className="production-field">{review.reason === 'changed' ? 'Shirt now on the order' : 'Replace with'}
                    <select value={chosenLine} onChange={event => setRevisedLine(event.target.value)}>
                        <option value="">Choose the shirt</option>
                        {replacements.map(source => <option key={productionLineKey(source)} value={productionLineKey(source)}>{shirtLabel(source)}</option>)}
                    </select>
                </label>}
                <label className="production-field">Note for the job history (optional)
                    <textarea rows="2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)}
                        placeholder="Print details only. No contact or payment information" />
                </label>
                <div className="production-actions">
                    {review.reason === 'same' && <button type="button" className="production-button production-primary" disabled={readOnly}
                        title={readOnly ? READ_ONLY_HINT : undefined} onClick={keep}><CheckCircle2 size={18} aria-hidden="true" />Keep this job</button>}
                    {canReplace && <button type="button" className={`production-button${review.reason === 'changed' ? ' production-primary' : ''}`}
                        disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => revise(false)}>
                        <RefreshCw size={18} aria-hidden="true" />Prepare revised job
                    </button>}
                    <button type="button" className={`production-button ${review.reason === 'gone' ? 'production-primary' : 'production-warning'}`}
                        disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => revise(true)}>
                        <Archive size={18} aria-hidden="true" />Retire job
                    </button>
                </div>
                <p className="production-help">{HELD_HELP[review.reason]}</p>
            </div>}
            {job.status !== 'held' && <button type="button" className="production-button production-warning" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => submit('hold')}>
                <Pause size={18} aria-hidden="true" />Hold and withdraw
            </button>}
        </fieldset>}
        {job.status === 'completed' && <p className="production-help">All shirts accepted. The order moves to Ready once every shirt on it is accepted.</p>}
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
    const readiness = useMemo(() => packageReadiness(data.jobs, candidates), [data.jobs, candidates]);
    const customerOf = useMemo(() => productionCustomerOf(transactions), [transactions]);
    const orderDateOf = useMemo(() => productionOrderDateOf(transactions), [transactions]);
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
                    <AcceptAllQA jobs={data.jobs} readiness={readiness} customerOf={customerOf} reload={reload} online={data.online} stale={!!data.error} />
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
                    <ul className="production-jobs">{jobs.map(job => <OwnerJob key={job.id} job={job} readiness={readiness.get(job.orderId)} customer={customerOf(job)} orderDate={orderDateOf(job)} sources={data.sources} employees={employees}
                        reload={reload} online={data.online} stale={!!data.error} />)}</ul>
                </>}
            </>}
    </section>;
}
