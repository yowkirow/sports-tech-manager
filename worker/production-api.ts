import type { Member } from './auth.ts';
import type { AppEnv } from './env.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readJson } from './http.ts';
import { canonical } from './order-store.ts';
export { productionReadyGuard } from './production-ready.ts';

type Row = Record<string, unknown>;
type Source = {
    id: string; type: string; category: string; details: string | null;
    fingerprint: string; order_id: string;
};
type Shirt = { designName: string; brand: string; color: string; size: string; required: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const visible = "j.assignee_id = ? AND j.released_at IS NOT NULL AND j.status IN ('released','printing','awaiting_qa','problem','completed')";
const sourceQuery = `SELECT t.id,t.type,t.category,t.details,s.fingerprint,s.order_id
    FROM transactions t JOIN production_source_state s ON s.source_id=t.id`;

function fail(message: string, code = 'production_invalid', status = 400): never {
    throw new HttpError(status, code, message);
}
function text(value: unknown, label: string, max = 1000, empty = true): string {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
        || (!empty && !value.trim())) fail(`${label} is not valid.`);
    return value.trim();
}
function integer(value: unknown, label: string, max = 100000): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail(`${label} must be a whole number from 0 to ${max}.`);
    return value;
}
function fields(body: Row, required: string[], optional: string[] = []): void {
    if (required.some(key => !Object.hasOwn(body, key))
        || Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) fail('Unexpected or missing request fields.');
}
const removed = (value: unknown) => value === true || value === 'true' || value === 1;
function detailsOf(source: Source): Row {
    const value: unknown = JSON.parse(source.details || '{}');
    return isObject(value) ? value : {};
}
function shirt(source: Source, itemIndex: number): Shirt {
    const parent = detailsOf(source);
    if (source.type !== 'sale' || removed(parent.removedFromOrder) || parent.club === 'downtown-dinks') fail('Choose an active shirt sale.');
    const status = parent.fulfillmentStatus ?? (parent.status === 'paid' || !parent.status ? 'pending' : parent.status);
    if (!['pending', 'in_progress'].includes(String(status))) fail('Only pending or in-progress shirt orders can enter printing.');
    const nested = Array.isArray(parent.items);
    if ((nested && (itemIndex < 0 || itemIndex >= (parent.items as unknown[]).length)) || (!nested && itemIndex !== -1)) {
        fail('The source line changed. Reload the order.', 'production_conflict', 409);
    }
    const raw: unknown = nested ? (parent.items as unknown[])[itemIndex] : parent;
    if (!isObject(raw)) fail('This source line is not valid.');
    const item = isObject(raw.details) ? raw.details : raw;
    if (removed(item.removedFromOrder)) fail('Removed shirt lines cannot be printed.');
    const category = String(item.category || source.category || '').trim().toLowerCase();
    const size = String(item.size || 'N/A');
    if (!['shirts', 'blanks'].includes(category)
        && (!['', 'sale', 'sales', 'general'].includes(category) || size === 'N/A')) fail('Only shirts can enter printing.');
    const required = integer(Number(item.quantity ?? 1), 'Source quantity');
    if (!required) fail('A shirt job needs at least one shirt.');
    return {
        designName: text(item.itemName || item.name || 'Shirt', 'Design name', 200, false),
        brand: text(item.brand || parent.brand || 'Sypik', 'Brand', 100, false),
        color: text(item.linkedColor || item.color || parent.linkedColor || parent.color || '', 'Color', 100),
        size: text(size, 'Size', 80, false), required
    };
}
async function digest(value: string): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
        byte => byte.toString(16).padStart(2, '0')).join('');
}
const sourceToken = (source: Source, index: number) => digest(`${source.id}\n${index}\n${source.fingerprint}`);
function statement(db: D1Database, sql: string, values: unknown[] = []): D1PreparedStatement {
    return db.prepare(sql).bind(...values);
}
async function rows<T>(db: D1Database, sql: string, values: unknown[] = []): Promise<T[]> {
    return (await statement(db, sql, values).all<T>()).results;
}
const guard = (db: D1Database, kind: string, expression: string, values: unknown[] = []) =>
    statement(db, `INSERT INTO _production_guards(kind,ok) SELECT '${kind}',(${expression})`, values);

