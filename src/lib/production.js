import { getSaleItems } from './orderItems.js';

export const productionStatus = {
    draft: 'Not released', released: 'Ready to print', printing: 'Printing',
    awaiting_qa: 'Awaiting owner QA', problem: 'Problem', held: 'On hold', completed: 'Accepted', superseded: 'Replaced / retired'
};
export const productionLineKey = (line) => `${line.sourceId}:${line.itemIndex ?? -1}`;
export function productionQuantity(value, max, allowZero = false) {
    if (!/^\d+$/.test(String(value))) return null;
    const quantity = Number(value);
    return Number.isSafeInteger(quantity) && quantity >= (allowZero ? 0 : 1) && quantity <= max ? quantity : null;
}

// Normalized order lines select candidates; server snapshots supply every label
// and quantity. Never spread the source transaction into a production payload.
export function productionCandidates(transactions, sources, jobs) {
    const active = new Set(transactions.flatMap(getSaleItems)
        .filter(line => line.details.category === 'shirts')
        .map(line => productionLineKey({ sourceId: line.transactionId, itemIndex: line.itemIndex })));
    const prepared = new Set(jobs.filter(job => job.status !== 'superseded').map(productionLineKey));
    return sources.filter(source => active.has(productionLineKey(source)) && !prepared.has(productionLineKey(source)))
        .map(source => ({
            sourceId: source.sourceId, itemIndex: source.itemIndex, orderId: source.orderId,
            designName: source.designName, brand: source.brand, color: source.color, size: source.size,
            required: source.required, sourceToken: source.sourceToken, designImageUrl: source.designImageUrl || null
        }));
}

// Owner display only: groups candidate lines by order, labelled with the customer who
// ordered. First in, first out: oldest order date first, then name and order number.
// Customer names never enter a payload.
export function productionOrderGroups(candidates, transactions) {
    const orders = new Map();
    for (const transaction of transactions) {
        const [line] = getSaleItems(transaction);
        if (line) orders.set(transaction.id, { customerName: line.details.customerName, date: transaction.date });
    }
    const groups = new Map();
    for (const candidate of candidates) {
        const order = orders.get(candidate.sourceId) || {};
        if (!groups.has(candidate.orderId)) {
            groups.set(candidate.orderId, { orderId: candidate.orderId, customerName: order.customerName || 'Unknown customer',
                date: order.date || null, lines: [], shirts: 0 });
        }
        const group = groups.get(candidate.orderId);
        group.lines.push(candidate);
        group.shirts += candidate.required;
        if (order.date && (!group.date || order.date < group.date)) group.date = order.date;
    }
    const dated = group => group.date ? 0 : 1;
    return [...groups.values()].sort((left, right) => dated(left) - dated(right)
        || String(left.date || '').localeCompare(String(right.date || ''))
        || left.customerName.localeCompare(right.customerName, 'en', { sensitivity: 'base' }) || left.orderId.localeCompare(right.orderId));
}

export const productionGroupMatches = (group, search) => {
    const query = search.trim().toLowerCase();
    return !query || `${group.customerName} ${group.orderId}`.toLowerCase().includes(query)
        || group.lines.some(line => line.designName.toLowerCase().includes(query));
};

// Customer label for an owner job card, from the job's source transaction.
export function productionCustomerOf(transactions) {
    const names = new Map(transactions.flatMap(transaction => {
        const [line] = getSaleItems(transaction);
        return line ? [[transaction.id, line.details.customerName]] : [];
    }));
    return job => names.get(job.sourceId) || '';
}

// Order date for an owner job card, from the job's source transaction.
export function productionOrderDateOf(transactions) {
    const dates = new Map(transactions.flatMap(transaction => transaction.type === 'sale' && transaction.date ? [[transaction.id, transaction.date]] : []));
    return job => dates.get(job.sourceId) || null;
}

// "Oct 5" this year, "Dec 28, 2025" for older orders, in Philippine time.
export function orderDateLabel(value, now = new Date()) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const year = part => new Intl.DateTimeFormat('en-PH', { year: 'numeric', timeZone: 'Asia/Manila' }).format(part);
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
        ...(year(date) !== year(now) ? { year: 'numeric' } : {}) });
}

// The Worker's per-request ceiling (worker/production-api.ts). Not a selection limit: the picker
// prepares the oldest MAX_BATCH_JOBS chosen lines per save and keeps the rest selected.
export const MAX_BATCH_JOBS = 100;

// Jobs whose printed shirts the owner can accept in one go: released, current (order line
// unchanged) jobs with shirts awaiting QA, in the list's first-in, first-out order.
export const acceptAllQueue = (jobs) => jobs.filter(job => job.awaitingQA > 0 && !job.sourceChanged && job.releasedAt
    && !['draft', 'completed', 'superseded'].includes(job.status));
// Exactly the counts the owner saw; the server refuses the whole save if any job changed since.
export const acceptAllPayload = (jobs) => jobs.map(job => ({ id: job.id, expectedVersion: job.version, accepted: job.awaitingQA }));

