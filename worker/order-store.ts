export type JSONValue = null | boolean | number | string | JSONValue[] | JSONObject;
export type JSONObject = { [key: string]: JSONValue };

export interface OrderSnapshot {
    type: string;
    category: string;
    amount: string | number;
    date: string;
    description: string | null;
    details: JSONValue;
}

export interface OrderUpdates {
    amount: string | number;
    details: JSONObject;
    category?: string;
    date?: string;
    description?: string | null;
}

export interface SaveOrderInput {
    orderId: string;
    expectedVersion: number;
    requestId: string;
    changes: { id: string; expected: OrderSnapshot; updates: OrderUpdates }[];
    requirePending?: boolean;
}

export interface SaveOrderResult {
    orderId: string;
    version: number;
    ids: string[];
}

export interface SaveOrderOptions {
    // Internal deployment flag, not part of caller-controlled SaveOrderInput.
    requireProductionReady?: boolean;
    packingConfirmed?: boolean;
}

export class OrderStoreError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = 'OrderStoreError';
        this.code = code;
        this.status = status;
    }
}

// The future HTTP boundary must also cap the raw request at 1 MiB. There is no
// item-count limit. Each json_each binding additionally stays below D1's 2 MB limit.
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_BINDING_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function invalid(message: string): never {
    throw new OrderStoreError('VALIDATION_ERROR', message, 400);
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
    if (required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
        invalid('Invalid order change fields.');
    }
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string') invalid(`${label} must be text.`);
    return value;
}

function identifier(value: unknown, label: string): string {
    const result = text(value, label);
    if (!result.length || result.length > 256 || result.trim() !== result || /[\u0000-\u001f\u007f]/.test(result)) {
        invalid(`Invalid ${label}.`);
    }
    return result;
}

function sourceId(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) invalid('Source transaction IDs must be UUIDs, not item IDs.');
    return value.toLowerCase();
}

function orderId(value: unknown): string {
    const result = identifier(value, 'order ID');
    if (UUID.test(result)) return result.toLowerCase();
    if (!/^ST-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(result)) invalid('Order ID must be an ST code or a legacy UUID.');
    return result;
}

function decimal(value: unknown, nonnegative = false): string {
    // Never round/multiply money. Numbers use only the precision already supplied by
    // the caller; exponent-form and unsafe magnitudes must instead be decimal text.
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) invalid('Amount must be a safe finite decimal.');
        value = String(value);
    }
    if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) invalid('Amount must be decimal text without an exponent.');
    const negative = value.startsWith('-');
    const [whole = '', fraction = ''] = value.replace(/^[+-]/, '').split('.');
    const integer = whole.replace(/^0+(?=\d)/, '');
    const tail = fraction.replace(/0+$/, '');
    const magnitude = integer + (tail ? `.${tail}` : '');
    if (nonnegative && negative && magnitude !== '0') invalid('Sale amounts cannot be negative.');
    return (negative && magnitude !== '0' ? '-' : '') + magnitude;
}

function timestamp(value: unknown): string {
    const input = text(value, 'Date');
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2}))?$/.exec(input);
    if (!match) invalid('Date must be a valid ISO date or timestamp with a timezone.');
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone = 'Z'] = match;
    const base = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    const time = Date.parse(base);
    if (Number(year) === 0 || !Number.isFinite(time) || new Date(time).toISOString() !== base) invalid('Date is not valid.');
    let offset = 0;
    if (zone.toUpperCase() !== 'Z') {
        const hours = Number(zone.slice(1, 3));
        const minutes = Number(zone.slice(4, 6));
        if (hours > 23 || minutes > 59) invalid('Date timezone is not valid.');
        offset = (hours * 60 + minutes) * 60_000 * (zone[0] === '+' ? 1 : -1);
    }
    const utc = new Date(time - offset).toISOString();
    if (utc.length !== 24 || utc.startsWith('0000')) invalid('Date is outside the supported calendar.');
    // Date supplies only whole seconds; preserve historical sub-millisecond digits.
    const tail = fraction.replace(/0+$/, '');
    return `${utc.slice(0, 19)}${tail ? `.${tail}` : ''}Z`;
}

