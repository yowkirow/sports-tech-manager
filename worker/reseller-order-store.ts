import type { Member } from './auth.ts';
import { HttpError } from './errors.ts';
import { isObject } from './http.ts';
import { canonical, decimal, detailsOrderId, timestamp } from './order-store.ts';
import { groupOrders } from '../src/lib/orderItems.js';
import { buildOrderChanges } from '../src/lib/orderEditingPure.js';
import { getCartUnitPrice } from '../src/lib/orderPricing.js';

type Data = Record<string, any>;
type Row = {
    id: string; type: string; category: string; amount: string; date: string;
    description: string | null; details: Data | null; order_id: string | null;
};
type Stored = Omit<Row, 'details'> & { details: string | null };
type Change = { id: string; expected: Omit<Row, 'id' | 'order_id'>; updates: Data };
type Input = { orderId: string; expectedVersion: number; requestId: string; changes: Change[]; requirePending: boolean };
// The business boundary supplies its existing catalog/POS validator. Its price
// policy is authoritative here too, without exporting or impersonating an owner.
type ValidatePrices = (db: D1Database, rows: Row[]) => Promise<number>;
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = ['address', 'city', 'province', 'barangay', 'region', 'contactNumber'];
const REPLAY = 'EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ?)';
const ACTIVE = `t.type = 'sale' AND coalesce(json_extract(t.details,'$.removedFromOrder'),0) NOT IN (1,'true')
    AND (t.order_id = ? OR coalesce(nullif(json_extract(t.details,'$.orderId'),''),t.id) = ?)`;
const PENDING = `coalesce(json_extract(t.details,'$.fulfillmentStatus'),
    CASE WHEN coalesce(json_extract(t.details,'$.status'),'paid') = 'paid' THEN 'pending'
        ELSE json_extract(t.details,'$.status') END) = 'pending'
    AND coalesce(json_extract(t.details,'$.paymentStatus'),
        CASE WHEN coalesce(json_extract(t.details,'$.status'),'paid') = 'paid' THEN 'paid' ELSE 'unpaid' END) = 'unpaid'`;

function invalid(message: string): never { throw new HttpError(400, 'validation_error', message); }
function forbidden(): never { throw new HttpError(403, 'forbidden', 'Only active resellers may edit their own unpaid pending orders.'); }
function fields(value: unknown, required: string[], optional: string[] = []): Data {
    if (!isObject(value) || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
        invalid('The order contains missing or unsupported fields.');
    }
    return value;
}
function text(value: unknown, label: string, max = 256, empty = false): string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(`Invalid ${label}.`);
    return value;
}
function bounded(value: unknown, limit = 2_000_000): string {
    const result = canonical(value);
    if (encoder.encode(result).byteLength > limit) throw new HttpError(413, 'payload_too_large', 'This order is too large.');
    return result;
}
function clean(value: unknown): Data { return JSON.parse(JSON.stringify(value)); }

function normalize(input: unknown, member: Member): Input {
    if (member.role !== 'reseller') forbidden();
    const body = fields(input, ['orderId', 'expectedVersion', 'requestId', 'changes'], ['requirePending']);
    const orderId = detailsOrderId({ orderId: body.orderId }, '');
    const requestId = text(body.requestId, 'request ID');
    if (requestId.trim() !== requestId || /[\u0000-\u001f\u007f]/.test(requestId)) invalid('Invalid request ID.');
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || body.expectedVersion >= Number.MAX_SAFE_INTEGER) {
        invalid('Expected version must be a nonnegative safe integer.');
    }
    if (body.requirePending !== undefined && typeof body.requirePending !== 'boolean') invalid('requirePending must be boolean.');
    if (!Array.isArray(body.changes) || !body.changes.length) invalid('Order cannot be empty.');
    const ids = new Set<string>();
    const changes = body.changes.map((value: unknown): Change => {
        const change = fields(value, ['id', 'expected', 'updates']);
        if (typeof change.id !== 'string' || !UUID.test(change.id)) invalid('Source transaction IDs must be UUIDs.');
        const id = change.id.toLowerCase();
        if (ids.has(id)) invalid('Duplicate source transaction IDs.');
        ids.add(id);
        const expected = fields(change.expected, ['type', 'category', 'amount', 'date', 'description', 'details']);
        const updates = fields(change.updates, ['amount', 'details'], ['category', 'date', 'description']);
        if (!isObject(expected.details) || !isObject(updates.details)) invalid('Order details must be objects.');
        if (expected.details.createdBy !== member.email) forbidden();
        if (expected.type !== 'sale' || detailsOrderId(expected.details, id) !== orderId
            || detailsOrderId(updates.details, id) !== orderId) invalid('Order identity cannot change.');
        const before = {
            type: 'sale', category: text(expected.category, 'category', 128),
            amount: decimal(expected.amount, true), date: timestamp(expected.date),
            description: expected.description === null ? null : text(expected.description, 'description', 4096, true),
            details: expected.details
        };
        const after = {
            ...updates, amount: decimal(updates.amount, true),
            date: updates.date === undefined ? before.date : timestamp(updates.date),
            description: updates.description === undefined ? before.description : updates.description
        };
        if (after.date !== before.date || after.description !== before.description) {
            invalid('Only the owner may change order dates or descriptions.');
        }
        return { id, expected: before, updates: after };
    });
    // Even a false/missing flag cannot relax the reseller pending-only policy.
    return { orderId, requestId, expectedVersion: body.expectedVersion, requirePending: true, changes };
}