function actorGuard(db: D1Database, member: Member): D1PreparedStatement {
    return guard(db, 'forbidden', "EXISTS(SELECT 1 FROM members WHERE id=? AND role=? AND active=1)",
        [member.id, member.role]);
}
async function activeActor(db: D1Database, member: Member, owner = false): Promise<void> {
    if (!['owner', 'print_operator'].includes(member.role) || (owner && member.role !== 'owner')
        || !(await rows(db, 'SELECT id FROM members WHERE id=? AND role=? AND active=1', [member.id, member.role])).length) {
        fail('This action is not available for your account.', 'production_forbidden', 403);
    }
}
async function receipt(db: D1Database, member: Member, requestId: string, hash: string): Promise<unknown | undefined> {
    const [saved] = await rows<{ payload_hash: string; response: string }>(db,
        'SELECT payload_hash,response FROM production_request_receipts WHERE actor_id=? AND request_id=?', [member.id, requestId]);
    if (!saved) return undefined;
    if (saved.payload_hash !== hash) fail('This request ID was already used for another action.', 'production_receipt_conflict', 409);
    return JSON.parse(saved.response);
}
function errorText(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return `${error.message} ${error.cause && error.cause !== error ? errorText(error.cause) : ''}`;
}
async function mutation(
    db: D1Database, member: Member, requestId: string, hash: string,
    writes: D1PreparedStatement[], responseSQL: string, responseValues: unknown[],
    conflictMessage = 'The job or source changed. Reload before trying again; your input has not been discarded.'
): Promise<Response> {
    const batch = [
        actorGuard(db, member),
        guard(db, 'receipt', 'NOT EXISTS(SELECT 1 FROM production_request_receipts WHERE actor_id=? AND request_id=?)', [member.id, requestId]),
        ...writes,
        statement(db, `INSERT INTO production_request_receipts(actor_id,request_id,payload_hash,response)
            SELECT ?,?,?,(${responseSQL})`, [member.id, requestId, hash, ...responseValues]),
        guard(db, 'write', 'changes()=1'),
        statement(db, 'DELETE FROM _production_guards'),
        statement(db, 'SELECT response FROM production_request_receipts WHERE actor_id=? AND request_id=?', [member.id, requestId])
    ];
    try {
        const result = await db.batch<{ response: string }>(batch);
        const saved = result.at(-1)?.results[0]?.response;
        if (saved) return json(JSON.parse(saved));
        const recovered = await receipt(db, member, requestId, hash);
        if (recovered) return json(recovered);
        fail('Could not verify the save. Retry the same action.', 'production_unverified', 503);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        const message = errorText(error);
        if (message.includes('production_forbidden')) fail('Your access or assignment changed. Reload the queue.', 'production_forbidden', 403);
        if (message.includes('production_receipt') || message.includes('UNIQUE')) {
            await activeActor(db, member);
            const saved = await receipt(db, member, requestId, hash);
            if (saved) return json(saved);
        }
        if (/production_(conflict|write|counts|completed)|UNIQUE|CHECK constraint/.test(message)) {
            fail(conflictMessage, 'production_conflict', 409);
        }
        throw error;
    }
}
function jobResponse(owner: boolean): string {
    return owner
        ? `SELECT json_object('job',json(json_set(p.payload,'$.sourceId',j.source_id,'$.itemIndex',
            CASE WHEN j.item_index=-1 THEN NULL ELSE j.item_index END,'$.orderId',j.order_id,
            '$.sourceChanged',json(CASE WHEN j.source_changed=1 THEN 'true' ELSE 'false' END))))
            FROM production_job_public p JOIN production_jobs j ON j.id=p.id WHERE j.id=?`
        : "SELECT json_object('job',json(payload)) FROM production_job_public WHERE id=?";
}
// The member who certainly printed every shirt now awaiting QA: each `printed` event since the
// job's pending count was last zero has that same actor. Otherwise NULL, and nobody is credited.
// Must stay identical to the rule in the print_wallet_credits view (migration 0007).
const pendingPrinter = `(SELECT CASE WHEN count(*)>0 AND count(p.actor_id)=count(*) AND count(DISTINCT p.actor_id)=1
        THEN max(p.actor_id) END
    FROM production_events p WHERE p.job_id=production_jobs.id AND p.action='printed'
        AND p.id>coalesce((SELECT max(z.id) FROM production_events z WHERE z.job_id=production_jobs.id
            AND (SELECT sum(CASE y.action WHEN 'printed' THEN y.quantity WHEN 'qa' THEN -y.quantity ELSE 0 END)
                FROM production_events y WHERE y.job_id=z.job_id AND y.id<=z.id)=0),0))`;