function canonical(value: unknown, seen = new Set<object>(), depth = 0): string {
    if (depth > 64) invalid('JSON nesting exceeds 64 levels.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) invalid('JSON numbers must be safe and finite.');
        return JSON.stringify(value);
    }
    if (!Array.isArray(value) && !object(value)) invalid('Details must contain only JSON values.');
    if (seen.has(value)) invalid('JSON cannot contain cycles.');
    if (Object.getOwnPropertySymbols(value).length) invalid('JSON cannot contain symbol keys.');
    seen.add(value);
    let result: string;
    if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) invalid('JSON arrays cannot contain holes or extra properties.');
        result = `[${Array.from(value, item => canonical(item, seen, depth + 1)).join(',')}]`;
    } else {
        result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], seen, depth + 1)}`).join(',')}}`;
    }
    seen.delete(value);
    return result;
}

function boundedJSON(value: unknown, limit = MAX_BINDING_BYTES): string {
    const result = JSON.stringify(value);
    if (encoder.encode(result).byteLength > limit) {
        throw new OrderStoreError('PAYLOAD_TOO_LARGE', 'Order data exceeds the supported byte size.', 413);
    }
    return result;
}

function detailsOrderId(details: unknown, id: string): string {
    const explicit = object(details) ? details.orderId : undefined;
    if (explicit === undefined || explicit === null || explicit === '') return id;
    return orderId(explicit);
}

// Shared HTTP writes use the same exact decimal, UTC and JSON snapshot rules.
export {
    decimal, decimal as normalizeDecimal,
    timestamp, timestamp as normalizeTimestamp,
    canonical, detailsOrderId
};

function removed(details: unknown): boolean {
    return object(details) && (details.removedFromOrder === true || details.removedFromOrder === 'true');
}

function pending(expected: JSONValue, updates: JSONObject): void {
    const original = object(expected) ? expected : {};
    const status = original.fulfillmentStatus
        ?? ((original.status ?? 'paid') === 'paid' ? 'pending' : original.status);
    if (status !== 'pending' || (updates.fulfillmentStatus ?? status) !== 'pending'
        || !['pending', 'paid'].includes(String(updates.status ?? 'pending'))) {
        throw new OrderStoreError('ORDER_NOT_PENDING', 'Only pending orders can be edited.', 400);
    }
}

type NormalSnapshot = Omit<OrderSnapshot, 'amount'> & { amount: string };
type NormalUpdates = Required<Omit<OrderUpdates, 'amount'>> & { amount: string };
type NormalChange = { id: string; expected: NormalSnapshot; updates: NormalUpdates };
type NormalInput = Omit<SaveOrderInput, 'changes' | 'requirePending'> & {
    changes: NormalChange[];
    requirePending: boolean;
};

