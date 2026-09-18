import type { AppEnv } from './env.ts';
import { HttpError } from './errors.ts';
import { isObject, json, readJson } from './http.ts';
import { findMember, verifyAccessIdentity } from './auth.ts';
import { saveGuestOrder } from './public-order-store.ts';
import { canonical } from './order-store.ts';
import { buildPublicCatalog } from '../src/lib/publicCatalog.js';
import { getStockKey } from '../src/lib/inventory.js';
import { createOrderId, groupOrders } from '../src/lib/orderItems.js';
import { getCartUnitPrice, priceOrder } from '../src/lib/orderPricing.js';
import { buildOrderChanges } from '../src/lib/orderEditingPure.js';

type RecordData = Record<string, any>;
type Transaction = RecordData & { id: string; type: string; category: string; amount: string; date: string; details: RecordData };
type Catalog = { products: RecordData[]; brands: RecordData[]; stock: Record<string, number>; vouchers: RecordData[] };
type ReceiptRow = { id: string; object_key: string; content_type: string; byte_size: number; order_id: string | null; capability_hash: string; expires_at: number };
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const nowSeconds = () => Math.floor(Date.now() / 1000);
function failure(message: string): never { throw new HttpError(400, 'invalid_input', message); }

function fields(value: unknown, allowed: string[]): asserts value is RecordData {
    if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) failure('This request contains unsupported fields.');
}
function text(value: unknown, name: string, max: number, required = true): string {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) failure(`Enter a valid ${name}.`);
    const result = value.trim();
    if (required && !result) failure(`Enter a ${name}.`);
    return result;
}
export function normalizeContact(value: unknown): string {
    const contact = text(value, 'contact number', 40);
    if (!/^[+\d ().-]+$/.test(contact)) failure('Enter a full contact number.');
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) failure('Enter a full contact number (7–15 digits).');
    return digits;
}
function requestId(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) failure('A valid request ID is required.');
    return value.toLowerCase();
}
function orderKey(value: unknown): string {
    const key = text(value, 'order ID', 256);
    if (UUID.test(key)) return key.toLowerCase();
    if (!/^ST-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(key)) failure('Enter a valid order ID.');
    return key;
}
function quantity(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 10000) failure('Item quantity must be a whole number from 1 to 10,000.');
    return value;
}
async function digest(value: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function signingKey(env: AppEnv) {
    if (!env.GUEST_TOKEN_SECRET || env.GUEST_TOKEN_SECRET.length < 32) {
        throw new HttpError(503, 'guest_not_configured', 'Guest checkout is temporarily unavailable.');
    }
    return crypto.subtle.importKey('raw', encoder.encode(env.GUEST_TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function base64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}
async function sign(env: AppEnv, claims: RecordData, lifetime = 1800): Promise<string> {
    const payload = base64(encoder.encode(JSON.stringify({ ...claims, exp: nowSeconds() + lifetime, nonce: claims.nonce ?? crypto.randomUUID() })));
    const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
    return `${payload}.${base64(new Uint8Array(signature))}`;
}
async function verify(env: AppEnv, token: unknown, purpose: string): Promise<RecordData> {
    if (typeof token !== 'string' || token.length > 4096 || !/^[\w-]+\.[\w-]+$/.test(token)) {
        throw new HttpError(401, 'verification_required', 'Verify your contact number again.');
    }
    const [payload = '', signature = ''] = token.split('.');
    const key = await signingKey(env);
    try {
        if (!await crypto.subtle.verify('HMAC', key, unbase64(signature), encoder.encode(payload))) throw new Error('signature');
        const claims: unknown = JSON.parse(new TextDecoder().decode(unbase64(payload)));
        if (!isObject(claims) || claims.purpose !== purpose || typeof claims.exp !== 'number' || claims.exp <= nowSeconds()) throw new Error('claims');
        return claims;
    } catch {
        throw new HttpError(401, 'verification_required', 'Verify your contact number again.');
    }
}
async function privateKey(env: AppEnv, value: string): Promise<string> {
    return base64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(value))));
}

async function rateLimit(request: Request, env: AppEnv, scope: string, limit: number, subject?: string): Promise<Response | null> {
    const now = nowSeconds();
    const window = 600;
    const start = now - now % window;
    const key = await privateKey(env, `rate:${scope}:${subject ?? request.headers.get('CF-Connecting-IP') ?? 'local'}`);
    const result = await env.DB.batch([
        env.DB.prepare('DELETE FROM rate_limit_state WHERE expires_at < ?').bind(now),
        env.DB.prepare(`INSERT INTO rate_limit_state(key,window_start,count,expires_at) VALUES (?,?,1,?)
            ON CONFLICT(key) DO UPDATE SET
                count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
                window_start = excluded.window_start, expires_at = excluded.expires_at
            WHERE window_start <> excluded.window_start OR count < ?
            RETURNING count`).bind(key, start, start + window, limit)
    ]);
    if (result[1]?.results.length) return null;
    const response = json({ error: { code: 'rate_limited', message: 'Too many attempts. Please wait before trying again.' } }, 429);
    response.headers.set('Retry-After', String(start + window - now));
    return response;
}