function matches(row: Stored, change: Change, key: string): boolean {
    const details = JSON.parse(row.details!);
    return row.type === change.expected.type && row.category === change.expected.category
        && decimal(row.amount) === change.expected.amount && timestamp(row.date) === change.expected.date
        && row.description === change.expected.description && canonical(details) === canonical(change.expected.details)
        && detailsOrderId(details, row.id) === key && (row.order_id === null || row.order_id === key);
}

function draftsFor(order: Data, changes: Change[]): Data[] {
    const drafts: Data[] = [];
    const bySource = new Map<string, Data[]>();
    for (const item of order.items) {
        const items = bySource.get(item.transactionId) || [];
        items.push(item);
        bySource.set(item.transactionId, items);
    }
    for (const change of changes) {
        const originals = bySource.get(change.id) || [];
        const next = change.updates.details;
        if (next.removedFromOrder === true) continue;
        const nested = Array.isArray(change.expected.details?.items);
        const items: Data[] = nested ? next.items : [next];
        if (!Array.isArray(items) || !items.length || items.length > originals.length) invalid('Only existing order items may be edited.');
        const used = new Set<string>();
        items.forEach((item, index) => {
            if (!isObject(item)) invalid('Invalid order item.');
            const identity = (original: Data) => (item.itemName ?? item.name) === original.details.itemName
                && (item.productId === undefined || item.productId === original.details.productId);
            const candidates = originals.filter(original => !used.has(original.id) && identity(original));
            const original = items.length === originals.length && identity(originals[index]!)
                ? originals[index] : candidates.length === 1 ? candidates[0] : undefined;
            if (!original || used.has(original.id)) invalid('Product changes or ambiguous legacy item removals require the owner.');
            used.add(original.id);
            const quantity = item.quantity;
            if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
                invalid('Quantity must be an integer between 1 and 100000.');
            }
            const size = text(item.size ?? original.details.size, 'size', 64, true);
            const color = text(item.color ?? original.details.color, 'color', 256, true);
            if (size !== original.details.size && (!['shirts', 'blanks'].includes(original.details.category)
                || !['XS', 'S', 'M', 'L', 'XL', '2XL'].includes(size))) invalid('Choose a supported size for this product.');
            if (color !== original.details.color) invalid('This product is not available in that color.');
            drafts.push({ id: original.id, quantity, size, color });
        });
    }
    if (!drafts.length) invalid('Order must retain at least one item.');
    return drafts;
}

function commonDetails(order: Data, changes: Change[]): Data {
    const active = changes.filter(change => change.updates.details.removedFromOrder !== true);
    const next = active[0]!.updates.details;
    const common: Data = {};
    for (const key of ['customerName', 'contactNumber']) {
        if (Object.hasOwn(next, key)) common[key] = text(next[key], key, 256, key !== 'customerName');
    }
    if (Object.hasOwn(next, 'shippingDetails')) {
        if (!isObject(next.shippingDetails)) invalid('Shipping details must be an object.');
        common.shippingDetails = {};
        for (const key of ADDRESS) {
            if (Object.hasOwn(next.shippingDetails, key)) common.shippingDetails[key] = text(next.shippingDetails[key], key, 1024, true);
        }
    }
    const defaults: Data = { fulfillmentStatus: 'pending', status: 'pending', paymentStatus: 'unpaid', paymentMode: 'Cash', trackingNumber: '' };
    for (const change of active) {
        for (const key of Object.keys(defaults)) {
            if (Object.hasOwn(change.updates.details, key)
                && change.updates.details[key] !== (change.expected.details![key] ?? defaults[key])) {
                invalid('Payment, fulfillment and tracking changes are owner-only.');
            }
        }
    }
    for (const key of Object.keys(defaults)) {
        if (Object.hasOwn(next, key)) common[key] = order.transactions[0].details[key] ?? defaults[key];
    }
    return common;
}

