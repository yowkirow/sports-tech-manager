import type { Member } from './auth.ts';
import type { AppEnv } from './env.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readJson } from './http.ts';
import { saveResellerOrderChanges } from './reseller-order-store.ts';
import {
    canonical, decimal, detailsOrderId, OrderStoreError, PRODUCTION_READY_CONDITION, saveOrderChanges, timestamp
} from './order-store.ts';

type Bind = string | number | null;
type Data = Record<string, unknown>;
type Role = Member['role'];
const BUSINESS: Role[] = ['owner', 'reseller'];
const ALL_ROLES: Role[] = [...BUSINESS, 'print_operator'];
const CATALOG = ['define_product', 'delete_product', 'define_brand', 'delete_brand', 'define_color', 'delete_color'];
const TYPES = new Set([...CATALOG, 'sale', 'expense', 'update_stock', 'club_income', 'voucher']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const REVISION = '(SELECT revision FROM system_state WHERE singleton = 1)';
const REPLAY = 'EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ?)';
const ACTIVE = 'EXISTS (SELECT 1 FROM members WHERE id = ? AND email = ? AND role = ? AND active = 1)';
const historyOrder = (prefix = '') => `substr(${prefix}date, 1, 19) DESC,
    substr((CASE WHEN length(${prefix}date) > 20 THEN substr(${prefix}date, 21, length(${prefix}date) - 21)
        ELSE '' END) || '000000000', 1, 9) DESC, ${prefix}id DESC`;

function invalid(message: string): never {
    throw new HttpError(400, 'validation_error', message);
}

function fields(value: unknown, required: string[], optional: string[] = []): Data {
    if (!isObject(value) || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
        invalid('The request contains missing or unsupported fields.');
    }
    return value;
}

function text(value: unknown, label: string, max = 256, empty = false): string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(`Invalid ${label}.`);
    return value;
}

function uuid(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) invalid('Transaction IDs must be UUIDs.');
    return value.toLowerCase();
}

function money(value: unknown, nonnegative = false): string {
    const result = decimal(value, nonnegative);
    if (result.length > 256) invalid('Decimal amounts cannot exceed 256 characters.');
    return result;
}

function bounded(value: unknown): string {
    const result = canonical(value);
    if (encoder.encode(result).byteLength > 1024 * 1024) {
        throw new HttpError(413, 'payload_too_large', 'This request is too large.');
    }
    return result;
}

function allow(member: Member, roles: Role[]): void {
    if (!roles.includes(member.role)) throw new HttpError(403, 'forbidden', 'This membership cannot perform that action.');
}

function parameter(url: URL, name: string, fallback: number, maximum: number): number {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum) {
        invalid(`Invalid ${name}.`);
    }
    return Number(raw);
}

function bind(db: D1Database, sql: string, ...values: Bind[]): D1PreparedStatement {
    return db.prepare(sql).bind(...values);
}

function mapDatabaseError(error: unknown): never {
    let current = error;
    const seen = new Set<unknown>();
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        const name = /CHECK constraint failed: (business_[a-z_]+)(?:: SQLITE_CONSTRAINT.*)?$/.exec(current.message)?.[1];
        if (name === 'business_forbidden') throw new HttpError(403, 'forbidden', 'An active authorized membership is required.');
        if (name === 'business_receipt_conflict') {
            throw new HttpError(409, 'idempotency_conflict', 'This request ID was already used for a different change.');
        }
        if (name === 'business_production_locked') {
            throw new HttpError(409, 'production_locked', 'This change is blocked by existing print jobs. Resolve the production job first.');
        }
        if (name === 'business_conflict' || name === 'business_written') {
            throw new HttpError(409, 'transaction_conflict', 'The source changed. Refresh before retrying.');
        }
        current = current.cause;
    }
    throw error;
}

/** Every write, including replay, authorizes the verified identity inside its batch. */
class Mutation {
    readonly statements: D1PreparedStatement[] = [];
    readonly replayValues: Bind[];
    readonly db: D1Database;
    readonly member: Member;
    readonly requestId: string;
    readonly action: string;
    readonly hash: string;

    private constructor(
        db: D1Database, member: Member, requestId: string, action: string, hash: string
    ) {
        this.db = db;
        this.member = { ...member };
        this.requestId = requestId;
        this.action = action;
        this.hash = hash;
        this.replayValues = [member.id, requestId];
        this.guard('forbidden', ACTIVE, member.id, member.email, member.role);
        this.guard('receipt_conflict',
            'NOT EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash <> ?)',
            member.id, requestId, hash);
    }

    static async create(db: D1Database, member: Member, roles: Role[], requestId: unknown, action: string, payload: unknown): Promise<Mutation> {
        allow(member, roles);
        const key = text(requestId, 'request ID');
        if (key.trim() !== key) invalid('Invalid request ID.');
        const digest = await crypto.subtle.digest('SHA-256', encoder.encode(bounded({ action, payload })));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return new Mutation(db, member, key, action, hash);
    }

    add(sql: string, ...values: Bind[]): void {
        this.statements.push(bind(this.db, sql, ...values));
    }

    guard(kind: string, condition: string, ...values: Bind[]): void {
        this.add(`INSERT INTO _business_guards(kind, ok) VALUES ('${kind}', CASE WHEN ${condition} THEN 1 ELSE 0 END)`, ...values);
    }

    check(condition: string, ...values: Bind[]): void {
        this.guard('conflict', `${REPLAY} OR (${condition})`, ...this.replayValues, ...values);
    }