function event(db: D1Database, member: Member, id: string, action: string, quantity = 0, accepted = 0, rejected = 0, note = ''): D1PreparedStatement {
    return statement(db, `INSERT INTO production_events(job_id,actor_id,actor_name,action,quantity,accepted,rejected,note,version,operator_id)
        SELECT id,?,CASE WHEN ?='owner' THEN 'Owner' ELSE coalesce(
            (SELECT nullif(trim(CASE WHEN json_type(profile,'$.full_name')='text'
                THEN json_extract(profile,'$.full_name') END),'') FROM member_profiles WHERE member_id=?),
            'Print operator') END,?,?,?,?,?,version,${action === 'qa' ? pendingPrinter : 'NULL'}
        FROM production_jobs WHERE id=?`, [member.id, member.role, member.id, action, quantity, accepted, rejected, note, id]);
}
async function getJobs(db: D1Database, member: Member, url: URL): Promise<Response> {
    const owner = member.role === 'owner';
    const order = url.searchParams.get('orderId');
    const offsetValue = url.searchParams.get('offset') || '0';
    if (!/^\d+$/.test(offsetValue) || !Number.isSafeInteger(Number(offsetValue))) fail('Invalid job page offset.');
    const offset = Number(offsetValue);
    const filter = owner ? (order ? 'j.order_id=?' : '1=1') : visible;
    const values = owner ? (order ? [order] : []) : [member.id];
    const result = await rows<{ payload: string }>(db, `SELECT ${owner
        ? `json_set(p.payload,'$.sourceId',j.source_id,'$.itemIndex',CASE WHEN j.item_index=-1 THEN NULL ELSE j.item_index END,
            '$.orderId',j.order_id,'$.sourceChanged',json(CASE WHEN j.source_changed=1 THEN 'true' ELSE 'false' END))`
        : 'p.payload'} AS payload
        FROM production_jobs j JOIN production_job_public p ON p.id=j.id
        WHERE ${filter} AND EXISTS(SELECT 1 FROM members WHERE id=? AND role=? AND active=1)
        ORDER BY CASE WHEN j.status IN ('completed','superseded') THEN 1 ELSE 0 END,j.updated_at DESC,j.id LIMIT 26 OFFSET ?`,
    [...values, member.id, member.role, offset]);
    return json({ jobs: result.slice(0, 25).map(row => JSON.parse(row.payload)), nextOffset: result.length > 25 ? offset + 25 : null });
}
async function getSources(db: D1Database, url: URL): Promise<Response> {
    const order = url.searchParams.get('orderId');
    const offsetValue = url.searchParams.get('offset') || '0';
    if (!/^\d+$/.test(offsetValue) || !Number.isSafeInteger(Number(offsetValue))) fail('Invalid source page offset.');
    const offset = Number(offsetValue);
    const result = await rows<Source>(db, `${sourceQuery} WHERE t.type='sale'
        AND coalesce(json_extract(t.details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND coalesce(json_extract(t.details,'$.club'),'')<>'downtown-dinks'
        AND coalesce(json_extract(t.details,'$.fulfillmentStatus'),
            CASE WHEN coalesce(json_extract(t.details,'$.status'),'paid')='paid' THEN 'pending' ELSE json_extract(t.details,'$.status') END)
            IN ('pending','in_progress') ${order ? 'AND s.order_id=?' : ''}
        ORDER BY t.created_at DESC,t.id LIMIT 11 OFFSET ?`, order ? [order, offset] : [offset]);
    const more = result.length > 10;
    const sources = [];
    for (const source of result.slice(0, 10)) {
        const details = detailsOf(source);
        const indices = Array.isArray(details.items) ? details.items.map((_, index) => index) : [-1];
        for (const itemIndex of indices) {
            try {
                const line = shirt(source, itemIndex);
                sources.push({ sourceId: source.id, itemIndex: itemIndex < 0 ? null : itemIndex,
                    orderId: source.order_id, ...line, sourceToken: await sourceToken(source, itemIndex) });
            } catch (error) { if (!(error instanceof HttpError)) throw error; }
        }
    }
    return json({ sources, nextOffset: more ? offset + 10 : null });
}
async function createJob(db: D1Database, member: Member, body: Row, requestId: string, hash: string): Promise<Response> {
    fields(body, ['sourceId', 'assigneeId', 'requestId', 'expectedSourceToken'], ['itemIndex', 'quantity', 'instructions']);
    if (typeof body.sourceId !== 'string' || !UUID.test(body.sourceId)) fail('Choose the source transaction UUID, not a display item ID.');
    const index = body.itemIndex === undefined || body.itemIndex === null ? -1 : integer(body.itemIndex, 'Item index', 10000);
    const assignee = text(body.assigneeId, 'Employee', 256, false);
    const instructions = text(body.instructions ?? '', 'Instructions', 2000);
    const [source] = await rows<Source>(db, `${sourceQuery} WHERE t.id=?`, [body.sourceId.toLowerCase()]);
    if (!source) fail('The source line no longer exists.', 'production_conflict', 409);
    const line = shirt(source, index);
    if (body.expectedSourceToken !== await sourceToken(source, index)) fail('The shirt line changed. Reload before preparing this job.', 'production_conflict', 409);
    if (body.quantity !== undefined && integer(body.quantity, 'Quantity') !== line.required) fail('Use the full source quantity. Split print jobs are not supported.');
    const id = crypto.randomUUID();
    const writes = [
        guard(db, 'forbidden', "EXISTS(SELECT 1 FROM members WHERE id=? AND role='print_operator' AND active=1)", [assignee]),
        guard(db, 'conflict', `EXISTS(SELECT 1 FROM transactions t JOIN production_source_state s ON s.source_id=t.id
            WHERE t.id=? AND t.details IS ? AND t.type=? AND t.category=? AND s.fingerprint=?)
            AND NOT EXISTS(SELECT 1 FROM production_jobs WHERE source_id=? AND item_index=? AND status<>'superseded')`,
        [source.id, source.details, source.type, source.category, source.fingerprint, source.id, index]),
        statement(db, `INSERT INTO production_jobs(id,job_code,source_id,item_index,legacy_item_key,order_id,source_fingerprint,
            snapshot_id,design_name,brand,color,size,required,instructions,assignee_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, `PJ-${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`, source.id, index,
            `${source.id}:${index}:${id}`, source.order_id, source.fingerprint, crypto.randomUUID(), line.designName,
            line.brand, line.color, line.size, line.required, instructions, assignee]),
        guard(db, 'write', 'changes()=1'),
        event(db, member, id, 'prepared')
    ];
    return mutation(db, member, requestId, hash, writes, jobResponse(true), [id]);
}
async function changeJob(db: D1Database, member: Member, id: string, action: string, body: Row, requestId: string, hash: string): Promise<Response> {
    const owner = member.role === 'owner';
    if (!owner && action !== 'progress') fail('Only the owner can release, hold or accept print jobs.', 'production_forbidden', 403);
    const version = integer(body.expectedVersion, 'Expected version', Number.MAX_SAFE_INTEGER - 1);
    const writes: D1PreparedStatement[] = [
        guard(db, 'forbidden', `EXISTS(SELECT 1 FROM production_jobs j WHERE j.id=? ${owner ? '' : `AND ${visible}`})`, owner ? [id] : [id, member.id]),
        guard(db, 'conflict', 'EXISTS(SELECT 1 FROM production_jobs WHERE id=? AND version=?)', [id, version])
    ];
    const note = text(body.note ?? '', 'Note', 1000);
    let set = '';
    let condition = '';
    let values: unknown[] = [];
    let eventAction = action;
    let qty = 0, accepted = 0, rejected = 0;
    if (action === 'release') {
        fields(body, ['expectedVersion', 'requestId', 'artworkReady', 'blanksReady'], ['assigneeId']);
        if (body.artworkReady !== true || body.blanksReady !== true) fail('Confirm artwork and blanks are ready before release.');
        const assignee = body.assigneeId === undefined ? null : text(body.assigneeId, 'Employee', 256, false);
        writes.push(guard(db, 'forbidden', `EXISTS(SELECT 1 FROM production_jobs j JOIN members m ON m.id=coalesce(?,j.assignee_id)
            WHERE j.id=? AND m.role='print_operator' AND m.active=1)`, [assignee, id]));
        set = `status=CASE WHEN accepted=required THEN 'completed' ELSE 'released' END,source_changed=0,
            assignee_id=coalesce(?,assignee_id),released_at=coalesce(released_at,${now})`;
        values = [assignee];
        condition = `status IN ('draft','held') AND EXISTS(SELECT 1 FROM production_source_state s JOIN transactions t ON t.id=s.source_id
            WHERE s.source_id=production_jobs.source_id AND s.fingerprint=production_jobs.source_fingerprint
            AND coalesce(json_extract(t.details,'$.fulfillmentStatus'),
                CASE WHEN coalesce(json_extract(t.details,'$.status'),'paid')='paid' THEN 'pending' ELSE json_extract(t.details,'$.status') END) IN ('pending','in_progress'))`;
    } else if (action === 'hold') {
        fields(body, ['expectedVersion', 'requestId', 'note']);
        if (!note) fail('Give the employee a reason for the hold.');
        set = "status='held'";
        condition = "status NOT IN ('held','superseded')";
    } else if (action === 'progress') {
        fields(body, ['expectedVersion', 'requestId', 'action'], ['quantity', 'note']);
        const progress = text(body.action, 'Action', 20, false);
        eventAction = progress;
        condition = "status IN ('released','printing','awaiting_qa','problem') AND source_changed=0 AND released_at IS NOT NULL";
        if (progress === 'printed') {
            qty = integer(body.quantity, 'Printed quantity');
            if (!qty) fail('Enter at least one printed shirt.');
            condition += ' AND ?<=required-accepted-pending';
            set = "pending=pending+?,rework=max(0,rework-?),status='awaiting_qa'";
            values = [qty, qty];
        } else if (progress === 'start') {
            if (body.quantity !== undefined) fail('Printing status does not record a quantity.');
            set = "status='printing'";
            condition += " AND status<>'printing' AND required>accepted+pending";
        } else if (progress === 'problem') {
            if (body.quantity !== undefined) fail('Problem status does not record a quantity.');
            if (!note) fail('Describe the printing problem.');
            set = "status='problem'";
        } else fail('Choose Printing, Printed or Problem.');
    } else if (action === 'qa') {
        fields(body, ['expectedVersion', 'requestId', 'accepted', 'rejected'], ['note']);
        accepted = integer(body.accepted, 'Accepted quantity');
        rejected = integer(body.rejected, 'Rejected quantity');
        qty = accepted + rejected;
        if (!qty) fail('Enter a quantity to accept or send back for rework.');
        if (rejected && !note) fail('Describe what needs rework.');
        set = `pending=pending-?,accepted=accepted+?,rejected=rejected+?,rework=rework+?,
            status=CASE WHEN accepted+?=required THEN 'completed'
                WHEN status IN ('held','problem') THEN status
                WHEN pending-?>0 THEN 'awaiting_qa' ELSE 'released' END`;
        values = [qty, accepted, rejected, rejected, accepted, qty];
        condition = "released_at IS NOT NULL AND source_changed=0 AND status NOT IN ('draft','completed','superseded') AND pending>=?";
    } else fail('This print action does not exist.', 'not_found', 404);
    writes.push(statement(db, `UPDATE production_jobs SET ${set},version=version+1,updated_at=${now}
        WHERE id=? AND version=? AND (${condition})`,
    [...values, id, version, ...(action === 'qa' || (action === 'progress' && eventAction === 'printed') ? [qty] : [])]));
    writes.push(guard(db, 'conflict', 'changes()=1'));
    if (action === 'release') {
        // The source trigger ignores these fulfillment-only changes, avoiding a
        // self-hold. Every active order row changes so guest pending guards close.
        writes.push(statement(db, `INSERT INTO orders(id) SELECT order_id FROM production_jobs WHERE id=?
            ON CONFLICT(id) DO NOTHING`, [id]));
        writes.push(statement(db, `UPDATE transactions SET details=json_set(coalesce(details,'{}'),'$.fulfillmentStatus','in_progress')
            WHERE type='sale' AND coalesce(nullif(json_extract(details,'$.orderId'),''),id)=(SELECT order_id FROM production_jobs WHERE id=?)
            AND coalesce(json_extract(details,'$.removedFromOrder'),0) NOT IN (1,'true')`, [id]));
        writes.push(statement(db, `UPDATE orders SET version=version+1 WHERE id=(SELECT order_id FROM production_jobs WHERE id=?)`, [id]));
        writes.push(guard(db, 'write', 'changes()=1'));
    }
    writes.push(event(db, member, id, eventAction, qty, accepted, rejected, note));
    writes.push(guard(db, 'write', 'changes()=1'));
    return mutation(db, member, requestId, hash, writes, jobResponse(owner), [id]);
}

async function reviseJob(db: D1Database, member: Member, id: string, body: Row, requestId: string, hash: string): Promise<Response> {
    fields(body, ['expectedVersion', 'requestId', 'confirmed', 'note'], ['itemIndex', 'expectedSourceToken', 'assigneeId', 'instructions', 'retireOnly']);
    if (member.role !== 'owner' || body.confirmed !== true) fail('The owner must confirm the revised job.', 'production_forbidden', 403);
    const version = integer(body.expectedVersion, 'Expected version', Number.MAX_SAFE_INTEGER - 1);
    const note = text(body.note, 'Revision reason', 1000, false);
    const [previous] = await rows<{ source_id: string; item_index: number; assignee_id: string }>(db,
        "SELECT source_id,item_index,assignee_id FROM production_jobs WHERE id=? AND version=? AND status='held'",
        [id, version]);
    if (!previous) fail('Hold and review the current job before revising it.', 'production_conflict', 409);
    const writes = [
        guard(db, 'conflict', "EXISTS(SELECT 1 FROM production_jobs WHERE id=? AND version=? AND status='held')", [id, version]),
        statement(db, `UPDATE production_jobs SET status='superseded',version=version+1,updated_at=${now} WHERE id=? AND version=?`, [id, version]),
        guard(db, 'write', 'changes()=1'),
        event(db, member, id, 'superseded', 0, 0, 0, note)
    ];
    if (body.retireOnly === true) {
        return mutation(db, member, requestId, hash, writes, jobResponse(true), [id]);
    }
    if (body.retireOnly !== undefined && body.retireOnly !== false) fail('Retire-only must be boolean.');
    const index = body.itemIndex === null ? -1 : body.itemIndex === undefined ? previous.item_index : integer(body.itemIndex, 'Item index', 10000);
    const assignee = body.assigneeId === undefined ? previous.assignee_id : text(body.assigneeId, 'Employee', 256, false);
    const [source] = await rows<Source>(db, `${sourceQuery} WHERE t.id=?`, [previous.source_id]);
    if (!source) fail('The source was removed. Retire this job instead.', 'production_conflict', 409);
    const line = shirt(source, index);
    if (body.expectedSourceToken !== await sourceToken(source, index)) fail('The revised source changed. Reload before confirming.', 'production_conflict', 409);
    const replacementId = crypto.randomUUID();
    writes.push(
        guard(db, 'forbidden', "EXISTS(SELECT 1 FROM members WHERE id=? AND role='print_operator' AND active=1)", [assignee]),
        guard(db, 'conflict', `EXISTS(SELECT 1 FROM transactions t JOIN production_source_state s ON t.id=s.source_id
            WHERE t.id=? AND t.details IS ? AND s.fingerprint=?)
            AND NOT EXISTS(SELECT 1 FROM production_jobs WHERE source_id=? AND item_index=? AND status<>'superseded')`,
        [source.id, source.details, source.fingerprint, source.id, index]),
        statement(db, `INSERT INTO production_jobs(id,job_code,source_id,item_index,legacy_item_key,order_id,source_fingerprint,
            snapshot_id,design_name,brand,color,size,required,instructions,assignee_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            replacementId, `PJ-${replacementId.replaceAll('-', '').slice(0, 10).toUpperCase()}`, source.id, index,
            `${source.id}:${index}:${replacementId}`, source.order_id, source.fingerprint, crypto.randomUUID(),
            line.designName, line.brand, line.color, line.size, line.required,
            text(body.instructions ?? '', 'Instructions', 2000), assignee
        ]),
        guard(db, 'write', 'changes()=1'),
        statement(db, 'UPDATE production_jobs SET superseded_by=? WHERE id=?', [replacementId, id]),
        event(db, member, replacementId, 'revised', 0, 0, 0, note)
    );
    return mutation(db, member, requestId, hash, writes, jobResponse(true), [replacementId]);
}
async function changeMember(db: D1Database, member: Member, id: string | undefined, body: Row, requestId: string, hash: string): Promise<Response> {
    const writes: D1PreparedStatement[] = [];
    if (!id) {
        fields(body, ['email', 'role', 'requestId'], ['name']);
        if (body.role !== 'print_operator') fail('Only individual print-operator accounts can be prepared here.');
        const email = text(body.email, 'Email', 254, false).toLowerCase();
        if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)
            || email.includes('..') || email.startsWith('.') || email.split('@')[0]?.endsWith('.')) fail('Enter one valid individual email address.');
        if (email === member.email.toLowerCase()) fail('You cannot change your own account here.');
        const name = text(body.name || 'Print operator', 'Employee name', 80, false);
        id = crypto.randomUUID();
        writes.push(guard(db, 'conflict', 'NOT EXISTS(SELECT 1 FROM members WHERE lower(email)=?)', [email]));
        writes.push(statement(db, "INSERT INTO members(id,email,role,active) VALUES (?,?,'print_operator',1)", [id, email]));
        writes.push(guard(db, 'write', 'changes()=1'));
        writes.push(statement(db, "INSERT INTO member_profiles(member_id,profile) VALUES (?,json_object('full_name',?))", [id, name]));
    } else {
        fields(body, ['active', 'requestId']);
        if (typeof body.active !== 'boolean') fail('Active must be true or false.');
        if (id === member.id) fail('You cannot change your own account here.');
        writes.push(guard(db, 'forbidden', "EXISTS(SELECT 1 FROM members WHERE id=? AND role='print_operator')", [id]));
        writes.push(statement(db, "UPDATE members SET active=? WHERE id=? AND role='print_operator'", [body.active ? 1 : 0, id]));
        writes.push(guard(db, 'write', 'changes()=1'));
    }
    return mutation(db, member, requestId, hash, writes,
        `SELECT json_object('member',json_object('id',m.id,'email',m.email,'role',m.role,'active',json(CASE WHEN m.active=1 THEN 'true' ELSE 'false' END),
        'name',coalesce(nullif(trim(CASE WHEN json_type(p.profile,'$.full_name')='text'
            THEN json_extract(p.profile,'$.full_name') END),''),'Print operator')),
        'accessNotice','Login also requires this email to be allowed in the Cloudflare Access policy.')
        FROM members m LEFT JOIN member_profiles p ON p.member_id=m.id WHERE m.id=?`, [id]);
}