// Print staff see their jobs as packages, one per order (owner request 2026-10-27). packageKey is
// the server's opaque per-order key (staff never receive the order number); owner payloads fall
// back to orderId. Packages keep the queue's first-in, first-out order, and their totals count
// every job in the package, whatever the filter shows.
export const packageStatus = {
    ready_to_pack: 'Ready to pack', problem: 'Problem reported', awaiting_qa: 'Awaiting owner QA', to_print: 'To print'
};
export function printPackages(jobs) {
    const packages = new Map();
    for (const job of jobs) {
        const key = job.packageKey || job.orderId || job.id;
        if (!packages.has(key)) {
            packages.set(key, { key, customerName: '', bookingNumber: '', jobs: [], required: 0, toPrint: 0, awaitingQA: 0, accepted: 0 });
        }
        const entry = packages.get(key);
        entry.jobs.push(job);
        if (!entry.customerName && job.customerName) entry.customerName = job.customerName;
        if (!entry.bookingNumber && job.bookingNumber) entry.bookingNumber = job.bookingNumber;
        entry.required += Number(job.required) || 0;
        entry.toPrint += Number(job.remainingToPrint) || 0;
        entry.awaitingQA += Number(job.awaitingQA) || 0;
        entry.accepted += Number(job.accepted) || 0;
    }
    const names = new Map();
    for (const entry of packages.values()) {
        const name = entry.customerName.trim().toLowerCase();
        if (name) names.set(name, (names.get(name) || 0) + 1);
    }
    return [...packages.values()].map(entry => ({
        ...entry,
        // Two orders from the same name are two parcels; the queue says so instead of merging them.
        sharedName: (names.get(entry.customerName.trim().toLowerCase()) || 0) > 1,
        state: entry.jobs.every(job => job.status === 'completed') ? 'ready_to_pack'
            : entry.jobs.some(job => job.status === 'problem') ? 'problem'
                : entry.toPrint === 0 && entry.awaitingQA > 0 ? 'awaiting_qa' : 'to_print'
    }));
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
export function packageSummary(pkg) {
    if (pkg.state === 'ready_to_pack') return `${plural(pkg.required, 'shirt')} · all accepted`;
    return [plural(pkg.required, 'shirt'), pkg.toPrint && `${pkg.toPrint} to print`,
        pkg.awaitingQA && `${pkg.awaitingQA} awaiting QA`, pkg.accepted && `${pkg.accepted} accepted`].filter(Boolean).join(' · ');
}
export const packageItems = (pkg) => pkg.jobs.map(job => `${job.designName} · ${job.size} ×${job.required}`).join(', ');

const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const squeeze = value => value.replace(/[^a-z0-9]+/g, '');
// Every word typed must appear in the package label (customer name, LBC booking number) or the job
// (design, brand, color, size, job code). Spaces and dashes are optional, so "122480015678" finds
// booking number "1224 8001 5678", and accents are ignored, so "pena" finds "Peña".
export function printJobMatches(pkg, job, query) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = [pkg.customerName, pkg.bookingNumber, job.designName, job.brand, job.color, job.size, job.jobCode].map(fold).join(' ');
    const squeezed = squeeze(text);
    return words.every(word => text.includes(word) || (squeeze(word) !== '' && squeezed.includes(squeeze(word))));
}
// Packages with at least one job that passes the status filter and the search, with those jobs.
export function visiblePrintPackages(packages, filter, query) {
    const shows = job => filter === 'all' || (filter === 'completed' ? job.status === 'completed' : job.status !== 'completed');
    return packages.map(pkg => ({ ...pkg, visibleJobs: pkg.jobs.filter(job => shows(job) && printJobMatches(pkg, job, query)) }))
        .filter(pkg => pkg.visibleJobs.length > 0);
}
// The batch payload: server-verified source references and tokens only.
export const productionBatchLines = (candidates) => candidates.map(candidate => ({
    sourceId: candidate.sourceId, itemIndex: candidate.itemIndex, expectedSourceToken: candidate.sourceToken
}));

export const newProductionRequest = (body) => ({ ...body, requestId: crypto.randomUUID() });

// Wallet money arrives as integer centavos from the Worker; format without floating-point math.
export function walletPeso(centavos) {
    if (!Number.isSafeInteger(centavos)) return '₱—';
    const sign = centavos < 0 ? '−' : '';
    const absolute = Math.abs(centavos);
    const cents = absolute % 100;
    return `${sign}₱${Math.floor(absolute / 100).toLocaleString('en-PH')}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}
// Payout choices: every whole pay step up to the balance due, largest (the full balance) first.
export function payoutSteps(balanceCentavos, rateCentavos) {
    if (!Number.isSafeInteger(balanceCentavos) || !Number.isSafeInteger(rateCentavos) || rateCentavos <= 0) return [];
    const steps = [];
    for (let amount = Math.floor(balanceCentavos / rateCentavos) * rateCentavos; amount >= rateCentavos; amount -= rateCentavos) steps.push(amount);
    return steps;
}
export const productionError = (error) => error?.status === 409
    ? 'This job or shirt line changed. Latest data has been requested. Check the counts, then retry; your input is still here.'
    : error?.status === 403
        ? 'Your access or assignment changed. Reload the queue before continuing.'
        : error?.message || 'The save could not be confirmed. Retry this same action when you are online.';