    changed(count: number): void {
        this.guard('written', `changes() = ? OR ${REPLAY}`, count, ...this.replayValues);
    }

    async replay(): Promise<Data | undefined> {
        const prior = await bind(this.db,
            'SELECT request_id FROM mutation_receipts WHERE actor_id = ? AND request_id = ?', ...this.replayValues).all();
        if (prior.results.length) return this.finish("SELECT '{}' AS response", [], {});
        return undefined;
    }

    async finish(responseSQL: string, responseValues: Bind[], audit: unknown, incrementRevision = false): Promise<Data> {
        if (incrementRevision) {
            this.add(`UPDATE system_state SET revision = revision + 1 WHERE singleton = 1 AND NOT ${REPLAY}`, ...this.replayValues);
            this.changed(1);
        }
        this.add(`INSERT INTO business_events(actor_id, request_id, action, details)
            SELECT ?, ?, ?, ? WHERE NOT ${REPLAY}`,
        this.member.id, this.requestId, this.action, bounded(audit), ...this.replayValues);
        this.changed(1);
        this.add(`INSERT INTO mutation_receipts(actor_id, request_id, payload_hash, response)
            SELECT ?, ?, ?, result.response FROM (${responseSQL}) AS result WHERE NOT ${REPLAY}`,
        this.member.id, this.requestId, this.hash, ...responseValues, ...this.replayValues);
        this.guard('written', 'EXISTS (SELECT 1 FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash = ?)',
            this.member.id, this.requestId, this.hash);
        this.add('DELETE FROM _business_guards');
        this.add('SELECT response FROM mutation_receipts WHERE actor_id = ? AND request_id = ? AND payload_hash = ?',
            this.member.id, this.requestId, this.hash);
        let results: D1Result[];
        try { results = await this.db.batch(this.statements); }
        catch (error) { mapDatabaseError(error); }
        const saved = results.at(-1)?.results as { response?: unknown }[] | undefined;
        if (saved?.length !== 1 || typeof saved[0]?.response !== 'string') {
            throw new Error('Business mutation result could not be confirmed. Retry with the same request ID.');
        }
        const response: unknown = JSON.parse(saved[0].response);
        if (!isObject(response)) throw new Error('Business mutation receipt is invalid.');
        return response;
    }
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
    created_at: string;
    orderVersion: number | null;
    revision?: number;
}

const ROW_COLUMNS = `t.id, t.type, t.category, t.amount, t.date, t.description, t.details,
    t.order_id, t.created_at, o.version AS orderVersion`;
const ORDER_JOIN = `LEFT JOIN orders AS o ON o.id = coalesce(t.order_id,
    CASE WHEN t.type = 'sale' THEN coalesce(nullif(json_extract(t.details, '$.orderId'), ''), t.id) END)`;
const ROW_JSON = `json_object('id', t.id, 'type', t.type, 'category', t.category,
    'amount', t.amount, 'date', t.date, 'description', t.description, 'details', t.details,
    'order_id', t.order_id, 'created_at', t.created_at, 'orderVersion', o.version)`;

function legacyRow(row: StoredRow, member: Member): Data {
    let details: unknown = row.details === null ? null : JSON.parse(row.details);
    let amount = row.amount;
    let description = row.description;
    if (member.role === 'reseller' && CATALOG.includes(row.type)) {
        const safe: Data = {};
        if (isObject(details)) {
            for (const key of ['name', 'price', 'imageUrl', 'images', 'linkedColor', 'category', 'order', 'brand', 'hex']) {
                if (Object.hasOwn(details, key)) safe[key] = details[key];
            }
        }
        details = safe;
        amount = '0';
        description = null;
    }
    return {
        id: row.id, type: row.type, category: row.category, amount: Number(amount), amountExact: amount,
        date: row.date, description, details, created_at: row.created_at,
        ...(row.type === 'sale' ? { orderVersion: row.orderVersion ?? 0 } : {})
    };
}

function rowsResponse(response: Data, member: Member): Data {
    if (!Array.isArray(response.rows)) throw new Error('Transaction receipt has no rows.');
    return { rows: (response.rows as StoredRow[]).map(row => legacyRow(row, member)) };
}