function sourceOnly(order: Data, drafts: Data[], common: Data): Data[] {
    const draftById = new Map<string, Data>(drafts.map(item => [item.id, item]));
    const itemById = new Map<string, Data>(order.items.map((item: Data) => [item.id, item]));
    return order.transactions.map((source: Data) => {
        const variant = (item: Data, id: string) => {
            const draft = draftById.get(id)!;
            const original = itemById.get(id)!;
            return { ...item, ...(draft.size === original.details.size ? {} : { size: draft.size }) };
        };
        const details = {
            ...source.details, ...common,
            ...(common.shippingDetails ? { shippingDetails: { ...source.details.shippingDetails, ...common.shippingDetails } } : {})
        };
        if (Array.isArray(source.details.items)) {
            details.items = source.details.items.map((item: Data, index: number) => item.details
                ? { ...item, details: variant(item.details, `${source.id}:${index}`) }
                : variant(item, `${source.id}:${index}`));
        } else Object.assign(details, variant(details, source.id));
        return { id: source.id, updates: { amount: source.amountExact, details } };
    });
}

function sourceItem(sources: Map<string, Data>, item: Data): Data {
    const source = sources.get(item.transactionId)!.details;
    return item.itemIndex === null ? source : source.items[item.itemIndex];
}

function retainIdentity(order: Data, drafts: Data[], changes: Data[]): Data[] {
    const sources = new Map<string, Data>(order.transactions.map((row: Data) => [row.id, row]));
    const itemsById = new Map<string, Data>(order.items.map((item: Data) => [item.id, item]));
    const itemsBySource = new Map<string, Data[]>();
    for (const draft of drafts) {
        const item = itemsById.get(draft.id)!;
        const items = itemsBySource.get(item.transactionId) || [];
        items.push(item);
        itemsBySource.set(item.transactionId, items);
    }
    const identity = (next: Data, source: Data) => {
        for (const key of ['name', 'itemName', 'productId', 'brand', 'category', 'imageUrl', 'color', 'linkedColor']) {
            if (Object.hasOwn(source, key)) next[key] = source[key];
            else delete next[key];
        }
    };
    return changes.map(change => {
        const source = sources.get(change.id)!;
        if (change.updates.details.removedFromOrder === true) return change;
        if (!Array.isArray(source.details.items)) identity(change.updates.details, source.details);
        else {
            const items = itemsBySource.get(source.id)!;
            change.updates.details.items.forEach((item: Data, index: number) => identity(item, sourceItem(sources, items[index]!)));
        }
        return change;
    });
}