function decodeRows(rows: unknown[]): Transaction[] {
    return (rows as RecordData[]).map(row => ({ ...row, details: row.details === null ? null : JSON.parse(row.details) })) as Transaction[];
}
function decodeCatalogRows(rows: unknown[]): RecordData[] {
    return (rows as RecordData[]).map(row => {
        const details = row.details === null ? null : JSON.parse(row.details);
        if (details && (typeof row.movement_quantity === 'number' || typeof row.movements === 'string')) {
            const movements: [string, unknown][] = row.movements ? JSON.parse(row.movements) : [];
            details.quantity = row.movement_quantity ?? movements.reduce<number>((sum, [type, value]) => {
                const parsed = value === null || value === undefined || value === '' ? 1 : Number(value);
                const quantity = Number.isFinite(parsed) ? parsed : 1;
                return sum + (type === 'sale' ? -quantity : quantity);
            }, 0);
            // SQL already resolves each flat sale's stock descriptor. Treat its
            // signed quantity as a movement instead of repeating sale normalization.
            return { id: row.id, type: 'update_stock', category: row.category, details };
        }
        return { id: row.id, type: row.type, category: row.category, amount: row.amount, description: row.description, details };
    });
}
const stockFields = "'club','removedFromOrder','category','name','itemName','subCategory','brand','size','color','linkedColor','quantity'";
const trimWhitespace = 'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)';
const stockCategorySQL = (prefix = '') =>
    `lower(trim(coalesce(nullif(json_extract(${prefix}details,'$.category'),''),${prefix}category,''),${trimWhitespace}))`;
const scalarJSON = (alias: string) => `CASE WHEN ${alias}.type IN ('object','array') THEN json(${alias}.value) ELSE ${alias}.value END`;
const nestedStockItems = `(SELECT json_group_array(json((
    SELECT json_group_object(sku.key, ${scalarJSON('sku')})
    FROM json_each(CASE WHEN json_type(line.value,'$.details') = 'object'
        THEN json_extract(line.value,'$.details') ELSE line.value END) sku
    WHERE sku.key IN (${stockFields})
))) FROM json_each(t.details,'$.items') line)`;
const stockDetails = `(SELECT json_group_object(field.key,
    CASE WHEN field.key = 'items' AND field.type = 'array' THEN json(${nestedStockItems})
        ELSE ${scalarJSON('field')} END)
    FROM json_each(t.details) field
    WHERE field.key IN (${stockFields},'items')
        AND NOT (field.key IN ('name','itemName','subCategory')
            AND ${stockCategorySQL('t.')} IN ('shirts','blanks')))`;
// Materialize the projection stages: inlining the grouped JSON expressions can
// exceed D1's planner-memory budget even for a modest transaction history.
const catalogSnapshotSQL = `/* public_catalog_snapshot */
    WITH history AS (
        SELECT t.*,row_number() OVER (ORDER BY date DESC,created_at DESC,id DESC) AS position FROM transactions t
    ), definitions AS (
        SELECT t.*,
            row_number() OVER (
                PARTITION BY CASE WHEN type IN ('define_product','delete_product') THEN 'product' ELSE 'brand' END,
                    lower(trim(json_extract(details,'$.name')))
                ORDER BY position
            ) AS latest,
            min(CASE WHEN type IN ('delete_product','delete_brand') THEN position END) OVER (
                PARTITION BY CASE WHEN type IN ('define_product','delete_product') THEN 'product' ELSE 'brand' END,
                    lower(trim(json_extract(details,'$.name')))
            ) AS last_deleted
        FROM history t WHERE type IN ('define_product','delete_product','define_brand','delete_brand')
    ), first_positions AS (
        SELECT CASE WHEN type='define_product' THEN 'product' ELSE 'brand' END AS kind,
            lower(trim(json_extract(details,'$.name'))) AS name,max(position) AS first_position
        FROM definitions WHERE type IN ('define_product','define_brand') AND (last_deleted IS NULL OR position<last_deleted)
        GROUP BY kind,name
    ), relevant AS (
        SELECT d.id,d.type,d.category,d.date,d.created_at,d.description,d.details,coalesce(p.first_position,d.position) AS position
        FROM definitions d LEFT JOIN first_positions p ON p.name=lower(trim(json_extract(d.details,'$.name')))
            AND p.kind=CASE WHEN d.type IN ('define_product','delete_product') THEN 'product' ELSE 'brand' END
        WHERE d.latest=1 AND d.type<>'delete_product'
        UNION ALL
        SELECT id,type,category,date,created_at,description,details,position FROM history
        WHERE type IN ('expense','update_stock','sale','voucher')
            AND (type NOT IN ('expense','update_stock') OR (
                coalesce(json_extract(details,'$.club'),0) IN (0,'')
                AND ${stockCategorySQL()} NOT IN ('general','ads','club','system')
            ))
            AND (type<>'sale' OR (
                coalesce(json_extract(details,'$.removedFromOrder'),0) IN (0,'')
                AND coalesce(json_extract(details,'$.club'),'')<>'downtown-dinks'
            ))
    ), projected AS MATERIALIZED (
        SELECT id,type,category,'0' AS amount,date,created_at,position,
            CASE WHEN type='sale' AND lower(trim(category)) NOT IN ('shirts','blanks')
                AND coalesce(json_extract(details,'$.itemName'),json_extract(details,'$.name'),'')=''
                THEN description ELSE NULL END AS description,
            CASE WHEN details IS NULL THEN NULL
                WHEN type IN ('define_product','delete_product','define_brand','delete_brand','voucher') THEN details
                ELSE ${stockDetails} END AS details
        FROM relevant t
    ), normalized_stock AS MATERIALIZED (
        SELECT *,
            CASE WHEN type='sale' THEN
                CASE WHEN ${stockCategorySQL()} IN ('shirts','blanks') THEN 'shirts'
                    WHEN ${stockCategorySQL()} IN ('','sale','sales','general') THEN
                        CASE WHEN coalesce(json_extract(details,'$.size'),'') NOT IN ('','N/A') THEN 'shirts' ELSE 'accessories' END
                    ELSE ${stockCategorySQL()} END
                ELSE ${stockCategorySQL()} END AS stock_category
        FROM projected WHERE type IN ('expense','update_stock','sale') AND details IS NOT NULL
            AND coalesce(json_type(details,'$.items'),'')<>'array'
    ), stock_descriptors AS MATERIALIZED (
        SELECT id,type,category,date,created_at,position,
            json_object(
                'category',CASE WHEN stock_category IN ('shirts','blanks') THEN 'shirts' ELSE stock_category END,
                'brand',CASE WHEN stock_category IN ('shirts','blanks') THEN
                    lower(coalesce(nullif(json_extract(details,'$.brand'),''),'Sypik')) END,
                'linkedColor',CASE WHEN stock_category IN ('shirts','blanks') THEN
                    lower(coalesce(nullif(json_extract(details,'$.linkedColor'),''),json_extract(details,'$.color'),'')) END,
                'size',CASE WHEN stock_category IN ('shirts','blanks') THEN
                    lower(coalesce(nullif(json_extract(details,'$.size'),''),CASE WHEN type='sale' THEN 'N/A' ELSE '' END)) END,
                'subCategory',CASE WHEN stock_category NOT IN ('shirts','blanks') THEN
                    lower(coalesce(nullif(json_extract(details,'$.subCategory'),''),
                        nullif(json_extract(details,'$.itemName'),''),
                        nullif(json_extract(details,'$.name'),''),
                        CASE WHEN type='sale' THEN coalesce(nullif(description,''),'Unknown Item') ELSE '' END)) END
            ) AS descriptor,
            json_quote(json_extract(details,'$.quantity')) AS quantity_json,
            CASE WHEN json_extract(details,'$.quantity') IS NULL OR json_extract(details,'$.quantity')='' THEN 1
                WHEN json_type(details,'$.quantity') IN ('integer','true','false') THEN json_extract(details,'$.quantity')
                WHEN json_type(details,'$.quantity')='text' AND json_valid(json_extract(details,'$.quantity')) THEN
                    CASE WHEN json_type(json_extract(details,'$.quantity'))='integer'
                        THEN CAST(json_extract(details,'$.quantity') AS INTEGER) END
            END AS integer_quantity
        FROM normalized_stock
    ), compact AS (
        SELECT id,type,category,amount,date,created_at,description,details,position,
            NULL AS movement_quantity,NULL AS movements
        FROM projected
        WHERE type NOT IN ('expense','update_stock','sale') OR json_type(details,'$.items')='array'
        UNION ALL
        SELECT min(id),'update_stock','stock','0',max(date),max(created_at),NULL,descriptor,min(position),
            CASE WHEN count(integer_quantity)=count(*) AND total(abs(CAST(integer_quantity AS REAL)))<=9007199254740991
                THEN total(CASE WHEN type='sale' THEN -CAST(integer_quantity AS REAL) ELSE integer_quantity END) END,
            CASE WHEN count(integer_quantity)=count(*) AND total(abs(CAST(integer_quantity AS REAL)))<=9007199254740991
                THEN NULL ELSE json_group_array(json_array(type,json(quantity_json))) END
        FROM stock_descriptors GROUP BY descriptor
    ) SELECT id,type,category,amount,description,details,movement_quantity,movements FROM compact ORDER BY position`;