async function history(db: D1Database, member: Member, url: URL): Promise<Data> {
    allow(member, BUSINESS);
    const offset = parameter(url, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = Math.min(parameter(url, 'limit', 100, 1000), 100);
    if (limit < 1) invalid('Limit must be positive.');
    const revision = url.searchParams.has('revision') ? parameter(url, 'revision', 0, Number.MAX_SAFE_INTEGER) : null;
    const scope = member.role === 'owner' ? '1 = 1'
        : `(t.type IN (SELECT value FROM json_each(?)) OR json_extract(t.details, '$.createdBy') = ?)`;
    const scopeValues: Bind[] = member.role === 'owner' ? [] : [JSON.stringify(CATALOG), member.email];
    const results = await db.batch([
        bind(db, `SELECT ${REVISION} AS revision, ${ACTIVE} AS authorized,
            (SELECT count(*) FROM transactions AS t WHERE ${scope}) AS count`,
        member.id, member.email, member.role, ...scopeValues),
        bind(db, `SELECT ${ROW_COLUMNS} FROM transactions AS t ${ORDER_JOIN}
            WHERE ${scope} ORDER BY ${historyOrder('t.')} LIMIT ? OFFSET ?`, ...scopeValues, limit, offset)
    ]);
    const meta = results[0]?.results[0] as { revision: number; count: number; authorized: number } | undefined;
    if (!meta) throw new Error('Transaction history metadata is missing.');
    if (!meta.authorized) throw new HttpError(403, 'forbidden', 'An active membership is required.');
    if (revision !== null && revision !== meta.revision) {
        throw new HttpError(409, 'history_changed', 'Transaction history changed. Restart pagination.');
    }
    return { rows: (results[1]?.results as StoredRow[]).map(row => legacyRow(row, member)), count: meta.count, revision: meta.revision };
}

interface NewRow {
    id: string;
    type: string;
    category: string;
    amount: string;
    date: string;
    description: string | null;
    details: Data | null;
    order_id: string | null;
}

function newRows(input: unknown, member: Member): NewRow[] {
    if (!Array.isArray(input) || !input.length) invalid('At least one transaction is required.');
    const ids = new Set<string>();
    return input.map(value => {
        const row = fields(value, ['type', 'category', 'amount', 'date'], ['id', 'description', 'details']);
        const id = row.id === undefined ? crypto.randomUUID() : uuid(row.id);
        if (ids.has(id)) invalid('Duplicate transaction IDs.');
        ids.add(id);
        const type = text(row.type, 'type', 64);
        if (!TYPES.has(type)) invalid('Unsupported transaction type.');
        if (member.role === 'reseller' && type !== 'sale') {
            throw new HttpError(403, 'forbidden', 'Resellers may only submit their own POS orders.');
        }
        if (row.details != null && !isObject(row.details)) invalid('Transaction details must be an object or null.');
        const details = row.details == null && type !== 'sale' ? null : {
            ...(row.details as Data | undefined), createdBy: member.email, userRole: member.role
        };
        if (details !== null) bounded(details);
        return {
            id, type, category: text(row.category, 'category', 128),
            amount: money(row.amount, type === 'sale'), date: timestamp(row.date),
            description: row.description == null ? null : text(row.description, 'description', 4096, true),
            details, order_id: type === 'sale' ? detailsOrderId(details, id) : null
        };
    });
}

/** Flat POS reseller policy: current products, fixed reseller price/ball tiers,
 * no custom prices, discounts, freight, paid flags, nesting or fulfillment edits. */
async function validateReseller(db: D1Database, rows: NewRow[]): Promise<number> {
    const names = rows.map(row => text(row.details?.itemName, 'product name').trim().toLowerCase());
    const results = await db.batch([
        bind(db, `SELECT ${REVISION} AS revision`),
        bind(db, `SELECT id, type, details FROM (
            SELECT id, type, details, row_number() OVER (
                PARTITION BY lower(trim(json_extract(details, '$.name'))) ORDER BY ${historyOrder()}
            ) AS rank FROM transactions
            WHERE type IN ('define_product', 'delete_product')
                AND lower(trim(json_extract(details, '$.name'))) IN (SELECT value FROM json_each(?))
        ) WHERE rank = 1`, bounded(names))
    ]);
    const products = new Map<string, Data>();
    for (const row of results[1]?.results as { type: string; details: string }[]) {
        const product: unknown = JSON.parse(row.details);
        if (row.type === 'define_product' && isObject(product) && typeof product.name === 'string') {
            products.set(product.name.trim().toLowerCase(), product);
        }
    }
    const orderIds = new Set(rows.map(row => row.order_id));
    if (orderIds.size !== 1) invalid('A reseller checkout must contain exactly one order.');
    for (const row of rows) {
        const details = fields(row.details, ['orderId', 'itemName', 'quantity', 'source', 'customerName'],
            ['createdBy', 'userRole', 'contactNumber', 'brand', 'category', 'unitPrice', 'originalAmount',
                'discountShare', 'shippingShare', 'size', 'color', 'imageUrl', 'pricing', 'shippingDetails',
                'paymentMode', 'paymentStatus', 'fulfillmentStatus', 'status']);
        const product = products.get(text(details.itemName, 'product name').trim().toLowerCase());
        if (!product) invalid('A requested product is no longer available.');
        const quantity = details.quantity;
        if (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 100_000) invalid('Invalid quantity.');
        const category = text(product.category ?? 'shirts', 'product category', 128);
        const brand = text(product.brand ?? 'Sypik', 'product brand');
        const color = text(product.linkedColor ?? '', 'product color', 256, true);
        if (details.source !== 'pos' || row.category !== category || details.category !== category
            || (details.brand ?? 'Sypik') !== brand || (details.color ?? '') !== color) {
            invalid('POS product identity does not match the current catalog.');
        }
        const ball = category.trim().toLowerCase() === 'balls' || String(product.name).toLowerCase().includes('ball');
        const qty = Number(quantity);
        const price = ball ? qty >= 100 ? 70 : qty >= 50 ? 80 : qty >= 21 ? 90 : 100 : 400;
        const amount = String(price * qty);
        if (row.amount !== amount || money(details.unitPrice ?? price) !== String(price)
            || money(details.originalAmount ?? amount) !== amount
            || money(details.discountShare ?? 0) !== '0' || money(details.shippingShare ?? 0) !== '0') {
            invalid('Reseller amounts must match server-calculated product prices.');
        }
        if ((details.paymentStatus ?? 'unpaid') !== 'unpaid' || (details.fulfillmentStatus ?? 'pending') !== 'pending'
            || (details.status ?? 'pending') !== 'pending') {
            throw new HttpError(403, 'forbidden', 'Resellers cannot mark orders paid or change fulfillment status.');
        }
        text(details.customerName, 'customer name');
        if (details.contactNumber !== undefined) text(details.contactNumber, 'contact number', 128, true);
        if (details.size !== undefined) text(details.size, 'size', 64, true);
        if (details.paymentMode !== undefined && !['Cash', 'Gcash', 'Bank Transfer', 'COD'].includes(String(details.paymentMode))) {
            invalid('Unsupported payment mode.');
        }
        if (details.pricing !== undefined) {
            const pricing = fields(details.pricing, [], ['version', 'discount', 'shippingFee', 'isRushOrder', 'rushFeePerShirt', 'shippingLineId']);
            if ((pricing.version ?? 1) !== 1 || pricing.discount != null || money(pricing.shippingFee ?? 0) !== '0'
                || (pricing.isRushOrder ?? false) !== false || money(pricing.rushFeePerShirt ?? 100) !== '100'
                || (pricing.shippingLineId !== undefined && !rows.some(item => item.id === pricing.shippingLineId))) {
                invalid('Unsupported reseller pricing options.');
            }
        }
        if (details.shippingDetails !== undefined) {
            const shipping = fields(details.shippingDetails, [], [
                'address', 'city', 'province', 'barangay', 'contactNumber', 'region', 'shippingFee', 'rushFee', 'isRushOrder'
            ]);
            for (const key of ['address', 'city', 'province', 'barangay', 'contactNumber', 'region']) {
                if (shipping[key] !== undefined) text(shipping[key], key, 1024, true);
            }
            if (money(shipping.shippingFee ?? 0) !== '0' || money(shipping.rushFee ?? 0) !== '0'
                || (shipping.isRushOrder ?? false) !== false) invalid('Resellers cannot set freight or rush fees.');
        }
        Object.assign(details, {
            unitPrice: price, originalAmount: price * qty, discountShare: 0, shippingShare: 0,
            paymentStatus: 'unpaid', fulfillmentStatus: 'pending', status: 'pending',
            itemName: product.name, imageUrl: product.imageUrl ?? '', brand, color, category
        });
    }
    const meta = results[0]?.results[0] as { revision: number } | undefined;
    if (!meta) throw new Error('Catalog revision is missing.');
    return meta.revision;
}

export async function insertTransactions(
    db: D1Database, member: Member, rows: unknown, requestId: unknown, requireProductionReady = false
): Promise<Data> {
    const mutation = await Mutation.create(db, member, BUSINESS, requestId, 'transactions.insert', { rows });
    const replay = await mutation.replay();
    if (replay) return rowsResponse(replay, member);
    const normalized = newRows(rows, member);
    if (member.role === 'reseller') {
        const revision = await validateReseller(db, normalized);
        mutation.check(`${REVISION} = ?`, revision);
    }
    const ids = bounded(normalized.map(row => row.id));
    const orders = bounded([...new Set(normalized.flatMap(row => row.order_id === null ? [] : [row.order_id]))]);
    const values = bounded(normalized.map(row => ({ ...row, details: row.details === null ? null : canonical(row.details) })));
    mutation.check(`NOT EXISTS (SELECT 1 FROM transactions WHERE id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM transaction_tombstones WHERE id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM orders WHERE id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM transactions WHERE type = 'sale'
            AND coalesce(nullif(json_extract(details, '$.orderId'), ''), id) IN (SELECT value FROM json_each(?)))`,
    ids, ids, orders, orders);
    mutation.add(`INSERT INTO orders(id) SELECT value FROM json_each(?) WHERE NOT ${REPLAY}`, orders, ...mutation.replayValues);
    mutation.changed(JSON.parse(orders).length as number);
    mutation.add(`INSERT INTO transactions(id, type, category, amount, date, description, details, order_id)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.type'), json_extract(value, '$.category'),
            json_extract(value, '$.amount'), json_extract(value, '$.date'), json_extract(value, '$.description'),
            json_extract(value, '$.details'), json_extract(value, '$.order_id')
        FROM json_each(?) WHERE NOT ${REPLAY}`, values, ...mutation.replayValues);
    mutation.changed(normalized.length);
    if (requireProductionReady) {
        mutation.guard('production_locked', `${REPLAY} OR ${PRODUCTION_READY_CONDITION}`, ...mutation.replayValues, orders);
    }
    const response = await mutation.finish(`SELECT json_object('rows', json_group_array(json(row))) AS response
        FROM (SELECT ${ROW_JSON} AS row FROM json_each(?) AS requested
            JOIN transactions AS t ON t.id = requested.value ${ORDER_JOIN} ORDER BY requested.key)`,
    [ids], { ids: normalized.map(row => row.id), orders: JSON.parse(orders) });
    return rowsResponse(response, member);
}

function expectedSnapshot(value: unknown, id: string): Data {
    const source = fields(value, ['type', 'category', 'amount', 'date', 'description', 'details'],
        ['id', 'amountExact', 'orderVersion', 'created_at', 'order_id']);
    if (source.id !== undefined && uuid(source.id) !== id) invalid('Expected transaction ID does not match.');
    if (source.amountExact !== undefined && Number(money(source.amountExact)) !== Number(source.amount)) {
        invalid('Expected exact amount does not match its display amount.');
    }
    const expected = {
        type: text(source.type, 'expected type', 64), category: text(source.category, 'expected category', 128),
        amount: money(source.amountExact ?? source.amount), date: timestamp(source.date),
        description: source.description === null ? null : text(source.description, 'expected description', 4096, true),
        details: JSON.parse(canonical(source.details)) as unknown, orderVersion: source.orderVersion
    };
    if (expected.type === 'sale' && (!Number.isSafeInteger(expected.orderVersion) || Number(expected.orderVersion) < 0
        || Number(expected.orderVersion) >= Number.MAX_SAFE_INTEGER)) invalid('Sale changes require the expected orderVersion.');
    return expected;
}

function snapshotMatches(row: StoredRow, expected: Data): boolean {
    return row.type === expected.type && row.category === expected.category && decimal(row.amount) === expected.amount
        && timestamp(row.date) === expected.date && row.description === expected.description
        && canonical(row.details === null ? null : JSON.parse(row.details)) === canonical(expected.details)
        && (row.type !== 'sale' || (row.orderVersion ?? 0) === expected.orderVersion);
}

async function resetProductionGuard(mutation: Mutation): Promise<void> {
    const tables = await bind(mutation.db, `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'production_jobs'`).all();
    if (tables.results.length) {
        mutation.guard('production_locked', `${REPLAY} OR NOT EXISTS (SELECT 1 FROM production_jobs)`, ...mutation.replayValues);
    }
}

async function changeTransaction(
    db: D1Database, member: Member, id: string, body: Data, deleting: boolean
): Promise<Data> {
    allow(member, ['owner']);
    const expected = expectedSnapshot(body.expected, id);
    const updates = deleting ? {} : fields(body.updates, [], ['amount', 'date', 'description', 'category', 'details']);
    if (!deleting && !Object.keys(updates).length) invalid('At least one update is required.');
    if (expected.type === 'sale' && Object.keys(updates).some(key => !['amount', 'date', 'description'].includes(key))) {
        invalid('Use /api/orders/save for order details and multi-line financial edits.');
    }
    const mutation = await Mutation.create(db, member, ['owner'], body.requestId,
        deleting ? 'transactions.delete' : 'transactions.update', { id, expected: body.expected, ...(deleting ? {} : { updates }) });
    const replay = await mutation.replay();
    if (replay) return deleting ? replay : { row: legacyRow(replay.row as unknown as StoredRow, member) };
    const result = await bind(db, `SELECT ${ROW_COLUMNS}, ${REVISION} AS revision
        FROM transactions AS t ${ORDER_JOIN} WHERE t.id = ?`, id).all<StoredRow>();
    const row = result.results[0];
    if (!row || !snapshotMatches(row, expected)) {
        throw new HttpError(409, 'transaction_conflict', 'The source changed or was deleted. Refresh before retrying.');
    }
    const key = row.type === 'sale' ? detailsOrderId(expected.details, id) : null;
    if (key !== null && row.order_id !== null && key !== row.order_id) {
        throw new HttpError(409, 'transaction_conflict', 'The source order identity is inconsistent.');
    }
    mutation.check(`${REVISION} = ? AND EXISTS (SELECT 1 FROM transactions
        WHERE id = ? AND type IS ? AND category IS ? AND amount IS ? AND date IS ?
            AND description IS ? AND details IS ? AND order_id IS ?)`,
    row.revision ?? -1, id, row.type, row.category, row.amount, row.date, row.description, row.details, row.order_id);
    if (key !== null) {
        mutation.check('EXISTS (SELECT 1 FROM orders WHERE id = ? AND version = ?)', key, Number(expected.orderVersion));
    }
    if (deleting) {
        mutation.add(`INSERT INTO transaction_tombstones(id, actor_id, request_id)
            SELECT ?, ?, ? WHERE NOT ${REPLAY}`, id, member.id, mutation.requestId, ...mutation.replayValues);
        mutation.changed(1);
        mutation.add(`DELETE FROM transactions WHERE id = ? AND NOT ${REPLAY}`, id, ...mutation.replayValues);
    } else {
        const amount = Object.hasOwn(updates, 'amount') ? money(updates.amount, row.type === 'sale') : row.amount;
        const date = Object.hasOwn(updates, 'date') ? timestamp(updates.date) : row.date;
        const description = Object.hasOwn(updates, 'description')
            ? updates.description === null ? null : text(updates.description, 'description', 4096, true) : row.description;
        const category = Object.hasOwn(updates, 'category') ? text(updates.category, 'category', 128) : row.category;
        let details = row.details;
        if (Object.hasOwn(updates, 'details')) {
            if (updates.details !== null && !isObject(updates.details)) invalid('Updated details must be an object or null.');
            const previous: unknown = row.details === null ? null : JSON.parse(row.details);
            details = updates.details === null ? null : canonical({
                ...updates.details,
                createdBy: isObject(previous) && typeof previous.createdBy === 'string' ? previous.createdBy : member.email,
                userRole: isObject(previous) && typeof previous.userRole === 'string' ? previous.userRole : member.role
            });
        }
        mutation.add(`UPDATE transactions SET amount = ?, date = ?, description = ?, category = ?, details = ?
            WHERE id = ? AND NOT ${REPLAY}`, amount, date, description, category, details, id, ...mutation.replayValues);
    }
    mutation.changed(1);
    if (key !== null) {
        mutation.add(`UPDATE orders SET version = version + 1 WHERE id = ? AND version = ? AND NOT ${REPLAY}`,
            key, Number(expected.orderVersion), ...mutation.replayValues);
        mutation.changed(1);
    }
    const response = await mutation.finish(deleting ? "SELECT json_object('id', ?) AS response"
        : `SELECT json_object('row', ${ROW_JSON}) AS response FROM transactions AS t ${ORDER_JOIN} WHERE t.id = ?`,
    [id], { id, before: row, ...(deleting ? {} : { updates }) });
    return deleting ? response : { row: legacyRow(response.row as unknown as StoredRow, member) };
}

async function resetTransactions(db: D1Database, member: Member, body: Data): Promise<Data> {
    if (body.confirmation !== 'DELETE ALL') invalid('Type DELETE ALL to reset transaction history.');
    const mutation = await Mutation.create(db, member, ['owner'], body.requestId, 'transactions.reset', { confirmation: body.confirmation });
    const replay = await mutation.replay();
    if (replay) return replay;
    await resetProductionGuard(mutation);
    mutation.add(`INSERT INTO transaction_tombstones(id, actor_id, request_id)
        SELECT id, ?, ? FROM transactions WHERE NOT ${REPLAY}`, member.id, mutation.requestId, ...mutation.replayValues);
    // Order identities, versions, receipts and audit survive a deliberately
    // authorized financial reset, preventing identity reuse or dangling audit.
    mutation.add(`UPDATE orders SET version = version + 1
        WHERE id IN (SELECT coalesce(order_id, nullif(json_extract(details, '$.orderId'), ''), id)
            FROM transactions WHERE type = 'sale') AND NOT ${REPLAY}`, ...mutation.replayValues);
    mutation.add(`DELETE FROM transactions WHERE NOT ${REPLAY}`, ...mutation.replayValues);
    mutation.check('NOT EXISTS (SELECT 1 FROM transactions)');
    return mutation.finish("SELECT json_object('ok', json('true')) AS response", [], { confirmation: 'DELETE ALL' }, true);
}

async function deleteOrder(db: D1Database, member: Member, key: string, body: Data): Promise<Data> {
    fields(body, ['expectedVersion', 'sourceIds', 'requestId']);
    if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0
        || !Array.isArray(body.sourceIds) || !body.sourceIds.length) invalid('A complete order snapshot is required.');
    const expectedIds = body.sourceIds.map(uuid).sort();
    if (new Set(expectedIds).size !== expectedIds.length) invalid('Order source IDs must be unique.');
    const mutation = await Mutation.create(db, member, ['owner'], body.requestId, 'orders.delete', {
        orderId: key, expectedVersion: body.expectedVersion, sourceIds: expectedIds
    });
    const replay = await mutation.replay();
    if (replay) return replay;
    const snapshot = await bind(db, `SELECT t.id,t.details,${REVISION} AS revision FROM transactions t
        WHERE type='sale' AND coalesce(order_id,nullif(json_extract(details,'$.orderId'),''),id)=? ORDER BY id`, key)
        .all<{ id: string; details: string | null; revision: number }>();
    const active = snapshot.results.filter(row => !JSON.parse(row.details ?? '{}')?.removedFromOrder).map(row => row.id);
    if (!snapshot.results.length || canonical(active) !== canonical(expectedIds)) {
        throw new HttpError(409, 'transaction_conflict', 'The order changed. Reload before deleting it.');
    }
    const ids = bounded(snapshot.results.map(row => row.id));
    mutation.check(`${REVISION}=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)`,
        snapshot.results[0]!.revision, key, Number(body.expectedVersion));
    mutation.add(`INSERT INTO transaction_tombstones(id,actor_id,request_id)
        SELECT value,?,? FROM json_each(?) WHERE NOT ${REPLAY}`, member.id, mutation.requestId, ids, ...mutation.replayValues);
    mutation.changed(snapshot.results.length);
    mutation.add(`DELETE FROM transactions WHERE id IN (SELECT value FROM json_each(?)) AND NOT ${REPLAY}`, ids, ...mutation.replayValues);
    mutation.changed(snapshot.results.length);
    mutation.add(`UPDATE orders SET version=version+1 WHERE id=? AND version=? AND NOT ${REPLAY}`,
        key, Number(body.expectedVersion), ...mutation.replayValues);
    mutation.changed(1);
    return mutation.finish("SELECT json_object('orderId',?,'ids',json(?)) AS response", [key, ids], {
        orderId: key, sourceIds: snapshot.results.map(row => row.id)
    });
}