async function rebuild(db: D1Database, input: Input, stored: Stored[], validatePrices: ValidatePrices) {
    const transactions = stored.map(row => ({
        ...row, amountExact: row.amount, amount: Number(row.amount), details: JSON.parse(row.details!)
    }));
    const order = groupOrders(transactions)[0] as Data | undefined;
    if (!order || order.transactions.length !== stored.length) invalid('This historical order requires an owner edit.');
    const drafts = draftsFor(order, input.changes);
    const common = commonDetails(order, input.changes);
    const itemsById = new Map<string, Data>(order.items.map((item: Data) => [item.id, item]));
    const sources = new Map<string, Data>(order.transactions.map((row: Data) => [row.id, row]));
    const unchanged = drafts.length === order.items.length
        && drafts.every(draft => draft.quantity === itemsById.get(draft.id)!.details.quantity);
    if (!unchanged && order.items.some((item: Data) => isObject(sourceItem(sources, item).details))) {
        invalid('Quantity or removal edits of wrapped legacy items require the owner.');
    }
    let browser: Data[];
    try { browser = clean(buildOrderChanges(order, drafts, common).changes) as Data[]; }
    catch { invalid('The saved pricing cannot safely be reconstructed. Contact the owner.'); }
    let revision: number | null = null;
    const repriced = order.items.map((item: Data) => ({ ...item, details: { ...item.details } }));
    const repricedById = new Map<string, Data>(repriced.map((item: Data) => [item.id, item]));
    const changed = drafts.filter(draft => draft.quantity !== itemsById.get(draft.id)!.details.quantity);
    let pricingChanged = false;
    if (changed.length) {
        const prices: Row[] = changed.map(draft => {
            const item = repricedById.get(draft.id)!;
            const original = sourceItem(sources, item);
            const category = original.category ?? item.details.category;
            const price = getCartUnitPrice({ ...item.details, category, unitPrice: 400 }, draft.quantity);
            return {
                id: item.id, type: 'sale', category, amount: decimal(price * draft.quantity),
                date: item.date, description: null, order_id: input.orderId,
                details: {
                    orderId: input.orderId, itemName: item.details.itemName, quantity: draft.quantity, source: 'pos',
                    customerName: common.customerName ?? item.details.customerName, category,
                    brand: item.details.brand, color: item.details.color, unitPrice: price, originalAmount: price * draft.quantity
                }
            };
        });
        revision = await validatePrices(db, prices);
        prices.forEach(row => {
            const item = repricedById.get(row.id)!;
            pricingChanged ||= item.details.unitPrice !== row.details!.unitPrice;
            item.details.unitPrice = row.details!.unitPrice;
        });
    }
    let rebuilt: Data[];
    try { rebuilt = pricingChanged ? clean(buildOrderChanges({ ...order, items: repriced }, drafts, common).changes) as Data[] : browser; }
    catch { invalid('The updated pricing cannot safely be reconstructed. Contact the owner.'); }
    // No quantity/removal changes: keep exact historical money and allocations,
    // including sub-cent values and private metadata, rather than normalizing them.
    const preserved = unchanged ? sourceOnly(order, drafts, common) : null;
    const equivalent = (change: Change, candidate: Data, details: string) => decimal(candidate.updates.amount, true) === change.updates.amount
        && (change.updates.category ?? change.expected.category) === (candidate.updates.category ?? change.expected.category)
        && canonical(candidate.updates.details) === details;
    const candidates = [...new Set([browser, rebuilt, ...(preserved ? [preserved] : [])])]
        .map(list => new Map<string, Data>(list.map(item => [item.id, item])));
    for (const change of input.changes) {
        const details = canonical(change.updates.details);
        if (!candidates.some(list => equivalent(change, list.get(change.id)!, details))) {
            invalid('Unsupported order changes. Product identity, prices, discounts, fees and private details are server-controlled.');
        }
    }
    const updates = (preserved ?? retainIdentity(order, drafts, rebuilt)).map(change => ({
        id: change.id, amount: decimal(change.updates.amount, true), details: canonical(change.updates.details)
    }));
    return { updates, revision };
}

function databaseError(error: unknown): never {
    let current = error;
    const seen = new Set<unknown>();
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        if (/CHECK constraint failed: business_forbidden\b/.test(current.message)) forbidden();
        if (/CHECK constraint failed: business_receipt_conflict\b/.test(current.message)) {
            throw new HttpError(409, 'idempotency_conflict', 'This request ID was already used for a different change.');
        }
        if (/CHECK constraint failed: business_(conflict|written)\b/.test(current.message)) {
            throw new HttpError(409, 'order_conflict', 'The complete unpaid pending order changed. Reload before retrying.');
        }
        current = current.cause;
    }
    throw error;
}

/** Fixed-size D1 batch; no source rows, private financial data or fallback writes
 * cross the response boundary. All authorization is repeated on receipt replay. */
