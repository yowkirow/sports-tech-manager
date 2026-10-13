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
// ordered, A–Z by name, then oldest order first. Customer names never enter a payload.
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
    return [...groups.values()].sort((left, right) =>
        left.customerName.localeCompare(right.customerName, 'en', { sensitivity: 'base' })
        || String(left.date || '').localeCompare(String(right.date || '')) || left.orderId.localeCompare(right.orderId));
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

export const MAX_BATCH_JOBS = 30;
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