interface Customer {
    id: string;
    name: string;
    contact_number: string | null;
    address: string | null;
    notes: string | null;
    total_spent: string;
    owner_id: string | null;
}

function customerResult(customer: Customer, member: Member): Data {
    return {
        id: customer.id, name: customer.name, contact_number: customer.contact_number, address: customer.address,
        ...(member.role === 'owner' ? { total_spent: Number(customer.total_spent), total_spentExact: customer.total_spent, notes: customer.notes } : {})
    };
}

function addDecimal(left: string, right: string): string {
    const a = left.split('.');
    const b = right.split('.');
    const scale = Math.max(a[1]?.length ?? 0, b[1]?.length ?? 0);
    const integer = (parts: string[]) => BigInt(`${parts[0]}${(parts[1] ?? '').padEnd(scale, '0')}`);
    const sum = (integer(a) + integer(b)).toString().padStart(scale + 1, '0');
    return money(scale ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}` : sum, true);
}

async function customers(db: D1Database, member: Member, url: URL): Promise<Data> {
    allow(member, BUSINESS);
    const query = text(url.searchParams.get('q') ?? '', 'customer query', 256, true).trim();
    if (!query) return { customers: [] };
    const scope = member.role === 'owner' ? '1 = 1' : 'owner_id = ?';
    const rows = await bind(db, `SELECT id, name, contact_number, address, notes, total_spent, owner_id FROM customers
        WHERE ${ACTIVE} AND ${scope} AND instr(lower(name), lower(?)) > 0 ORDER BY name, id LIMIT 5`,
    member.id, member.email, member.role, ...(member.role === 'owner' ? [] : [member.id]), query).all<Customer>();
    return { customers: rows.results.map(row => customerResult(row, member)) };
}

const CUSTOMER_JSON = `json_object('id', id, 'name', name, 'contact_number', contact_number,
    'address', address, 'notes', notes, 'total_spent', total_spent, 'owner_id', owner_id)`;

async function upsertCustomer(db: D1Database, member: Member, body: Data): Promise<Data> {
    const details = fields(body.details, ['name'], ['contact_number', 'address', 'total_spent', 'notes']);
    if (Object.hasOwn(details, 'notes') && member.role !== 'owner') {
        throw new HttpError(403, 'forbidden', 'Only the owner can change customer notes.');
    }
    const name = text(details.name, 'customer name').trim();
    const increment = money(details.total_spent ?? 0, true);
    const contact = details.contact_number == null ? null : text(details.contact_number, 'contact number', 128, true);
    const address = details.address == null ? null : text(details.address, 'address', 4096, true);
    const notes = details.notes == null ? null : text(details.notes, 'notes', 4096, true);
    const mutation = await Mutation.create(db, member, BUSINESS, body.requestId, 'customers.upsert', details);
    const replay = await mutation.replay();
    if (replay) return { customer: customerResult(replay.customer as unknown as Customer, member) };
    const owner = member.role === 'owner' ? null : member.id;
    const found = await bind(db, 'SELECT * FROM customers WHERE name = ? AND owner_id IS ?', name, owner).all<Customer>();
    const existing = found.results[0];
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
        mutation.check(`EXISTS (SELECT 1 FROM customers WHERE id = ? AND name = ? AND owner_id IS ?
            AND total_spent IS ? AND contact_number IS ? AND address IS ? AND notes IS ?)`,
        id, name, owner, existing.total_spent, existing.contact_number, existing.address, existing.notes);
        mutation.add(`UPDATE customers SET total_spent = ?, contact_number = ?, address = ?, notes = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND NOT ${REPLAY}`,
        addDecimal(money(existing.total_spent, true), increment), contact || existing.contact_number, address || existing.address,
        Object.hasOwn(details, 'notes') ? notes : existing.notes, id, ...mutation.replayValues);
    } else {
        mutation.check('NOT EXISTS (SELECT 1 FROM customers WHERE name = ? AND owner_id IS ?)', name, owner);
        mutation.add(`INSERT INTO customers(id, name, contact_number, address, notes, total_spent, owner_id)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT ${REPLAY}`, id, name, contact, address, notes, increment, owner, ...mutation.replayValues);
    }
    mutation.changed(1);
    const response = await mutation.finish(`SELECT json_object('customer', ${CUSTOMER_JSON}) AS response FROM customers WHERE id = ?`,
        [id], { id, increment }, true);
    return { customer: customerResult(response.customer as unknown as Customer, member) };
}

const PROFILE_FIELDS = ['full_name', 'expense_categories', 'enable_sms_notifications', 'tracking_sms_template'];

function publicProfile(profile: unknown): Data {
    if (!isObject(profile)) return {};
    return Object.fromEntries(PROFILE_FIELDS.filter(key => Object.hasOwn(profile, key)).map(key => [key, profile[key]]));
}

async function getProfile(db: D1Database, member: Member): Promise<Data> {
    const result = await bind(db, `SELECT p.profile FROM members AS m LEFT JOIN member_profiles AS p ON p.member_id = m.id
        WHERE m.id = ? AND m.email = ? AND m.role = ? AND m.active = 1`, member.id, member.email, member.role)
        .all<{ profile: string | null }>();
    if (!result.results.length) throw new HttpError(403, 'forbidden', 'An active membership is required.');
    return { profile: publicProfile(JSON.parse(result.results[0]?.profile ?? '{}')) };
}

async function patchProfile(db: D1Database, member: Member, body: unknown): Promise<Data> {
    const patch = fields(body, [], PROFILE_FIELDS);
    if (!Object.keys(patch).length) invalid('At least one profile field is required.');
    if (patch.full_name !== undefined) text(patch.full_name, 'full name', 256, true);
    if (patch.expense_categories !== undefined) {
        if (!Array.isArray(patch.expense_categories) || patch.expense_categories.length > 100) invalid('Invalid expense categories.');
        for (const category of patch.expense_categories) text(category, 'expense category', 128);
    }
    if (patch.enable_sms_notifications !== undefined && typeof patch.enable_sms_notifications !== 'boolean') invalid('Invalid SMS notification flag.');
    if (patch.tracking_sms_template !== undefined) text(patch.tracking_sms_template, 'SMS template', 2000, true);
    const mutation = await Mutation.create(db, member, ALL_ROLES, crypto.randomUUID(), 'profile.update', patch);
    mutation.add(`INSERT INTO member_profiles(member_id, profile) VALUES (?, ?)
        ON CONFLICT(member_id) DO UPDATE SET profile = json_patch(member_profiles.profile, excluded.profile)`,
    member.id, bounded(patch));
    mutation.changed(1);
    const response = await mutation.finish("SELECT json_object('profile', json(profile)) AS response FROM member_profiles WHERE member_id = ?",
        [member.id], { fields: Object.keys(patch) }, true);
    return { profile: publicProfile(response.profile) };
}

async function activity(db: D1Database, member: Member, url: URL): Promise<Data> {
    allow(member, ['owner']);
    const offset = parameter(url, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = parameter(url, 'limit', 100, 1000);
    if (!limit) invalid('Limit must be positive.');
    const result = await bind(db, `SELECT id, user_email, action, details, entity_id, created_at FROM activity_logs
        WHERE ${ACTIVE} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    member.id, member.email, member.role, limit, offset).all();
    return { logs: result.results };
}

