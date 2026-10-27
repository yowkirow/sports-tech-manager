import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleBusinessRequest } from '../../worker/business-api.ts';
import { HttpError } from '../../worker/errors.ts';
import { handlePublicRequest } from '../../worker/public-api.ts';
import { normalizeCustomerEmail, suggestEmailFix } from '../../src/lib/customerEmail.js';

const directory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
const uid = value => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const owner = { id: 'owner', email: 'owner@example.invalid', role: 'owner' };
const reseller = { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' };
const SENDER = { email: 'no-reply@sportstechph.store', name: 'SportsTech PH' };

// Runs the emitted SQL, including the ON CONFLICT claim and batch rollback, against SQLite.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        migrations.forEach(sql => this.sqlite.exec(sql));
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { assert.ok(values.length <= 100); this.values = values; return this; },
            async all() { return db.execute(this); },
            async run() { return db.execute(this); },
            async first(column) {
                const row = db.execute(this).results[0];
                return column ? row?.[column] ?? null : row ?? null;
            }
        };
    }
    execute(statement) {
        const results = this.sqlite.prepare(statement.sql).all(...statement.values);
        return { success: true, results, meta: { changes: this.sqlite.prepare('SELECT changes() AS n').get().n } };
    }
    async batch(statements) {
        this.sqlite.exec('BEGIN');
        try {
            const results = statements.map(statement => this.execute(statement));
            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`, { cause: error });
        }
    }
}
// Stands in for the Cloudflare Email Service binding. Queue a code (or true for an error without
// one) in `failures` to make the next send throw the way the binding does.
function mailbox() {
    return {
        sent: [], failures: [],
        async send(message) {
            const failure = this.failures.shift();
            if (failure) throw Object.assign(new Error('Synthetic email failure'), failure === true ? {} : { code: failure });
            this.sent.push(message);
            return { messageId: `<synthetic-${this.sent.length}@example.invalid>` };
        }
    };
}
function seed(DB, id, type, details, amount = '0') {
    DB.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details,order_id)
        VALUES (?,?,?,?,'2026-09-01T00:00:00.000Z','synthetic',?,NULL)`).run(id, type, details.category || 'general', amount, JSON.stringify(details));
}
function fixture(t, { email = true } = {}) {
    const DB = new LocalD1(t);
    for (const member of [owner, reseller]) {
        DB.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
    }
    seed(DB, uid(1), 'define_product', { name: 'Team Shirt', price: 350, linkedColor: 'Black', category: 'shirts' });
    seed(DB, uid(2), 'define_product', { name: 'Practice Ball', price: 100, category: 'balls' });
    seed(DB, uid(3), 'update_stock', { name: 'Practice Ball', quantity: 500, category: 'balls' });
    const EMAIL = email ? mailbox() : undefined;
    const env = {
        DB, ...(EMAIL ? { EMAIL } : {}), GUEST_TOKEN_SECRET: 'synthetic-test-secret-not-a-real-key-123456', ENVIRONMENT: 'production',
        CANONICAL_HOST: 'www.sportstechph.store', PRINT_QUEUE_ENABLED: 'false', ACCESS_TEAM_DOMAIN: '', ACCESS_AUDIENCE: ''
    };
    return { env, DB, EMAIL };
}
function cart(overrides = {}) {
    return {
        requestId: crypto.randomUUID(), items: [{ productId: uid(1), name: 'Team Shirt', size: 'M', quantity: 2 }],
        customerName: 'Juan <b>Dela</b> Cruz', contactNumber: '0917 123 4567',
        shippingDetails: { address: '12 Rizal St.', city: 'Quezon City', province: 'Metro Manila', barangay: 'Barangay Uno' },
        region: 'MM', rush: false, paymentMode: 'COD', ...overrides
    };
}
let address = 0;
async function checkout(env, body) {
    address += 1;
    const response = await handlePublicRequest(new Request('https://www.sportstechph.store/api/public/checkout', {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${(address % 250) + 1}` }
    }), env);
    return { status: response.status, body: await response.json() };
}
async function api(env, member, path, method = 'GET', body) {
    const response = await handleBusinessRequest(new Request(`https://www.sportstechph.store${path}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), env, member);
    assert.ok(response);
    assert.equal(response.status, 200);
    return response.json();
}
async function orderRows(env, orderId) {
    const { rows } = await api(env, owner, '/api/transactions?limit=100');
    return rows.filter(row => row.type === 'sale' && row.details?.orderId === orderId);
}
// The owner's Orders save, built the way the browser builds it from the loaded rows.
async function save(env, orderId, update, requestId = crypto.randomUUID()) {
    const rows = await orderRows(env, orderId);
    const body = {
        orderId, expectedVersion: rows[0].orderVersion, requestId,
        changes: rows.map(row => ({
            id: row.id,
            expected: { type: row.type, category: row.category, amount: row.amountExact, date: row.date, description: row.description, details: row.details },
            updates: { amount: row.amountExact, details: { ...row.details, ...update } }
        }))
    };
    return { body, response: await api(env, owner, '/api/orders/save', 'POST', body) };
}
const shipped = trackingNumber => ({ fulfillmentStatus: 'shipped', status: 'shipped', ...(trackingNumber ? { trackingNumber } : {}) });
const log = DB => DB.sqlite.prepare('SELECT id, order_id, kind, recipient, status, error, attempts FROM customer_notifications ORDER BY created_at, id').all();
const rejection = (code, status) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
};

test('customer emails are normalized, validated and typo-checked the same way everywhere', () => {
    assert.equal(normalizeCustomerEmail('  Juan.Dela-Cruz+shop@Gmail.COM '), 'juan.dela-cruz+shop@gmail.com');
    assert.equal(normalizeCustomerEmail(''), '');
    assert.equal(normalizeCustomerEmail(undefined), '');
    for (const invalid of ['juan@gmail', 'juan @gmail.com', 'ju..an@gmail.com', '.juan@gmail.com', 'juan@-bad.com', `${'x'.repeat(65)}@gmail.com`, 42]) {
        assert.equal(normalizeCustomerEmail(invalid), null, String(invalid));
    }
    assert.equal(suggestEmailFix('juan@gmial.com'), 'juan@gmail.com');
    assert.equal(suggestEmailFix('juan@yahoo'), 'juan@yahoo.com');
    assert.equal(suggestEmailFix('juan@gmail.com'), null);
    assert.equal(suggestEmailFix('juan@mail.com'), null, 'a real domain equally close to two common ones gets no guess');
    assert.equal(suggestEmailFix('juan@dlsu.edu.ph'), null);
});

test('a shop checkout with an email stores it and sends one escaped order confirmation', async t => {
    const { env, DB, EMAIL } = fixture(t);
    const body = cart({ customerEmail: '  Juan.Cruz@Gmail.COM ' });
    const placed = await checkout(env, body);
    assert.equal(placed.status, 201);
    const orderId = placed.body.orderId;
    const lines = DB.sqlite.prepare("SELECT details FROM transactions WHERE type = 'sale'").all().map(row => JSON.parse(row.details));
    assert.ok(lines.length && lines.every(line => line.customerEmail === 'juan.cruz@gmail.com'));
    assert.equal(EMAIL.sent.length, 1);
    const [mail] = EMAIL.sent;
    assert.equal(mail.to, 'juan.cruz@gmail.com');
    assert.deepEqual(mail.from, SENDER);
    assert.ok(!('replyTo' in mail) && !('cc' in mail) && !('bcc' in mail));
    assert.equal(mail.subject, `We got your order ${orderId}`);
    for (const expected of ['Hi Juan, thanks for shopping with SportsTech PH.', `Your order number is ${orderId}.`, '2 × Team Shirt (M · Black)  ₱700', 'Items: ₱700',
        'Shipping (LBC): ₱100', 'Total: ₱800', 'Payment: Cash on delivery',
        'Ship to: Juan <b>Dela</b> Cruz, 12 Rizal St., Barangay Uno, Quezon City, Metro Manila',
        'Order by Thursday, ships Sunday via LBC.', `View your order: https://www.sportstechph.store/track/${orderId}`,
        "Replies to this email aren’t read.", 'Sent to juan.cruz@gmail.com for updates on order']) {
        assert.ok(mail.text.includes(expected), expected);
    }
    assert.ok(mail.html.includes('Juan &lt;b&gt;Dela&lt;/b&gt; Cruz'));
    assert.ok(!mail.html.includes('<b>Dela'), 'customer text is escaped in the HTML part');
    assert.ok(mail.html.includes(`href="https://www.sportstechph.store/track/${orderId}"`));
    assert.ok(mail.html.includes('src="https://www.sportstechph.store/logo-mark.png"'));
    assert.ok(mail.html.includes("url('https://www.sportstechph.store/fonts/barlow-condensed-latin-800-normal.woff2')"));
    assert.deepEqual(log(DB).map(row => [row.id, row.kind, row.recipient, row.status, row.attempts]),
        [[`received:${orderId}`, 'received', 'juan.cruz@gmail.com', 'sent', 1]]);

    const replay = await checkout(env, body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.orderId, orderId);
    assert.equal(EMAIL.sent.length, 1, 'a replayed checkout never sends the confirmation twice');
});

test('a failed confirmation is retried by the retried checkout, then never sent again', async t => {
    const { env, DB, EMAIL } = fixture(t);
    EMAIL.failures.push('E_RATE_LIMIT_EXCEEDED');
    const body = cart({ customerEmail: 'ana@example.com' });
    const placed = await checkout(env, body);
    assert.equal(placed.status, 201, 'the order is placed even when the email fails');
    assert.equal(EMAIL.sent.length, 0);
    assert.deepEqual(log(DB).map(row => [row.status, row.error, row.attempts]), [['failed', 'E_RATE_LIMIT_EXCEEDED', 1]]);
    await checkout(env, body);
    assert.equal(EMAIL.sent.length, 1);
    assert.deepEqual(log(DB).map(row => [row.status, row.error, row.attempts]), [['sent', null, 2]]);
    await checkout(env, body);
    assert.equal(EMAIL.sent.length, 1);
});

test('the email is optional, must be valid, and never reaches the customer order page', async t => {
    const { env, DB, EMAIL } = fixture(t);
    assert.equal((await checkout(env, cart())).status, 201);
    assert.equal((await checkout(env, cart({ customerEmail: '   ' }))).status, 201);
    assert.equal(EMAIL.sent.length, 0);
    assert.deepEqual(log(DB), []);
    assert.ok(DB.sqlite.prepare("SELECT details FROM transactions WHERE type = 'sale'").all().every(row => !JSON.parse(row.details).customerEmail));
    for (const customerEmail of ['juan@gmail', 'juan@@gmail.com', 7]) {
        await assert.rejects(checkout(env, cart({ customerEmail })), rejection('invalid_input', 400));
    }
    const placed = await checkout(env, cart({ customerEmail: 'private.person@example.com' }));
    const response = await handlePublicRequest(new Request(`https://www.sportstechph.store/api/public/orders/${placed.body.orderId}`, {
        headers: { Authorization: `Bearer ${placed.body.token}`, 'CF-Connecting-IP': '198.51.100.7' }
    }), env);
    const page = JSON.stringify(await response.json());
    assert.equal(response.status, 200);
    assert.ok(page.includes(placed.body.orderId));
    assert.ok(!page.includes('private.person@example.com') && !page.includes('customerEmail'));
});

test('shipping with a tracking number emails it once per number and address; booking numbers never leave', async t => {
    const { env, DB, EMAIL } = fixture(t);
    const { orderId } = (await checkout(env, cart({ customerEmail: 'juan@example.com' }))).body;
    assert.equal(EMAIL.sent.length, 1);

    const first = await save(env, orderId, { ...shipped('1224 8001-5678'), bookingNumber: 'BK-PRIVATE-77' });
    assert.deepEqual(first.response.email, { kind: 'shipped', status: 'sent', recipient: 'juan@example.com' });
    assert.equal(EMAIL.sent.length, 2);
    const mail = EMAIL.sent[1];
    assert.equal(mail.to, 'juan@example.com');
    assert.equal(mail.subject, `Your order ${orderId} has shipped`);
    assert.ok(mail.text.includes('LBC tracking number: 1224 8001-5678'));
    assert.ok(mail.text.includes('Track on LBC: https://www.lbcexpress.com/track/?tracking_no=122480015678'));
    assert.ok(mail.text.includes('is on its way via LBC.'));
    assert.ok(mail.html.includes('href="https://www.lbcexpress.com/track/?tracking_no=122480015678"'));
    assert.ok(mail.text.includes('2 × Team Shirt (M · Black)') && !mail.text.includes('₱'), 'the parcel list has no prices');
    assert.ok(!mail.text.includes('BK-PRIVATE-77') && !mail.html.includes('BK-PRIVATE-77'), 'the booking number is the print staff label, never emailed');

    const replay = await api(env, owner, '/api/orders/save', 'POST', first.body);
    assert.equal(replay.email.reason, 'already_sent', 'a replayed save (same request) never sends twice');
    assert.equal((await save(env, orderId, { paymentStatus: 'paid' })).response.email.reason, 'already_sent');
    assert.equal((await save(env, orderId, { trackingNumber: '122480015678' })).response.email.reason, 'already_sent',
        'the same number typed without spaces or dashes is the same parcel');
    assert.equal(EMAIL.sent.length, 2);

    const corrected = await save(env, orderId, { trackingNumber: 'LBC <9999>' });
    assert.equal(corrected.response.email.status, 'sent', 'a corrected number is emailed again, like the tracking text');
    assert.ok(EMAIL.sent[2].html.includes('LBC &lt;9999&gt;') && !EMAIL.sent[2].html.includes('<9999>'));
    assert.ok(!EMAIL.sent[2].html.includes('Track on LBC'), 'no LBC link for a value that is not a plain code or link');

    const readdressed = await save(env, orderId, { customerEmail: 'juan.new@example.com' });
    assert.equal(readdressed.response.email.status, 'sent', 'a corrected address gets the tracking email');
    assert.equal(EMAIL.sent[3].to, 'juan.new@example.com');
    assert.deepEqual(log(DB).map(row => [row.kind, row.status]), [['received', 'sent'], ['shipped', 'sent'], ['shipped', 'sent'], ['shipped', 'sent']]);
});

test('shipping without a number, an order without an email, or a link-only number behave on purpose', async t => {
    const { env, EMAIL } = fixture(t);
    const withEmail = (await checkout(env, cart({ customerEmail: 'maria@example.com' }))).body.orderId;
    const noNumber = await save(env, withEmail, shipped());
    assert.ok(!('email' in noNumber.response), 'another courier, a pickup or a bulk Shipped sends nothing');
    assert.equal(noNumber.response.version, 1);
    assert.equal(EMAIL.sent.length, 1);

    const courier = 'https://www.jtexpress.ph/trajectoryQuery?waybillNo=JT0001&flag=1';
    const linked = await save(env, withEmail, { trackingNumber: courier });
    assert.equal(linked.response.email.status, 'sent');
    const [, mail] = EMAIL.sent;
    assert.ok(mail.html.includes('href="https://www.jtexpress.ph/trajectoryQuery?waybillNo=JT0001&amp;flag=1"'));
    assert.ok(mail.html.includes('Open tracking link'));
    assert.ok(mail.text.includes(`Follow your parcel with the courier’s tracking link.\n${courier}`));
    assert.ok(mail.text.includes('is on its way.'));
    assert.ok(!/LBC/.test(mail.text) && !/LBC/.test(mail.html), 'another courier’s link is never called LBC, like the order page');

    const noEmail = (await checkout(env, cart())).body.orderId;
    assert.ok(!('email' in (await save(env, noEmail, shipped('7777 0000 1111'))).response));
    assert.ok(!('email' in (await save(env, noEmail, { paymentStatus: 'paid' })).response));
    assert.equal(EMAIL.sent.length, 2);
});

test('a failed shipped email never fails the save, reports why, and the next save retries it', async t => {
    const { env, DB, EMAIL } = fixture(t);
    const { orderId } = (await checkout(env, cart({ customerEmail: 'lea@example.com' }))).body;
    EMAIL.failures.push('E_DELIVERY_FAILED');
    const failed = await save(env, orderId, shipped('3333 4444 5555'));
    assert.equal(failed.response.version, 1, 'the order is saved');
    assert.equal(failed.response.email.status, 'failed');
    assert.equal(failed.response.email.reason, 'E_DELIVERY_FAILED');
    assert.match(failed.response.email.message, /rejected/);
    assert.ok((await orderRows(env, orderId)).every(row => row.details.fulfillmentStatus === 'shipped'));
    EMAIL.failures.push(true);
    assert.equal((await save(env, orderId, { paymentStatus: 'paid' })).response.email.reason, 'E_UNKNOWN');
    const retried = await save(env, orderId, { paymentMode: 'Gcash' });
    assert.equal(retried.response.email.status, 'sent');
    assert.equal(EMAIL.sent.length, 2);
    assert.deepEqual(log(DB).filter(row => row.kind === 'shipped').map(row => [row.status, row.attempts]), [['sent', 3]]);
});

test('an owner POS sale with an email gets a confirmation; resellers can never add one', async t => {
    const { env, EMAIL } = fixture(t);
    const row = (id, details) => ({
        id, type: 'sale', category: 'shirts', amount: '700', date: '2026-09-10T00:00:00.000Z', description: 'POS sale',
        details: {
            orderId: 'ST-POSEMAIL01', customerName: 'Ana Santos', contactNumber: '09171112222', customerEmail: 'ana.santos@example.com',
            itemName: 'Team Shirt', category: 'shirts', unitPrice: 350, originalAmount: 700, discountShare: 0, shippingShare: 0,
            quantity: 2, size: 'L', color: 'Black', source: 'pos', paymentMode: 'Cash', paymentStatus: 'paid',
            fulfillmentStatus: 'pending', status: 'pending', ...details
        }
    });
    const request = { rows: [row(uid(60))], requestId: 'pos-email-1' };
    await api(env, owner, '/api/transactions', 'POST', request);
    assert.equal(EMAIL.sent.length, 1);
    assert.equal(EMAIL.sent[0].subject, 'We got your order ST-POSEMAIL01');
    assert.ok(EMAIL.sent[0].text.includes('Payment: Cash · Paid'));
    assert.ok(!EMAIL.sent[0].text.includes('Shipping (LBC)') && !EMAIL.sent[0].text.includes('Order by Thursday'), 'a counter sale has no shipping text');
    await api(env, owner, '/api/transactions', 'POST', request);
    assert.equal(EMAIL.sent.length, 1, 'a replayed POS checkout never sends twice');

    await assert.rejects(api(env, owner, '/api/transactions', 'POST', {
        rows: [row(uid(61), { orderId: 'ST-POSEMAIL02', customerEmail: 'Ana.Santos@Example.com' })], requestId: 'pos-email-2'
    }), rejection('validation_error', 400));
    const resellerRow = row(uid(62), { orderId: 'ST-RESELLER01', unitPrice: 400, originalAmount: 400, quantity: 1, paymentMode: 'COD', paymentStatus: 'unpaid' });
    resellerRow.amount = '400';
    await assert.rejects(api(env, reseller, '/api/transactions', 'POST', { rows: [resellerRow], requestId: 'reseller-email' }),
        rejection('validation_error', 400));
    delete resellerRow.details.customerEmail;
    await api(env, reseller, '/api/transactions', 'POST', { rows: [resellerRow], requestId: 'reseller-plain' });
    assert.equal(EMAIL.sent.length, 1);
});

test('a customer editing their own pending order keeps the email they gave', async t => {
    const { env, DB, EMAIL } = fixture(t);
    const placed = (await checkout(env, cart({ customerEmail: 'keep@example.com' }))).body;
    const headers = { Authorization: `Bearer ${placed.token}`, 'CF-Connecting-IP': '198.51.100.8' };
    const { order } = await (await handlePublicRequest(new Request(`https://www.sportstechph.store/api/public/orders/${placed.orderId}`, { headers }), env)).json();
    const body = {
        requestId: crypto.randomUUID(), expectedVersion: order.orderVersion,
        items: order.items.map(item => ({ id: item.id, quantity: item.details.quantity, size: 'L', color: item.details.color })),
        customerName: order.customerName, contactNumber: order.details.contactNumber,
        shippingDetails: Object.fromEntries(['address', 'city', 'province', 'barangay'].map(key => [key, order.details.shippingDetails[key]]))
    };
    const saved = await handlePublicRequest(new Request(`https://www.sportstechph.store/api/public/orders/${placed.orderId}/save`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env);
    assert.equal(saved.status, 200);
    const lines = DB.sqlite.prepare("SELECT details FROM transactions WHERE type = 'sale'").all().map(row => JSON.parse(row.details));
    assert.ok(lines.every(line => line.size === 'L' && line.customerEmail === 'keep@example.com'));
    assert.equal(EMAIL.sent.length, 1, 'a customer edit sends nothing new');
});

test('owner edits accept a blank or normalized email only', async t => {
    const { env } = fixture(t);
    const { orderId } = (await checkout(env, cart())).body;
    await assert.rejects(save(env, orderId, { customerEmail: 'Juan@Example.com' }), rejection('validation_error', 400));
    await assert.rejects(save(env, orderId, { customerEmail: 'not an email' }), rejection('validation_error', 400));
    await save(env, orderId, { customerEmail: 'juan@example.com' });
    await save(env, orderId, { customerEmail: '' });
    assert.ok((await orderRows(env, orderId)).every(row => row.details.customerEmail === ''));
});

test('the Settings test email goes only to the signed-in owner, at most once a minute', async t => {
    const { env, EMAIL } = fixture(t);
    const sent = await api(env, owner, '/api/notifications/test', 'POST', {});
    assert.deepEqual(sent.email, { kind: 'test', status: 'sent', recipient: 'owner@example.invalid' });
    assert.equal(EMAIL.sent[0].to, 'owner@example.invalid');
    assert.equal(EMAIL.sent[0].subject, 'Test: We got your order ST-SAMPLE00000');
    assert.ok(EMAIL.sent[0].text.includes('Test email from Settings') && !EMAIL.sent[0].text.includes('/track/'));
    assert.equal((await api(env, owner, '/api/notifications/test', 'POST', {})).email.reason, 'already_sent');
    assert.equal(EMAIL.sent.length, 1);
    await assert.rejects(api(env, reseller, '/api/notifications/test', 'POST', {}), rejection('forbidden', 403));
    const staging = fixture(t, { email: false });
    assert.deepEqual((await api(staging.env, owner, '/api/notifications/test', 'POST', {})).email,
        { kind: 'test', status: 'skipped', recipient: 'owner@example.invalid', reason: 'not_configured' });
});

test('without the email binding (staging) nothing is sent or recorded', async t => {
    const { env, DB } = fixture(t, { email: false });
    const { orderId } = (await checkout(env, cart({ customerEmail: 'juan@example.com' }))).body;
    assert.ok(!('email' in (await save(env, orderId, shipped('1111 2222 3333'))).response));
    assert.deepEqual(log(DB), []);
});

test('one address gets at most ten order confirmations a day from the public checkout', async t => {
    const { env, EMAIL } = fixture(t);
    for (let index = 0; index < 11; index += 1) {
        assert.equal((await checkout(env, cart({ customerEmail: 'flood@example.com' }))).status, 201);
    }
    assert.equal(EMAIL.sent.length, 10);
});