function normalize(input: unknown): NormalInput {
    if (!object(input)) invalid('Order input must be an object.');
    keys(input, ['orderId', 'expectedVersion', 'requestId', 'changes'], ['requirePending']);
    const key = orderId(input.orderId);
    const requestId = identifier(input.requestId, 'request ID');
    if (typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER) {
        invalid('Expected version must be a nonnegative safe integer.');
    }
    if (input.requirePending !== undefined && typeof input.requirePending !== 'boolean') invalid('requirePending must be boolean.');
    if (!Array.isArray(input.changes) || !input.changes.length) invalid('Order cannot be empty.');
    const ids = new Set<string>();
    const changes = input.changes.map(change => {
        if (!object(change)) invalid('Invalid order change.');
        keys(change, ['id', 'expected', 'updates']);
        const id = sourceId(change.id);
        if (ids.has(id)) invalid('Order contains duplicate source transaction IDs.');
        ids.add(id);
        if (!object(change.expected) || !object(change.updates)) invalid('Expected and updates must be objects.');
        keys(change.expected, ['type', 'category', 'amount', 'date', 'description', 'details']);
        keys(change.updates, ['amount', 'details'], ['category', 'date', 'description']);
        const before = change.expected;
        const patch = change.updates;
        if (!object(patch.details)) invalid('Updated details must be a JSON object.');
        const expected: NormalSnapshot = {
            type: text(before.type, 'Type'),
            category: text(before.category, 'Category'),
            amount: decimal(before.amount),
            date: timestamp(before.date),
            description: before.description === null ? null : text(before.description, 'Description'),
            details: JSON.parse(canonical(before.details)) as JSONValue
        };
        const updates: NormalUpdates = {
            amount: decimal(patch.amount, true),
            details: JSON.parse(canonical(patch.details)) as JSONObject,
            category: Object.hasOwn(patch, 'category') ? text(patch.category, 'Category') : expected.category,
            date: Object.hasOwn(patch, 'date') ? timestamp(patch.date) : expected.date,
            description: Object.hasOwn(patch, 'description')
                ? patch.description === null ? null : text(patch.description, 'Description')
                : expected.description
        };
        if (detailsOrderId(expected.details, id) !== key || detailsOrderId(updates.details, id) !== key) {
            invalid('Order identity cannot change.');
        }
        if (removed(updates.details) && updates.amount !== '0') invalid('Removed items must have a zero amount.');
        if (input.requirePending) pending(expected.details, updates.details);
        return { id, expected, updates };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (changes.every(change => removed(change.updates.details))) invalid('Order cannot be empty.');
    const normalized = { orderId: key, requestId, expectedVersion: input.expectedVersion, requirePending: input.requirePending ?? false, changes };
    boundedJSON(normalized, MAX_REQUEST_BYTES);
    return normalized;
}

interface StoredRow {
    id: string;
    type: string;
    category: string;
    amount: string;
    date: string;
    description: string | null;
    details: string | null;
    order_id: string | null;
}

function matches(row: StoredRow, change: NormalChange, key: string): boolean {
    try {
        const details: unknown = row.details === null ? null : JSON.parse(row.details);
        const expected = change.expected;
        return row.type === expected.type && row.category === expected.category
            && decimal(row.amount) === expected.amount && timestamp(row.date) === expected.date
            && row.description === expected.description && canonical(details) === canonical(expected.details)
            && detailsOrderId(details, row.id) === key && (row.order_id === null || row.order_id === key);
    } catch (error) {
        // Corrupt/non-JSON historical snapshots cannot authorize a write. Receipt
        // replays can still succeed without interpreting the current order state.
        if (error instanceof OrderStoreError || error instanceof SyntaxError) return false;
        throw error;
    }
}

const membership = `type = 'sale'
    AND coalesce(json_type(details, '$.removedFromOrder'), '') <> 'true'
    AND json_extract(details, '$.removedFromOrder') IS NOT 'true'
    AND (order_id = ? OR coalesce(nullif(json_extract(details, '$.orderId'), ''), id) = ?)`;
const receipt = 'EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ?)';

// One JSON-array binding scopes this post-write check to the affected orders.
// The production views include flat and legacy nested shirt variants; absence of
// a job cannot be mistaken for completed QA. Only used after migration 0005.
export const PRODUCTION_READY_CONDITION = `NOT EXISTS (
    SELECT 1 FROM transactions AS ready
    WHERE ready.type = 'sale'
        AND coalesce(json_extract(ready.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
        AND coalesce(json_extract(ready.details, '$.fulfillmentStatus'), json_extract(ready.details, '$.status'), 'pending') IN ('ready','shipped')
        AND coalesce(ready.order_id, nullif(json_extract(ready.details, '$.orderId'), ''), ready.id)
            IN (SELECT value FROM json_each(?))
        AND (
            EXISTS (SELECT 1 FROM production_jobs AS job
                WHERE job.order_id = coalesce(ready.order_id, nullif(json_extract(ready.details, '$.orderId'), ''), ready.id)
                    AND job.status <> 'superseded'
                    AND (job.accepted <> job.required OR job.status <> 'completed' OR job.source_changed <> 0))
            OR EXISTS (SELECT 1 FROM production_order_shirt_lines AS line
                WHERE line.order_id = coalesce(ready.order_id, nullif(json_extract(ready.details, '$.orderId'), ''), ready.id)
                    AND NOT EXISTS (SELECT 1 FROM production_jobs AS job
                        WHERE job.source_id = line.source_id AND job.item_index = line.item_index
                            AND job.order_id = line.order_id AND job.required = line.required
                            AND job.accepted = job.required AND job.status = 'completed'
                            AND job.source_changed = 0 AND job.source_fingerprint = line.fingerprint))
        )
)`;

function mapGuard(error: unknown, readyTransition = false): never {
    let current = error;
    const seen = new Set<unknown>();
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        const match = /^(?:D1_ERROR: )?CHECK constraint failed: (order_save_[a-z_]+)(?:: SQLITE_CONSTRAINT(?:_CHECK)?(?: \(extended: SQLITE_CONSTRAINT_CHECK\))?)?$/.exec(current.message);
        const name = match?.[1];
        if (name) {
            if (name === 'order_save_forbidden') {
                throw new OrderStoreError('FORBIDDEN', 'An active owner membership is required.', 403);
            }
            if (name === 'order_save_receipt_conflict') {
                throw new OrderStoreError('IDEMPOTENCY_CONFLICT', 'Request ID was already used for a different order change.', 409);
            }
            if (['order_save_conflict', 'order_save_updated', 'order_save_version_updated',
                'order_save_audit_written', 'order_save_receipt_written'].includes(name)) {
                if (name === 'order_save_updated' && readyTransition) {
                    throw new OrderStoreError('ORDER_CONFLICT',
                        'The order changed or print QA is incomplete. Refresh and complete every required print job before Ready.', 409);
                }
                throw new OrderStoreError('ORDER_CONFLICT', 'The complete order could not be saved. Reload before retrying.', 409);
            }
        }
        current = current.cause;
    }
    throw error;
}

/**
 * One snapshot SELECT plus a fixed 13-statement atomic batch (14 D1 statements,
 * at most 8 bindings per statement), independent of the source-row count.
 *
 * JS compares normalized decimal/date/JSON snapshots. The batch then locks that
 * decision to every exact raw column read, and rechecks complete membership and
 * version. No write can use a stale preflight decision. Owner authorization is
 * always in the batch, including receipt replay; callers supply verified actor IDs.
 */
export async function saveOrderChanges(
    db: D1Database, actorId: string, input: unknown, options: SaveOrderOptions = {}
): Promise<SaveOrderResult> {
    identifier(actorId, 'actor ID');
    const normalized = normalize(input);
    const { orderId: key, requestId, expectedVersion, changes } = normalized;
    const ready = (details: unknown) => object(details) && ['ready', 'shipped'].includes(String(details.fulfillmentStatus ?? details.status));
    // Historical Ready orders remain editable without inventing retrospective
    // jobs. Physical-change holds remain enforced by production SQL triggers.
    const readyTransition = options.requireProductionReady
        && changes.some(change => !ready(change.expected.details) && ready(change.updates.details));
    if (readyTransition && options.packingConfirmed !== true) {
        throw new OrderStoreError('PACKING_CONFIRMATION_REQUIRED', 'Confirm that packing and any accessories are complete before marking Ready or Shipped.', 400);
    }
    const payload = canonical({
        orderId: key, expectedVersion, requirePending: normalized.requirePending, changes
    });
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    // Raw strings are retained, rather than SQL json() comparison (which does not
    // normalize key order) or a normalized column that imports could forget to set.
    // Read only requested rows, and none on replay. Complete membership is checked
    // in the batch, so a stale small request cannot load an arbitrarily large order.
    const rows = await db.prepare(`SELECT id, type, category, amount, date, description, details, order_id
        FROM transactions WHERE ${membership}
        AND id IN (SELECT value FROM json_each(?)) AND NOT ${receipt}`)
        .bind(key, key, boundedJSON(changes.map(change => change.id)), actorId, requestId).all<StoredRow>();
    const byId = new Map(rows.results.map(row => [row.id, row]));
    const snapshots = boundedJSON(changes.map(change => {
        const row = byId.get(change.id);
        return { ...row, id: change.id, matches: row && matches(row, change, key) ? 1 : 0 };
    }));
    const updates = boundedJSON(changes.map(change => ({
        id: change.id, ...change.updates, details: canonical(change.updates.details)
    })));
    const response: SaveOrderResult = { orderId: key, version: expectedVersion + 1, ids: changes.map(change => change.id) };
    const responseJSON = JSON.stringify(response);
    const bind = (sql: string, ...values: (string | number)[]) => db.prepare(sql).bind(...values);
    const guard = (kind: string, condition: string, ...values: (string | number)[]) =>
        bind(`INSERT INTO _order_save_guards(kind, ok) VALUES ('${kind}', CASE WHEN ${condition} THEN 1 ELSE 0 END)`, ...values);
    const countGuard = (kind: string, count: number) =>
        readyTransition && kind === 'updated'
            ? guard(kind, `${receipt} OR (changes() = ? AND ${PRODUCTION_READY_CONDITION})`,
                actorId, requestId, count, JSON.stringify([key]))
            : guard(kind, `changes() = ? OR ${receipt}`, count, actorId, requestId);

    const statements = [
        guard('forbidden', "EXISTS (SELECT 1 FROM members WHERE id = ? AND role = 'owner' AND active = 1)", actorId),
        guard('receipt_conflict', 'NOT EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash <> ?)',
            actorId, requestId, hash),
        guard('conflict', `${receipt} OR (
            EXISTS (SELECT 1 FROM orders WHERE id = ? AND version = ?)
            AND (SELECT count(*) FROM transactions WHERE ${membership}) = ?
            AND NOT EXISTS (
                SELECT 1 FROM json_each(?) AS snapshot
                LEFT JOIN transactions AS t ON t.id = json_extract(snapshot.value, '$.id')
                WHERE json_extract(snapshot.value, '$.matches') <> 1 OR t.id IS NULL
                    OR t.type IS NOT json_extract(snapshot.value, '$.type')
                    OR t.category IS NOT json_extract(snapshot.value, '$.category')
                    OR t.amount IS NOT json_extract(snapshot.value, '$.amount')
                    OR t.date IS NOT json_extract(snapshot.value, '$.date')
                    OR t.description IS NOT json_extract(snapshot.value, '$.description')
                    OR t.details IS NOT json_extract(snapshot.value, '$.details')
                    OR t.order_id IS NOT json_extract(snapshot.value, '$.order_id')
            ))`, actorId, requestId, key, expectedVersion, key, key, changes.length, snapshots),
        bind(`UPDATE transactions AS t SET
                amount = json_extract(patch.value, '$.amount'),
                category = json_extract(patch.value, '$.category'),
                date = json_extract(patch.value, '$.date'),
                description = json_extract(patch.value, '$.description'),
                details = json_extract(patch.value, '$.details')
            FROM json_each(?) AS patch
            WHERE t.id = json_extract(patch.value, '$.id') AND NOT ${receipt}`, updates, actorId, requestId),
        countGuard('updated', changes.length),
        bind(`UPDATE orders SET version = version + 1 WHERE id = ? AND version = ? AND NOT ${receipt}`,
            key, expectedVersion, actorId, requestId),
        countGuard('version_updated', 1),
        bind(`INSERT INTO activity_events(actor_id, order_id, action, request_id, details)
            SELECT ?, ?, 'order.updated', ?, ? WHERE NOT ${receipt}`, actorId, key, requestId,
            JSON.stringify({ previousVersion: expectedVersion, ...response }), actorId, requestId),
        countGuard('audit_written', 1),
        bind(`INSERT INTO mutation_receipts(actor_id, request_id, payload_hash, response)
            SELECT ?, ?, ?, ? WHERE NOT ${receipt}`, actorId, requestId, hash, responseJSON, actorId, requestId),
        // Unlike earlier count guards, the receipt now exists on a new save too.
        guard('receipt_written', `EXISTS (SELECT 1 FROM mutation_receipts
            WHERE actor_id = ? AND request_id = ? AND payload_hash = ?)`, actorId, requestId, hash),
        bind('DELETE FROM _order_save_guards'),
        bind('SELECT response FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash = ?', actorId, requestId, hash)
    ];
    let results: D1Result[];
    try {
        results = await db.batch(statements);
    } catch (error) {
        mapGuard(error, readyTransition);
    }
    const saved = results.at(-1)?.results as { response?: unknown }[] | undefined;
    const savedResponse = saved?.[0]?.response;
    // Missing/malformed responses are unknown outcomes, not confirmed rollbacks.
    // Leave them as unexpected errors for the caller's logging/recovery boundary.
    if (saved?.length !== 1 || typeof savedResponse !== 'string') {
        throw new Error('Order save result could not be confirmed. Reload before retrying.');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(savedResponse);
    } catch {
        throw new Error('Order save receipt is invalid. Reload before retrying.');
    }
    if (!object(parsed) || Object.keys(parsed).length !== 3 || parsed.orderId !== response.orderId
        || parsed.version !== response.version || !Array.isArray(parsed.ids)
        || parsed.ids.length !== response.ids.length || parsed.ids.some((id, index) => id !== response.ids[index])) {
        throw new Error('Order save receipt is inconsistent. Reload before retrying.');
    }
    return response;
}