async function logActivity(db: D1Database, member: Member, input: unknown): Promise<Data> {
    const body = fields(input, ['action'], ['details', 'entityId']);
    const action = text(body.action, 'activity action', 256);
    const details = body.details == null ? null : typeof body.details === 'string'
        ? text(body.details, 'activity details', 32768, true) : bounded(body.details);
    const entityId = body.entityId == null ? null : text(body.entityId, 'entity ID', 256);
    const id = crypto.randomUUID();
    const mutation = await Mutation.create(db, member, ALL_ROLES, id, 'activity.append', body);
    mutation.add('INSERT INTO activity_logs(id, actor_id, user_email, action, details, entity_id) VALUES (?, ?, ?, ?, ?, ?)',
        id, member.id, member.email, action, details, entityId);
    mutation.changed(1);
    return mutation.finish("SELECT json_object('id', ?) AS response", [id], { id, action }, true);
}

async function members(db: D1Database, member: Member): Promise<Data> {
    allow(member, ['owner']);
    const result = await bind(db, `SELECT m.id, m.email, m.role, m.active,
        coalesce(CASE WHEN json_type(p.profile, '$.full_name') = 'text'
            THEN json_extract(p.profile, '$.full_name') END, '') AS name
        FROM members AS m LEFT JOIN member_profiles AS p ON p.member_id = m.id
        WHERE ${ACTIVE} ORDER BY m.email LIMIT 1000`, member.id, member.email, member.role)
        .all<{ id: string; email: string; role: Role; active: number; name: string }>();
    return { members: result.results.map(row => ({ ...row, active: row.active === 1 })) };
}