// Print wallet pay rule (owner decision, 2026-10-06): PHP 1,000 for every COMPLETE 30 shirts the
// owner accepts in QA. Partial batches are a progress count, never fractional pay. Money is
// integer centavos. Credits come only from print_wallet_credits (migration 0007), which credits
// the certain printer and leaves mixed or unknown printers unattributed.
export const PRINT_RATE_SHIRTS = 30;
export const PRINT_RATE_CENTAVOS = 100_000;
const PRINT_PAYOUT_MAX_CENTAVOS = 100_000_000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const peso = (centavos: number) => `₱${(centavos / 100).toLocaleString('en-PH')}`;
const creditedShirts = '(SELECT coalesce(sum(shirts),0) FROM print_wallet_credits WHERE operator_id=?)';
const paidCentavos = '(SELECT coalesce(sum(amount_centavos),0) FROM print_payouts WHERE operator_id=?)';
const unattributed = `FROM print_wallet_credits c WHERE c.operator_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM members m WHERE m.id=c.operator_id AND m.role='print_operator')`;
type Operator = { id: string; name: string };
type WalletEntry = { type: 'credit'; shirts: number; jobCode: string; at: string }
    | { type: 'payout'; amountCentavos: number; note: string; at: string };

/** Monday 00:00 in Asia/Manila (UTC+8, no daylight saving) as an ISO instant comparable with created_at. */
export function manilaWeekStart(now = new Date()): string {
    const local = new Date(now.getTime() + MANILA_OFFSET_MS);
    const daysSinceMonday = (local.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday)
        - MANILA_OFFSET_MS).toISOString();
}
function operators(db: D1Database, id?: string): Promise<Operator[]> {
    return rows<Operator>(db, `SELECT m.id,coalesce(nullif(trim(CASE WHEN json_type(p.profile,'$.full_name')='text'
            THEN json_extract(p.profile,'$.full_name') END),''),'Print operator') AS name
        FROM members m LEFT JOIN member_profiles p ON p.member_id=m.id
        WHERE m.role='print_operator' ${id === undefined ? '' : 'AND m.id=?'}
        ORDER BY m.active DESC,name COLLATE NOCASE,m.id`, id === undefined ? [] : [id]);
}
// Allowlisted: counts, the employee's own pay and job codes they already see. No customer,
// order, price or other-employee data is selected.
async function walletOf(db: D1Database, operator: Operator, weekStart: string) {
    const [totals] = await rows<{ accepted: number; week: number; awaiting: number; paid: number }>(db, `SELECT
        ${creditedShirts} AS accepted,
        (SELECT coalesce(sum(shirts),0) FROM print_wallet_credits WHERE operator_id=? AND created_at>=?) AS week,
        (SELECT coalesce(sum(j.pending),0) FROM production_jobs j WHERE ${visible}) AS awaiting,
        ${paidCentavos} AS paid`, [operator.id, operator.id, weekStart, operator.id, operator.id]);
    const credits = await rows<{ shirts: number; job_code: string; created_at: string }>(db,
        'SELECT shirts,job_code,created_at FROM print_wallet_credits WHERE operator_id=? ORDER BY event_id DESC LIMIT 20', [operator.id]);
    const payouts = await rows<{ amount_centavos: number; note: string; created_at: string }>(db,
        'SELECT amount_centavos,note,created_at FROM print_payouts WHERE operator_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20', [operator.id]);
    const accepted = Number(totals?.accepted ?? 0);
    const progress = accepted % PRINT_RATE_SHIRTS;
    const earned = Math.floor(accepted / PRINT_RATE_SHIRTS) * PRINT_RATE_CENTAVOS;
    const paid = Number(totals?.paid ?? 0);
    const recent: WalletEntry[] = [
        ...credits.map(row => ({ type: 'credit' as const, shirts: row.shirts, jobCode: row.job_code, at: row.created_at })),
        ...payouts.map(row => ({ type: 'payout' as const, amountCentavos: row.amount_centavos, note: row.note, at: row.created_at }))
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
    return {
        memberId: operator.id, name: operator.name,
        rateShirts: PRINT_RATE_SHIRTS, rateCentavos: PRINT_RATE_CENTAVOS,
        acceptedShirts: accepted, shirtsThisWeek: Number(totals?.week ?? 0), awaitingQA: Number(totals?.awaiting ?? 0),
        progress, nextPayoutIn: PRINT_RATE_SHIRTS - progress,
        earnedCentavos: earned, paidCentavos: paid, balanceCentavos: earned - paid, recent
    };
}
async function getWallet(db: D1Database, member: Member, url: URL): Promise<Response> {
    const requested = url.searchParams.get('memberId');
    const weekStart = manilaWeekStart();
    if (member.role !== 'owner') {
        if (requested !== null && requested !== member.id) fail('You can only see your own shirt count.', 'production_forbidden', 403);
        const [self] = await operators(db, member.id);
        if (!self) fail('This action is not available for your account.', 'production_forbidden', 403);
        return json({ wallet: await walletOf(db, self, weekStart) });
    }
    if (requested !== null) {
        const [operator] = await operators(db, requested);
        if (!operator) fail('No print-operator account matches this ID.', 'not_found', 404);
        return json({ wallet: await walletOf(db, operator, weekStart) });
    }
    const wallets = [];
    for (const operator of await operators(db)) wallets.push(await walletOf(db, operator, weekStart));
    const [total] = await rows<{ shirts: number }>(db, `SELECT coalesce(sum(c.shirts),0) AS shirts ${unattributed}`);
    const recent = await rows<{ shirts: number; job_code: string; created_at: string }>(db,
        `SELECT c.shirts,c.job_code,c.created_at ${unattributed} ORDER BY c.event_id DESC LIMIT 20`);
    return json({ wallets, unattributed: { shirts: Number(total?.shirts ?? 0),
        recent: recent.map(row => ({ shirts: row.shirts, jobCode: row.job_code, at: row.created_at })) } });
}
async function recordPayout(db: D1Database, member: Member, body: Row, requestId: string, hash: string): Promise<Response> {
    fields(body, ['operatorId', 'amountCentavos', 'requestId'], ['note']);
    const operatorId = text(body.operatorId, 'Employee', 256, false);
    const amount = integer(body.amountCentavos, 'Payout amount', PRINT_PAYOUT_MAX_CENTAVOS);
    if (!amount || amount % PRINT_RATE_CENTAVOS) fail(`Record payouts in whole ${peso(PRINT_RATE_CENTAVOS)} steps.`);
    const note = text(body.note ?? '', 'Payout note', 200);
    const [operator] = await operators(db, operatorId);
    if (!operator) fail('Payouts can only be recorded for a print-operator account.');
    let saved = await receipt(db, member, requestId, hash);
    if (!saved) {
        const id = crypto.randomUUID();
        // The balance check lives inside the atomic batch, so concurrent payouts cannot overdraw.
        const writes = [
            guard(db, 'forbidden', "EXISTS(SELECT 1 FROM members WHERE id=? AND role='print_operator')", [operator.id]),
            guard(db, 'conflict', `${creditedShirts}/${PRINT_RATE_SHIRTS}*${PRINT_RATE_CENTAVOS}-${paidCentavos}>=?`,
                [operator.id, operator.id, amount]),
            statement(db, 'INSERT INTO print_payouts(id,operator_id,amount_centavos,note,created_by) VALUES (?,?,?,?,?)',
                [id, operator.id, amount, note, member.id]),
            guard(db, 'write', 'changes()=1')
        ];
        saved = await (await mutation(db, member, requestId, hash, writes,
            `SELECT json_object('payout',json_object('id',id,'operatorId',operator_id,'amountCentavos',amount_centavos,
                'note',note,'createdAt',created_at)) FROM print_payouts WHERE id=?`, [id],
            'This payout is more than the balance due, or the balance just changed. Nothing was recorded; reload the wallet.')).json();
    }
    return json({ ...(saved as Row), wallet: await walletOf(db, operator, manilaWeekStart()) });
}

export async function handleProductionRequest(request: Request, env: AppEnv, member: Member): Promise<Response | null> {
    const url = new URL(request.url);
    const memberPath = /^\/api\/members(?:\/([^/]+))?$/.exec(url.pathname);
    const memberMutation = memberPath && ((request.method === 'POST' && !memberPath[1]) || (request.method === 'PATCH' && memberPath[1]));
    if (!url.pathname.startsWith('/api/production/') && !memberMutation) return null;
    if (env.PRINT_QUEUE_ENABLED !== 'true') fail('Print production is not enabled.', 'not_found', 404);
    const ownerOnly = !!memberMutation || url.pathname === '/api/production/sources' || request.method === 'POST' && !url.pathname.endsWith('/progress');
    await activeActor(env.DB, member, ownerOnly);
    if (request.method === 'GET') {
        if (url.pathname === '/api/production/jobs') return getJobs(env.DB, member, url);
        if (url.pathname === '/api/production/sources') return getSources(env.DB, url);
        if (url.pathname === '/api/production/wallet') return getWallet(env.DB, member, url);
    }
    if (request.method !== 'POST' && !memberMutation) fail('This print route does not exist.', 'not_found', 404);
    const input = await readJson(request, 16384);
    if (!isObject(input)) fail('Send an object.');
    const requestId = text(input.requestId, 'Request ID', 128, false);
    const hash = await digest(`${request.method}\n${url.pathname}\n${canonical(input)}`);
    // Owner-only (ownerOnly above). Replays attach a fresh wallet summary to the saved receipt.
    if (url.pathname === '/api/production/payouts') return recordPayout(env.DB, member, input, requestId, hash);
    // Replaying a receipt still requires current assignment and visibility.
    const match = /^\/api\/production\/jobs\/([^/]+)\/(release|progress|qa|hold|revise)$/.exec(url.pathname);
    if (match && member.role !== 'owner') {
        if (!(await rows(env.DB, `SELECT id FROM production_jobs j WHERE j.id=? AND ${visible}`, [match[1], member.id])).length) {
            fail('This job is no longer assigned or released to you.', 'production_forbidden', 403);
        }
    }
    const saved = await receipt(env.DB, member, requestId, hash);
    if (saved) return json(saved);
    if (memberMutation) return changeMember(env.DB, member, memberPath?.[1], input, requestId, hash);
    if (url.pathname === '/api/production/jobs') return createJob(env.DB, member, input, requestId, hash);
    if (match?.[2] === 'revise') return reviseJob(env.DB, member, match[1]!, input, requestId, hash);
    if (match) return changeJob(env.DB, member, match[1]!, match[2]!, input, requestId, hash);
    fail('This print route does not exist.', 'not_found', 404);
}