const voucherUsageSQL = `SELECT json_extract(details,'$.voucherCode') AS code,
    count(DISTINCT CASE WHEN coalesce(json_extract(details,'$.orderId'),'') NOT IN ('',0)
        THEN 'order:'||json_extract(details,'$.orderId') ELSE 'transaction:'||id END) AS used
    FROM transactions WHERE type='sale' AND coalesce(json_extract(details,'$.voucherCode'),'')<>''
        AND lower(coalesce(nullif(json_extract(details,'$.fulfillmentStatus'),''),json_extract(details,'$.status'),''))<>'returned'
        AND coalesce(json_extract(details,'$.removedFromOrder'),0) IN (0,'')
    GROUP BY json_extract(details,'$.voucherCode')`;
const catalogCache = new WeakMap<D1Database, { catalog: Catalog; revision: number }>();

async function loadCatalog(env: AppEnv): Promise<{ catalog: Catalog; revision: number }> {
    const cached = catalogCache.get(env.DB);
    if (cached) {
        const current = await env.DB.prepare('SELECT revision FROM system_state WHERE singleton = 1').first<{ revision: number }>();
        if (current?.revision === cached.revision) return cached;
    }
    // Reading the rows and revision in the same batch prevents a mixed catalog snapshot.
    // Historical customer, payment, receipt and monetary JSON never enters reconstruction.
    const results = await env.DB.batch([
        env.DB.prepare(catalogSnapshotSQL),
        env.DB.prepare('SELECT revision FROM system_state WHERE singleton = 1'),
        env.DB.prepare(voucherUsageSQL)
    ]);
    const revision = (results[1]?.results[0] as { revision?: number } | undefined)?.revision;
    if (!Number.isSafeInteger(revision)) throw new HttpError(503, 'catalog_unavailable', 'The catalog is temporarily unavailable.');
    const usage = new Map((results[2]?.results || []).map(row => {
        const entry = row as { code: string; used: number };
        return [entry.code, entry.used] as const;
    }));
    const snapshot = { catalog: buildPublicCatalog(decodeCatalogRows(results[0]?.results || []), usage), revision: revision! };
    catalogCache.set(env.DB, snapshot);
    return snapshot;
}
function address(value: unknown, optional = false): RecordData {
    fields(value, ['address', 'city', 'province', 'barangay']);
    return Object.fromEntries(['address', 'city', 'province', 'barangay'].map(key => [key, text(value[key], key, key === 'address' ? 300 : 100, !optional)]));
}
function checkedVoucher(catalog: Catalog, code: unknown) {
    if (code == null || code === '') return null;
    const normalized = text(code, 'voucher code', 100).toUpperCase();
    const voucher = catalog.vouchers.find(entry => entry.code === normalized);
    if (!voucher) failure('This voucher is invalid or inactive.');
    const value = Number(voucher.value);
    if (!['fixed', 'percent'].includes(voucher.discountType) || !Number.isFinite(value) || value < 0 || (voucher.discountType === 'percent' && value > 100)) failure('This voucher is not configured correctly.');
    if (voucher.expiryDate) {
        const expiry = Date.parse(`${String(voucher.expiryDate).slice(0, 10)}T23:59:59.999+08:00`);
        if (!Number.isFinite(expiry) || Date.now() > expiry) failure('This voucher has expired.');
    }
    if (voucher.usageLimit && voucher.used >= Number(voucher.usageLimit)) failure('This voucher has reached its usage limit.');
    return voucher;
}
function checkedItems(catalog: Catalog, value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 200) failure('Choose between 1 and 200 order lines.');
    const variants = new Set<string>();
    const stockNeeded = new Map<string, number>();
    return value.map(draft => {
        fields(draft, ['productId', 'name', 'size', 'color', 'quantity']);
        const product = catalog.products.find(entry => draft.productId ? entry.id === draft.productId : entry.name === draft.name);
        if (!product) failure('An item is no longer in the catalog. Refresh your cart.');
        if (draft.name !== undefined && draft.name !== product.name) failure('An item changed in the catalog. Refresh your cart.');
        const size = text(draft.size, 'size', 20);
        const shirt = !product.category || ['shirts', 'blanks'].includes(product.category);
        if (shirt ? !SIZES.includes(size) : size !== 'N/A') failure('Choose a supported item size.');
        if (draft.color !== undefined && draft.color !== (product.linkedColor || 'Varied')) failure('Choose a supported item color.');
        const variant = `${product.id}:${size}`;
        if (variants.has(variant)) failure('Combine duplicate variants into one line.');
        variants.add(variant);
        const qty = quantity(draft.quantity);
        if (!shirt) {
            const key = getStockKey(product);
            if (key) {
                const needed = (stockNeeded.get(key) || 0) + qty;
                stockNeeded.set(key, needed);
                if (typeof catalog.stock[key] === 'number' && needed > catalog.stock[key]) failure(`${product.name} does not have enough stock.`);
            }
        }
        return { ...product, id: crypto.randomUUID(), size, quantity: qty, unitPrice: getCartUnitPrice(product, qty) };
    });
}
function normalizeCheckout(body: unknown): RecordData {
    fields(body, ['requestId', 'items', 'customerName', 'contactNumber', 'shippingDetails', 'region', 'rush', 'voucherCode', 'paymentMode', 'receipt']);
    if (!Array.isArray(body.items)) failure('Choose the items for your order.');
    const normalized: RecordData = {
        requestId: requestId(body.requestId), items: body.items,
        customerName: text(body.customerName, 'customer name', 150),
        contactNumber: normalizeContact(body.contactNumber), shippingDetails: address(body.shippingDetails),
        region: body.region, rush: body.rush ?? false, voucherCode: body.voucherCode ?? null, paymentMode: body.paymentMode
    };
    if (!['MM', 'Provincial'].includes(normalized.region) || typeof normalized.rush !== 'boolean') failure('Choose a shipping region and rush option.');
    if (!['COD', 'Gcash', 'Bank Transfer'].includes(normalized.paymentMode)) failure('Choose a supported payment method.');
    if (body.receipt != null) {
        fields(body.receipt, ['receiptId', 'token']);
        normalized.receipt = { receiptId: requestId(body.receipt.receiptId), token: text(body.receipt.token, 'receipt capability', 4096) };
    }
    if (normalized.paymentMode !== 'COD' && !normalized.receipt) failure('Upload proof of payment first.');
    return normalized;
}
const checkoutExists = 'EXISTS (SELECT 1 FROM guest_checkout_receipts WHERE request_id = ?)';
function checkoutGuard(env: AppEnv, kind: string, sql: string, values: unknown[]) {
    return env.DB.prepare(`INSERT INTO _guest_checkout_guards(kind,ok) SELECT '${kind}', CASE WHEN ${sql} THEN 1 ELSE 0 END`).bind(...values);
}
function checkoutError(error: unknown): never {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('guest_checkout_request')) throw new HttpError(409, 'idempotency_conflict', 'This checkout request was already used for a different cart.');
    if (message.includes('guest_checkout_receipt')) throw new HttpError(409, 'receipt_conflict', 'This receipt has expired or was already used.');
    if (/guest_checkout_(revision|inserted|written)/.test(message)) throw new HttpError(409, 'catalog_changed', 'The catalog or stock changed. Review your cart and try again.');
    throw error;
}
async function trackingToken(env: AppEnv, key: string, contact: string) {
    const grant = crypto.randomUUID();
    const contactHash = await privateKey(env, `contact:${contact}`);
    const token = await sign(env, { purpose: 'tracking', orderId: key, contactHash, nonce: grant });
    await env.DB.batch([
        env.DB.prepare('DELETE FROM guest_order_grants WHERE expires_at <= ?').bind(nowSeconds()),
        env.DB.prepare('INSERT INTO guest_order_grants(id,order_id,contact_hash,expires_at) VALUES (?,?,?,?)')
            .bind(grant, key, contactHash, nowSeconds() + 1800)
    ]);
    return token;
}
async function checkout(request: Request, env: AppEnv): Promise<Response> {
    const limited = await rateLimit(request, env, 'checkout', 20);
    if (limited) return limited;
    const intent = normalizeCheckout(await readJson(request));
    const hash = await digest(canonical(intent));
    const prior = await env.DB.prepare('SELECT payload_hash,response FROM guest_checkout_receipts WHERE request_id = ?').bind(intent.requestId).first<{ payload_hash: string; response: string }>();
    if (prior) {
        if (prior.payload_hash !== hash) throw new HttpError(409, 'idempotency_conflict', 'This checkout request was already used for a different cart.');
        const saved = JSON.parse(prior.response);
        return json({ ...saved, token: await trackingToken(env, saved.orderId, intent.contactNumber) });
    }
    const { catalog, revision } = await loadCatalog(env);
    const items = checkedItems(catalog, intent.items);
    const voucher = checkedVoucher(catalog, intent.voucherCode);
    const options = {
        shippingFee: intent.region === 'MM' ? 100 : 200, isRushOrder: intent.rush, rushFeePerShirt: 100,
        discount: voucher ? { type: voucher.discountType, value: Number(voucher.value) } : null
    };
    const priced = priceOrder(items, options);
    if (!Number.isSafeInteger(Math.round(priced.total * 100))) failure('The order total exceeds the supported amount.');
    const key = createOrderId();
    const date = new Date().toISOString();
    const pricing = { ...options, version: 1, shippingLineId: items[0]!.id };
    let receiptHash: string | null = null;
    if (intent.receipt) {
        const claims = await verify(env, intent.receipt.token, 'receipt-upload');
        if (claims.receiptId !== intent.receipt.receiptId) failure('Upload your own payment receipt.');
        receiptHash = await digest(intent.receipt.token);
    }
    const rows = priced.items.map((item: RecordData) => ({
        id: item.id, type: 'sale', category: item.category, amount: String(item.amount), date,
        description: `Online Order: ${item.name} (${item.size})`, order_id: key,
        details: {
            orderId: key, customerName: intent.customerName, contactNumber: intent.contactNumber,
            productId: catalog.products.find(product => product.name === item.name)?.id,
            itemName: item.name, brand: item.brand, category: item.category, unitPrice: item.unitPrice,
            shippingShare: item.shippingShare, pricing, source: 'storefront', size: item.size,
            color: item.linkedColor || 'Varied', linkedColor: item.linkedColor || 'Varied', quantity: item.quantity,
            fulfillmentStatus: 'pending', paymentStatus: 'unpaid', status: 'pending', paymentMode: intent.paymentMode,
            shippingDetails: {
                ...intent.shippingDetails, contactNumber: intent.contactNumber, region: intent.region,
                shippingFee: priced.shippingFee, isRushOrder: intent.rush, rushFee: item.rushFee
            },
            voucherCode: voucher?.code || null, discountShare: item.discountShare, originalAmount: item.originalAmount,
            imageUrl: item.imageUrl || null, isOnlineOrder: true,
            proofOfPayment: intent.receipt ? `/api/media/receipts/${intent.receipt.receiptId}` : null
        }
    }));
    const response = { orderId: key, orderVersion: 0, total: priced.total, itemCount: rows.length };
    const statements = [
        checkoutGuard(env, 'request', `NOT ${checkoutExists} OR EXISTS (SELECT 1 FROM guest_checkout_receipts WHERE request_id = ? AND payload_hash = ?)`, [intent.requestId, intent.requestId, hash]),
        checkoutGuard(env, 'revision', `${checkoutExists} OR EXISTS (SELECT 1 FROM system_state WHERE singleton = 1 AND revision = ?)`, [intent.requestId, revision]),
        ...(intent.receipt ? [checkoutGuard(env, 'receipt', `${checkoutExists} OR EXISTS (
            SELECT 1 FROM guest_receipts WHERE id = ? AND capability_hash = ? AND order_id IS NULL AND expires_at > ?)`,
        [intent.requestId, intent.receipt.receiptId, receiptHash, nowSeconds()])] : []),
        env.DB.prepare(`INSERT INTO orders(id) SELECT ? WHERE NOT ${checkoutExists}`).bind(key, intent.requestId),
        env.DB.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id)
            SELECT json_extract(value,'$.id'),'sale',json_extract(value,'$.category'),json_extract(value,'$.amount'),
                json_extract(value,'$.date'),json_extract(value,'$.description'),json_extract(value,'$.details'),?
            FROM json_each(?) WHERE NOT ${checkoutExists}`).bind(key, JSON.stringify(rows), intent.requestId),
        checkoutGuard(env, 'inserted', `${checkoutExists} OR changes() = ?`, [intent.requestId, rows.length]),
        ...(intent.receipt ? [
            env.DB.prepare(`UPDATE guest_receipts SET order_id = ? WHERE id = ? AND NOT ${checkoutExists}`).bind(key, intent.receipt.receiptId, intent.requestId),
            checkoutGuard(env, 'receipt', `${checkoutExists} OR changes() = 1`, [intent.requestId])
        ] : []),
        env.DB.prepare(`INSERT INTO guest_checkout_receipts(request_id,payload_hash,order_id,response)
            SELECT ?,?,?,? WHERE NOT ${checkoutExists}`).bind(intent.requestId, hash, key, JSON.stringify(response), intent.requestId),
        checkoutGuard(env, 'written', 'EXISTS (SELECT 1 FROM guest_checkout_receipts WHERE request_id = ? AND payload_hash = ?)', [intent.requestId, hash]),
        env.DB.prepare('DELETE FROM _guest_checkout_guards'),
        env.DB.prepare('SELECT response FROM guest_checkout_receipts WHERE request_id = ?').bind(intent.requestId)
    ];
    try {
        const result = await env.DB.batch(statements);
        const saved = result.at(-1)?.results[0] as { response: string } | undefined;
        if (!saved) throw new HttpError(503, 'checkout_unconfirmed', 'Checkout could not be confirmed. Retry with the same cart.');
        const body = JSON.parse(saved.response);
        return json({ ...body, token: await trackingToken(env, body.orderId, intent.contactNumber) }, 201);
    } catch (error) { checkoutError(error); }
}

const sourceContact = "coalesce(nullif(json_extract(details,'$.contactNumber'),''),nullif(json_extract(details,'$.shippingDetails.contactNumber'),''),json_extract(details,'$.customerContact'),'')";
const sqlContact = [' ', '+', '(', ')', '.', '-'].reduce((sql, char) => `replace(${sql},'${char}','')`, sourceContact);
const activeSale = "type = 'sale' AND coalesce(json_extract(details,'$.removedFromOrder'),0) NOT IN (1,'true')";
async function loadOrder(env: AppEnv, key: string) {
    const result = await env.DB.batch([
        env.DB.prepare(`SELECT id,type,category,amount,date,description,details,order_id FROM transactions WHERE ${activeSale}
            AND (order_id = ? OR coalesce(nullif(json_extract(details,'$.orderId'),''),id) = ?) ORDER BY date DESC,created_at DESC,id DESC`).bind(key, key),
        env.DB.prepare('SELECT version FROM orders WHERE id = ?').bind(key)
    ]);
    const order = groupOrders(decodeRows(result[0]?.results || [])).find((entry: RecordData) => entry.id === key);
    if (!order) throw new HttpError(404, 'order_not_found', 'No matching order was found. Check the order ID and full contact number.');
    return { ...order, orderVersion: (result[1]?.results[0] as { version?: number } | undefined)?.version ?? 0 };
}
function contactForOrder(order: RecordData): string {
    const contacts = order.items.map((item: RecordData) => {
        try { return normalizeContact(item.details.contactNumber); } catch { return ''; }
    });
    if (!contacts[0] || contacts.some((contact: string) => contact !== contacts[0])) {
        throw new HttpError(404, 'order_not_found', 'No matching order was found. Check the order ID and full contact number.');
    }
    return contacts[0];
}
const safeDetailKeys = [
    'orderId', 'customerName', 'customer', 'contactNumber', 'customerContact', 'customerAddress', 'customerCity',
    'customerProvince', 'customerBarangay', 'shippingRegion', 'itemName', 'name', 'brand', 'category', 'size', 'color',
    'linkedColor', 'quantity', 'unitPrice', 'price', 'originalAmount', 'discountShare', 'shippingShare', 'priceAdjustment',
    'imageUrl', 'fulfillmentStatus', 'previousFulfillmentStatus', 'returnedAt', 'paymentStatus', 'paymentMode',
    'status', 'isOnlineOrder', 'isRushOrder', 'legacyIsRushOrder', 'legacyisRushOrder', 'removedFromOrder', 'amount'
];
function safeDetails(source: RecordData): RecordData {
    const result = Object.fromEntries(safeDetailKeys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
    if (isObject(source.pricing)) {
        result.pricing = Object.fromEntries(['version', 'discount', 'shippingFee', 'isRushOrder', 'rushFeePerShirt', 'shippingLineId'].filter(key => Object.hasOwn(source.pricing, key)).map(key => [key, source.pricing[key]]));
    }
    if (isObject(source.shippingDetails)) {
        result.shippingDetails = Object.fromEntries(['address', 'city', 'province', 'barangay', 'contactNumber', 'region', 'shippingFee', 'isRushOrder', 'rushFee'].filter(key => Object.hasOwn(source.shippingDetails, key)).map(key => [key, source.shippingDetails[key]]));
    }
    if (Array.isArray(source.items)) result.items = source.items.map((item: RecordData) => safeDetails(item.details || item));
    if (typeof source.proofOfPayment === 'string' && /^\/api\/media\/receipts\/[0-9a-f-]{36}$/i.test(source.proofOfPayment)) result.proofOfPayment = source.proofOfPayment;
    return result;
}
function publicOrder(order: RecordData): RecordData {
    const rows = order.transactions.map((row: Transaction) => {
        const details = safeDetails(row.details);
        if (!Array.isArray(details.items) && !details.itemName) {
            details.itemName = order.items.find((item: RecordData) => item.transactionId === row.id)?.details.itemName;
        }
        return {
            id: row.id, type: row.type, category: row.category, amount: Number(row.amount), amountExact: row.amount,
            date: row.date, description: null, details
        };
    });
    return { ...groupOrders(rows)[0], orderVersion: order.orderVersion };
}
async function authorizedOrder(request: Request, env: AppEnv, key: string) {
    const claims = await verify(env, request.headers.get('Authorization')?.replace(/^Bearer /i, ''), 'tracking');
    if (claims.orderId !== key) throw new HttpError(403, 'order_scope', 'This verification is for a different order.');
    await verifyGrant(env, claims);
    const order = await loadOrder(env, key);
    const contact = contactForOrder(order);
    if (claims.contactHash !== await privateKey(env, `contact:${contact}`)) throw new HttpError(401, 'verification_required', 'Verify your current contact number again.');
    return { order, contact };
}

async function verifyGrant(env: AppEnv, claims: RecordData) {
    const grant = await env.DB.prepare(`SELECT id FROM guest_order_grants
        WHERE id = ? AND order_id = ? AND contact_hash = ? AND revoked = 0 AND expires_at > ?`)
        .bind(claims.nonce, claims.orderId, claims.contactHash, nowSeconds()).first();
    if (!grant) throw new HttpError(401, 'verification_required', 'Verify your contact number again.');
}

// A reusable capability check, not a public endpoint or an owner identity.
export async function authorizedGuestOrder(request: Request, env: AppEnv): Promise<string | null> {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return null;
    const claims = await verify(env, authorization.replace(/^Bearer /i, ''), 'tracking');
    const key = orderKey(claims.orderId);
    await authorizedOrder(request, env, key);
    return key;
}
async function track(request: Request, env: AppEnv) {
    const limited = await rateLimit(request, env, 'track', 15);
    if (limited) return limited;
    const body = await readJson(request);
    fields(body, ['orderId', 'contact']);
    const contact = normalizeContact(body.contact);
    const contactLimit = await rateLimit(request, env, 'track-contact', 20, contact);
    if (contactLimit) return contactLimit;
    let key = body.orderId ? orderKey(body.orderId) : '';
    if (!key) {
        const candidate = await env.DB.prepare(`SELECT coalesce(nullif(json_extract(details,'$.orderId'),''),id) AS id
            FROM transactions WHERE ${activeSale} AND ${sqlContact} = ? ORDER BY date DESC,created_at DESC,id DESC LIMIT 1`).bind(contact).first<{ id: string }>();
        key = candidate?.id || 'ST-NOTFOUND';
    }
    const orderLimit = await rateLimit(request, env, 'track-order', 30, key);
    if (orderLimit) return orderLimit;
    const order = await loadOrder(env, key);
    if (contactForOrder(order) !== contact) throw new HttpError(404, 'order_not_found', 'No matching order was found. Check the order ID and full contact number.');
    return json({ order: publicOrder(order), token: await trackingToken(env, key, contact) });
}

async function saveOrder(request: Request, env: AppEnv, key: string) {
    const limited = await rateLimit(request, env, 'order-edit', 30);
    if (limited) return limited;
    const claims = await verify(env, request.headers.get('Authorization')?.replace(/^Bearer /i, ''), 'tracking');
    if (claims.orderId !== key) throw new HttpError(403, 'order_scope', 'This verification is for a different order.');
    await verifyGrant(env, claims);
    const body = await readJson(request);
    fields(body, ['requestId', 'expectedVersion', 'items', 'customerName', 'contactNumber', 'shippingDetails']);
    const id = requestId(body.requestId);
    const payloadHash = await digest(canonical(body));
    const prior = await env.DB.prepare('SELECT contact_hash,payload_hash,response FROM guest_order_receipts WHERE order_id = ? AND request_id = ?')
        .bind(key, id).first<{ contact_hash: string; payload_hash: string; response: string }>();
    if (prior) {
        if (prior.contact_hash !== claims.contactHash || prior.payload_hash !== payloadHash) throw new HttpError(409, 'idempotency_conflict', 'This save request was already used for different changes.');
        const current = await loadOrder(env, key);
        const contact = contactForOrder(current);
        if (contact !== normalizeContact(body.contactNumber)) throw new HttpError(401, 'verification_required', 'Verify your current contact number again.');
        return json({ ...JSON.parse(prior.response), order: publicOrder(current), token: await trackingToken(env, key, contact) });
    }
    const { catalog, revision } = await loadCatalog(env);
    const { order, contact } = await authorizedOrder(request, env, key);
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) failure('A valid order version is required.');
    const drafts = body.items;
    if (!Array.isArray(drafts) || !drafts.length || drafts.length > order.items.length) failure('The order must retain at least one existing item.');
    const originals = new Map<string, RecordData>(order.items.map((item: RecordData) => [item.id, item]));
    const validated = drafts.map((draft: unknown) => {
        fields(draft, ['id', 'quantity', 'size', 'color']);
        const original = originals.get(draft.id);
        if (!original) failure('This item does not belong to the order.');
        const size = text(draft.size, 'size', 20);
        if (size !== original.details.size && (original.details.category === 'shirts' ? !SIZES.includes(size) : size !== 'N/A')) failure('Choose a supported size.');
        const color = text(draft.color ?? original.details.color, 'color', 100, false);
        // Each catalog entry is a fixed color. Keep historical variants valid for no-op edits.
        if (color !== original.details.color) failure('This item is not available in that color.');
        const nextQuantity = quantity(draft.quantity);
        return { id: draft.id, size, color, quantity: nextQuantity };
    });
    const stockChanges = new Map<string, number>();
    for (const original of order.items) {
        if (original.details.category === 'shirts') continue;
        const stockKey = getStockKey(original);
        if (!stockKey) continue;
        const nextQuantity = validated.find(item => item.id === original.id)?.quantity || 0;
        stockChanges.set(stockKey, (stockChanges.get(stockKey) || 0) + nextQuantity - original.details.quantity);
    }
    for (const [stockKey, increase] of stockChanges) {
        if (increase > 0 && typeof catalog.stock[stockKey] === 'number' && increase > catalog.stock[stockKey]) failure('There is not enough stock for this quantity.');
    }
    const nextContact = normalizeContact(body.contactNumber);
    const common: RecordData = {
        customerName: text(body.customerName, 'customer name', 150), contactNumber: nextContact,
        shippingDetails: { ...address(body.shippingDetails, true), contactNumber: nextContact }
    };
    for (const field of ['address', 'city', 'province', 'barangay']) {
        if (order.details.shippingDetails[field] && !common.shippingDetails[field]) failure(`Enter a ${field}.`);
    }
    const result = buildOrderChanges(order, validated, common);
    if (validated.length === order.items.length && validated.every(draft => draft.quantity === originals.get(draft.id)!.details.quantity)) {
        // A customer/variant-only edit must not round historical sub-cent amounts,
        // or replace a legacy financial snapshot with reconstructed allocations.
        for (const change of result.changes) {
            const source = change.original;
            const details = { ...source.details, ...common, shippingDetails: { ...source.details.shippingDetails, ...common.shippingDetails } };
            const variant = (item: RecordData, id: string) => {
                const draft = validated.find(entry => entry.id === id)!;
                return { ...item, size: draft.size, color: draft.color, linkedColor: draft.color };
            };
            if (Array.isArray(source.details.items)) {
                details.items = source.details.items.map((item: RecordData, index: number) => item.details
                    ? { ...item, details: variant(item.details, `${source.id}:${index}`) }
                    : variant(item, `${source.id}:${index}`));
            } else Object.assign(details, variant(details, source.id));
            change.updates = { amount: source.amount, details };
        }
    }
    const saved = await saveGuestOrder(env.DB, { orderId: key, contact, contactHash: claims.contactHash, grantId: claims.nonce, payloadHash, revision }, {
        orderId: key, expectedVersion: body.expectedVersion, requestId: id, requirePending: true,
        changes: result.changes.map((change: RecordData) => ({
            id: change.id,
            expected: {
                type: change.original.type, category: change.original.category, amount: change.original.amount,
                date: change.original.date, description: change.original.description ?? null, details: change.original.details
            },
            updates: change.updates
        }))
    });
    return json({ ...saved, order: publicOrder(await loadOrder(env, key)), token: await trackingToken(env, key, nextContact) });
}

async function readImage(request: Request): Promise<{ bytes: Uint8Array; contentType: string }> {
    const maximum = 5 * 1024 * 1024;
    if (Number(request.headers.get('Content-Length')) > maximum) throw new HttpError(413, 'receipt_too_large', 'Upload an image smaller than 5 MiB.');
    if (!request.body) failure('Choose a receipt image.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > maximum) { await reader.cancel(); throw new HttpError(413, 'receipt_too_large', 'Upload an image smaller than 5 MiB.'); }
            chunks.push(part.value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const prefix = [...bytes.slice(0, 8)].join(',');
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    const contentType = prefix === '137,80,78,71,13,10,26,10' ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
            : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp'
                : ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ? 'image/gif' : '';
    if (!contentType) throw new HttpError(415, 'unsupported_image', 'Choose a PNG, JPEG, WebP or GIF image.');
    return { bytes, contentType };
}
async function uploadReceipt(request: Request, env: AppEnv) {
    const limited = await rateLimit(request, env, 'receipt-upload', 6);
    if (limited) return limited;
    const { bytes, contentType } = await readImage(request);
    const id = crypto.randomUUID();
    const objectKey = `receipts/${id}`;
    const token = await sign(env, { purpose: 'receipt-upload', receiptId: id }, 3600);
    await env.MEDIA.put(objectKey, bytes, { httpMetadata: { contentType, cacheControl: 'private, no-store' } });
    try {
        await env.DB.prepare('INSERT INTO guest_receipts(id,object_key,content_type,byte_size,capability_hash,expires_at) VALUES (?,?,?,?,?,?)')
            .bind(id, objectKey, contentType, bytes.byteLength, await digest(token), nowSeconds() + 3600).run();
    } catch (error) {
        await env.MEDIA.delete(objectKey);
        throw error;
    }
    return json({ receiptId: id, token }, 201);
}
async function receiptDownload(request: Request, env: AppEnv, id: string) {
    const receipt = await env.DB.prepare('SELECT * FROM guest_receipts WHERE id = ?').bind(id).first<ReceiptRow>();
    if (!receipt) throw new HttpError(404, 'receipt_not_found', 'The receipt was not found.');
    if (request.headers.has('Authorization')) {
        if (!receipt.order_id) throw new HttpError(403, 'receipt_unavailable', 'This receipt is not attached to an order.');
        await authorizedOrder(request, env, receipt.order_id);
    } else {
        const member = await findMember(env.DB, await verifyAccessIdentity(request, env));
        if (member.role !== 'owner') throw new HttpError(403, 'receipt_unavailable', 'Only the owner can review this receipt.');
    }
    const object = await env.MEDIA.get(receipt.object_key);
    if (!object) throw new HttpError(404, 'receipt_not_found', 'The receipt was not found.');
    return new Response(object.body, { headers: {
        'Content-Type': receipt.content_type, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="receipt-${id}"`, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer'
    } });
}

export async function handlePublicRequest(request: Request, env: AppEnv): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (path === '/api/public/catalog' && request.method === 'GET') return json((await loadCatalog(env)).catalog);
    if (path === '/api/public/checkout' && request.method === 'POST') return checkout(request, env);
    if (path === '/api/public/track' && request.method === 'POST') return track(request, env);
    if (path === '/api/public/receipts' && request.method === 'POST') return uploadReceipt(request, env);
    const order = /^\/api\/public\/orders\/([^/]+)(\/save)?$/.exec(path);
    if (order) {
        const key = orderKey(decodeURIComponent(order[1]!));
        if (!order[2] && request.method === 'GET') return json({ order: publicOrder((await authorizedOrder(request, env, key)).order) });
        if (order[2] && request.method === 'POST') return saveOrder(request, env, key);
    }
    const receipt = /^\/api\/media\/receipts\/([0-9a-f-]+)$/.exec(path);
    if (receipt && request.method === 'GET') return receiptDownload(request, env, requestId(receipt[1]));
    if (path.startsWith('/api/public/') || path.startsWith('/api/media/receipts')) {
        throw new HttpError(404, 'not_found', 'This public endpoint was not found.');
    }
    return null;
}