export async function handleBusinessRequest(request: Request, env: AppEnv, member: Member): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
        if (path === '/api/transactions/revision' && method === 'GET') {
            allow(member, BUSINESS);
            const page = await bind(env.DB, `SELECT ${REVISION} AS revision WHERE ${ACTIVE}`,
                member.id, member.email, member.role).all<{ revision: number }>();
            const result = page.results[0];
            if (!result) throw new HttpError(403, 'forbidden', 'An active membership is required.');
            return json({ revision: result.revision });
        }
        if (path === '/api/transactions') {
            if (method === 'GET') return json(await history(env.DB, member, url));
            if (method === 'POST') {
                const body = fields(await readJson(request), ['rows', 'requestId']);
                return json(await insertTransactions(env.DB, member, body.rows, body.requestId, env.PRINT_QUEUE_ENABLED === 'true'));
            }
            if (method === 'DELETE') {
                const body = fields(await readJson(request), ['confirmation', 'requestId']);
                return json(await resetTransactions(env.DB, member, body));
            }
        }
        const transactionPath = /^\/api\/transactions\/([^/]+)$/.exec(path);
        if (transactionPath && (method === 'PATCH' || method === 'DELETE')) {
            const id = uuid(transactionPath[1]);
            const body = fields(await readJson(request), method === 'PATCH' ? ['updates', 'expected', 'requestId'] : ['expected', 'requestId']);
            return json(await changeTransaction(env.DB, member, id, body, method === 'DELETE'));
        }
        if (path === '/api/orders/save' && method === 'POST') {
            allow(member, BUSINESS);
            const body = fields(await readJson(request), ['orderId', 'expectedVersion', 'requestId', 'changes'], ['requirePending', 'packingConfirmed']);
            if (body.packingConfirmed !== undefined && typeof body.packingConfirmed !== 'boolean') invalid('Packing confirmation must be boolean.');
            const { packingConfirmed, ...input } = body;
            if (member.role === 'reseller') {
                if (packingConfirmed === true) throw new HttpError(403, 'forbidden', 'Packing confirmation is owner-only.');
                return json(await saveResellerOrderChanges(env.DB, member, input, validateReseller));
            }
            return json(await saveOrderChanges(env.DB, member.id, input, {
                requireProductionReady: env.PRINT_QUEUE_ENABLED === 'true',
                packingConfirmed: packingConfirmed === true
            }));
        }
        const deletePath = /^\/api\/orders\/([^/]+)$/.exec(path);
        if (deletePath && method === 'DELETE') {
            const key = text(decodeURIComponent(deletePath[1]!), 'order ID');
            return json(await deleteOrder(env.DB, member, key, fields(await readJson(request),
                ['expectedVersion', 'sourceIds', 'requestId'])));
        }
        if (path === '/api/customers') {
            if (method === 'GET') return json(await customers(env.DB, member, url));
            if (method === 'POST') {
                const body = fields(await readJson(request), ['details', 'requestId']);
                return json(await upsertCustomer(env.DB, member, body));
            }
        }
        if (path === '/api/profile') {
            if (method === 'GET') return json(await getProfile(env.DB, member));
            if (method === 'PATCH') return json(await patchProfile(env.DB, member, await readJson(request)));
        }
        if (path === '/api/activity') {
            if (method === 'GET') return json(await activity(env.DB, member, url));
            if (method === 'POST') return json(await logActivity(env.DB, member, await readJson(request)));
        }
        if (path === '/api/members' && method === 'GET') {
            return json(await members(env.DB, member));
        }
        return null;
    } catch (error) {
        if (error instanceof OrderStoreError) throw new HttpError(error.status, error.code, error.message);
        throw error;
    }
}
