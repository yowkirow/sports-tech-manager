import type { SaveOrderInput } from './order-store.ts';
import { HttpError } from './errors.ts';

// This primitive is intentionally not an HTTP/RPC entry point. Its changes are
// produced by the public boundary from the current stored order, never the guest.
export async function saveGuestOrder(
    db: D1Database,
    context: { orderId: string; contact: string; contactHash: string; grantId: string; payloadHash: string; revision: number },
    input: SaveOrderInput
) {
    if (input.orderId !== context.orderId || !input.requirePending || !input.changes.length
        || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
        || new Set(input.changes.map(change => change.id)).size !== input.changes.length) {
        throw new HttpError(400, 'invalid_order_change', 'The order changes could not be verified.');
    }
    const rows = input.changes.map(change => ({
        id: change.id,
        expected: { ...change.expected, amount: String(change.expected.amount) },
        updates: {
            category: change.updates.category ?? change.expected.category,
            amount: String(change.updates.amount), details: change.updates.details
        }
    }));
    if (rows.every(row => row.updates.details.removedFromOrder === true)) throw new HttpError(400, 'empty_order', 'The order cannot be empty.');
    const data = JSON.stringify(rows);
    const active = `t.type = 'sale' AND coalesce(json_extract(t.details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND (t.order_id = ? OR coalesce(nullif(json_extract(t.details,'$.orderId'),''),t.id) = ?)`;
    const source = "coalesce(nullif(json_extract(t.details,'$.contactNumber'),''),nullif(json_extract(t.details,'$.shippingDetails.contactNumber'),''),json_extract(t.details,'$.customerContact'),'')";
    const contact = [' ', '+', '(', ')', '.', '-'].reduce((sql, char) => `replace(${sql},'${char}','')`, source);
    const status = "coalesce(json_extract(t.details,'$.fulfillmentStatus'),CASE WHEN coalesce(json_extract(t.details,'$.status'),'paid') = 'paid' THEN 'pending' ELSE json_extract(t.details,'$.status') END)";
    const snapshotTree = (value: string) => `SELECT fullkey, CASE WHEN type IN ('integer','real') THEN 'number' ELSE type END, atom FROM json_tree(${value})`;
    const guard = (kind: string, condition: string, values: unknown[]) => db.prepare(
        `INSERT INTO _guest_order_guards(kind,ok) SELECT '${kind}', CASE WHEN ${condition} THEN 1 ELSE 0 END`
    ).bind(...values);
    const result = { orderId: input.orderId, version: input.expectedVersion + 1, ids: rows.map(row => row.id) };
    try {
        await db.batch([
            guard('scope', `EXISTS (SELECT 1 FROM guest_order_grants WHERE id = ? AND order_id = ?
                AND contact_hash = ? AND revoked = 0 AND expires_at > ?)`,
                [context.grantId, input.orderId, context.contactHash, Math.floor(Date.now() / 1000)]),
            guard('conflict', `NOT EXISTS (SELECT 1 FROM guest_order_receipts WHERE order_id = ? AND request_id = ?)
                AND coalesce((SELECT version FROM orders WHERE id = ?),0) = ?
                AND EXISTS (SELECT 1 FROM system_state WHERE singleton = 1 AND revision = ?)`,
            [input.orderId, input.requestId, input.orderId, input.expectedVersion, context.revision]),
            guard('scope', `(SELECT count(*) FROM transactions t WHERE ${active}) = ?
                AND NOT EXISTS (SELECT 1 FROM transactions t WHERE ${active} AND ${contact} <> ?)
                AND (SELECT count(*) FROM json_each(?) j JOIN transactions t ON t.id = json_extract(j.value,'$.id')
                    WHERE ${active}
                    AND t.type = json_extract(j.value,'$.expected.type')
                    AND t.category = json_extract(j.value,'$.expected.category')
                    AND t.amount = json_extract(j.value,'$.expected.amount')
                    AND t.date = json_extract(j.value,'$.expected.date')
                    AND t.description IS json_extract(j.value,'$.expected.description')
                    AND NOT EXISTS (${snapshotTree('t.details')} EXCEPT ${snapshotTree("json_extract(j.value,'$.expected.details')")})
                    AND NOT EXISTS (${snapshotTree("json_extract(j.value,'$.expected.details')")} EXCEPT ${snapshotTree('t.details')})) = ?`,
            [input.orderId, input.orderId, rows.length, input.orderId, input.orderId, context.contact,
                data, input.orderId, input.orderId, rows.length]),
            guard('pending', `NOT EXISTS (SELECT 1 FROM transactions t WHERE ${active} AND ${status} <> 'pending')`,
                [input.orderId, input.orderId]),
            db.prepare('INSERT INTO orders(id) VALUES (?) ON CONFLICT(id) DO NOTHING').bind(input.orderId),
            db.prepare(`UPDATE transactions SET
                amount = json_extract(j.value,'$.updates.amount'),
                category = json_extract(j.value,'$.updates.category'),
                details = json_extract(j.value,'$.updates.details'), order_id = ?
                FROM json_each(?) j WHERE transactions.id = json_extract(j.value,'$.id')`).bind(input.orderId, data),
            guard('updated', 'changes() = ?', [rows.length]),
            db.prepare('UPDATE orders SET version = version + 1 WHERE id = ? AND version = ?').bind(input.orderId, input.expectedVersion),
            guard('updated', 'changes() = 1', []),
            db.prepare(`INSERT INTO guest_order_events(order_id,request_id,action,details) VALUES (?,?,'guest.order.updated',?)`)
                .bind(input.orderId, input.requestId, JSON.stringify({ version: result.version, ids: result.ids })),
            guard('updated', 'changes() = 1', []),
            db.prepare(`INSERT INTO guest_order_receipts(order_id,request_id,contact_hash,payload_hash,response) VALUES (?,?,?,?,?)`)
                .bind(input.orderId, input.requestId, context.contactHash, context.payloadHash, JSON.stringify(result)),
            guard('updated', 'changes() = 1', []),
            db.prepare('DELETE FROM _guest_order_guards')
        ]);
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('guest_order_pending')) throw new HttpError(409, 'order_not_pending', 'This order is already being processed and can no longer be edited.');
        if (/guest_order_(scope|conflict|updated)/.test(message)) throw new HttpError(409, 'order_conflict', 'The order changed. Cancel editing to reload before retrying.');
        throw error;
    }
}