export async function saveResellerOrderChanges(db: D1Database, member: Member, value: unknown, validatePrices: ValidatePrices) {
    const input = normalize(value, member);
    const { orderId, requestId, expectedVersion, changes } = input;
    const payload = bounded({ action: 'reseller.order.updated', ...input }, 1024 * 1024);
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const bind = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
    const rows = await bind(`SELECT t.id,t.type,t.category,t.amount,t.date,t.description,t.details,t.order_id
        FROM transactions t WHERE ${ACTIVE} AND json_extract(t.details,'$.createdBy') = ?
        AND t.id IN (SELECT value FROM json_each(?)) AND NOT ${REPLAY}`,
    orderId, orderId, member.email, bounded(changes.map(change => change.id)), member.id, requestId).all<Stored>();
    const byId = new Map(rows.results.map(row => [row.id, row]));
    const snapshots = changes.map(change => {
        const row = byId.get(change.id);
        return { ...row, id: change.id, matches: row && matches(row, change, orderId) ? 1 : 0 };
    });
    const rebuilt = snapshots.every(row => row.matches)
        ? await rebuild(db, input, changes.map(change => byId.get(change.id)!), validatePrices)
        : { updates: [], revision: null };
    const replay = [member.id, requestId];
    const guard = (kind: string, condition: string, ...values: (string | number | null)[]) =>
        bind(`INSERT INTO _business_guards(kind,ok) VALUES ('${kind}',CASE WHEN ${condition} THEN 1 ELSE 0 END)`, ...values);
    const written = (count: number) => guard('written', `changes() = ? OR ${REPLAY}`, count, ...replay);
    const response = { orderId, version: expectedVersion + 1, ids: changes.map(change => change.id) };
    const statements = [
        guard('forbidden', `EXISTS (SELECT 1 FROM members WHERE id = ? AND email = ? AND role = 'reseller' AND active = 1)
            AND NOT EXISTS (SELECT 1 FROM transactions t WHERE ${ACTIVE} AND json_extract(t.details,'$.createdBy') IS NOT ?)`,
        member.id, member.email, orderId, orderId, member.email),
        guard('receipt_conflict', 'NOT EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash <> ?)',
            ...replay, hash),
        guard('conflict', `EXISTS (SELECT 1 FROM transactions t WHERE ${ACTIVE})
            AND NOT EXISTS (SELECT 1 FROM transactions t WHERE ${ACTIVE} AND NOT (${PENDING}))`,
        orderId, orderId, orderId, orderId),
        guard('conflict', `${REPLAY} OR (
            coalesce((SELECT version FROM orders WHERE id = ?),0) = ?
            AND (? IS NULL OR (SELECT revision FROM system_state WHERE singleton = 1) = ?)
            AND (SELECT count(*) FROM transactions t WHERE ${ACTIVE}) = ?
            AND NOT EXISTS (SELECT 1 FROM json_each(?) s LEFT JOIN transactions t ON t.id = json_extract(s.value,'$.id')
                WHERE json_extract(s.value,'$.matches') <> 1 OR t.id IS NULL
                OR t.type IS NOT json_extract(s.value,'$.type') OR t.category IS NOT json_extract(s.value,'$.category')
                OR t.amount IS NOT json_extract(s.value,'$.amount') OR t.date IS NOT json_extract(s.value,'$.date')
                OR t.description IS NOT json_extract(s.value,'$.description') OR t.details IS NOT json_extract(s.value,'$.details')
                OR t.order_id IS NOT json_extract(s.value,'$.order_id')))`,
        ...replay, orderId, expectedVersion, rebuilt.revision, rebuilt.revision, orderId, orderId, changes.length, bounded(snapshots)),
        bind(`INSERT INTO orders(id) SELECT ? WHERE NOT ${REPLAY} ON CONFLICT(id) DO NOTHING`, orderId, ...replay),
        bind(`UPDATE transactions AS t SET amount = json_extract(p.value,'$.amount'),
            details = json_extract(p.value,'$.details'), order_id = ?
            FROM json_each(?) p WHERE t.id = json_extract(p.value,'$.id') AND NOT ${REPLAY}`,
        orderId, bounded(rebuilt.updates), ...replay),
        written(changes.length),
        bind(`UPDATE orders SET version = version + 1 WHERE id = ? AND version = ? AND NOT ${REPLAY}`, orderId, expectedVersion, ...replay),
        written(1),
        bind(`INSERT INTO business_events(actor_id,request_id,action,details)
            SELECT ?,?,'reseller.order.updated',? WHERE NOT ${REPLAY}`, ...replay, bounded({ previousVersion: expectedVersion, ...response }), ...replay),
        written(1),
        bind(`INSERT INTO mutation_receipts(actor_id,request_id,payload_hash,response)
            SELECT ?,?,?,? WHERE NOT ${REPLAY}`, ...replay, hash, bounded(response), ...replay),
        guard('written', 'EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash = ?)', ...replay, hash),
        bind('DELETE FROM _business_guards'),
        bind('SELECT response FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash = ?', ...replay, hash)
    ];
    let results: D1Result[];
    try { results = await db.batch(statements); }
    catch (error) { databaseError(error); }
    const saved = results.at(-1)?.results as { response?: unknown }[] | undefined;
    if (saved?.length !== 1 || typeof saved[0]?.response !== 'string' || canonical(JSON.parse(saved[0].response)) !== canonical(response)) {
        throw new Error('The order save could not be confirmed. Reload or retry with the same request ID.');
    }
    return response;
}
