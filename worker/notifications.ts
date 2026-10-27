import type { Member } from './auth.ts';
import type { AppEnv } from './env.ts';
import { isObject } from './http.ts';
import { normalizeCustomerEmail } from '../src/lib/customerEmail.js';
import { parcelTrackingUrl } from '../src/lib/lbcBooking.js';

// Customer emails (owner decision 2026-10-27): "order received" after a shop checkout or an owner POS
// sale, and "shipped" with the LBC tracking number. Sent through Cloudflare Email Service from a
// no-reply address; the footer points customers to Facebook and Instagram. customer_notifications
// (migration 0017) dedupes every email, so retries, replays and repeated saves never send one twice,
// and a failed send is tried again the next time the same email is due.

type Data = Record<string, unknown>;
export type EmailKind = 'received' | 'shipped' | 'test';
export interface EmailResult {
    kind: EmailKind;
    status: 'sent' | 'failed' | 'skipped';
    recipient?: string;
    reason?: string;
    message?: string;
}
export interface Background { waitUntil(promise: Promise<unknown>): void }
interface OrderRow { id: string; amount: string; details: Data }
interface Line { name: string; variant: string; quantity: number; value: number | null }
interface Summary {
    orderId: string;
    customerName: string;
    lines: Line[];
    breakdown: boolean;
    subtotal: number;
    discount: number;
    rush: number;
    shipping: number;
    adjustment: number;
    total: number;
    payment: string;
    shipTo: string;
    awaitingShipment: boolean;
    orderPage: boolean;
}
interface Message { subject: string; html: string; text: string }
interface Block { html: string; text: string }
interface Delivery { id: string; orderId: string | null; kind: EmailKind; recipient: string }

// Must match allowed_sender_addresses on the production send_email binding.
export const EMAIL_SENDER = 'no-reply@sportstechph.store';
const SENDER = { email: EMAIL_SENDER, name: 'SportsTech PH' };
const FACEBOOK = 'https://facebook.com/sportstech.fb';
const INSTAGRAM = 'https://instagram.com/sportstech.ig';
const STALE_CLAIM_MS = 10 * 60 * 1000;
// A storefront checkout is public, so one address gets at most this many confirmations a day.
const RECEIVED_PER_ADDRESS_PER_DAY = 10;
const FAILURES: Record<string, string> = {
    E_SENDER_NOT_VERIFIED: 'Email sending isn’t set up for sportstechph.store yet.',
    E_SENDER_DOMAIN_NOT_AVAILABLE: 'Email sending isn’t set up for sportstechph.store yet.',
    E_RECIPIENT_NOT_ALLOWED: 'This address isn’t allowed by the email settings.',
    E_RECIPIENT_SUPPRESSED: 'This address bounced or reported an email as spam before, so it can’t be emailed.',
    E_VALIDATION_ERROR: 'The email service rejected the address. Check it on the order.',
    E_DELIVERY_FAILED: 'The customer’s email provider rejected it. Check the address on the order.',
    E_RATE_LIMIT_EXCEEDED: 'Too many emails at once.',
    E_DAILY_LIMIT_EXCEEDED: 'Today’s email limit was reached.',
    E_ACCOUNT_SUSPENDED: 'Cloudflare paused email sending for this account.',
    E_INTERNAL: 'Something went wrong while sending.',
    E_UNKNOWN: 'The email service didn’t accept it.'
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char] ?? char);
}
// One line of stored text: control characters and runs of whitespace become a single space.
function plain(value: unknown, max = 200): string {
    return typeof value === 'string' || typeof value === 'number'
        ? String(value).replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
}
function cents(value: unknown): number {
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
export function peso(amount: number): string {
    const abs = Math.abs(amount);
    const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fraction = abs % 100 ? `.${String(abs % 100).padStart(2, '0')}` : '';
    return `${amount < 0 ? '−' : ''}₱${whole}${fraction}`;
}
function siteUrl(env: AppEnv): string {
    const host = env.CANONICAL_HOST && /^[a-z0-9.-]+$/i.test(env.CANONICAL_HOST) ? env.CANONICAL_HOST : 'www.sportstechph.store';
    return `https://${host}`;
}

// Same rule as the customer's order page: a shipped order's trimmed tracking number, at most 300
// characters. Never the booking number, which is the print staff's package-label number.
export function shippedTracking(details: unknown): string | null {
    if (!isObject(details)) return null;
    const status = details.fulfillmentStatus ?? details.status;
    const value = typeof details.trackingNumber === 'string' ? details.trackingNumber.trim() : '';
    return status === 'shipped' && value && value.length <= 300 ? value : null;
}
// "1224 8001 5678" and "1224-8001-5678" are the same parcel, so they share one dedupe key.
function trackingKey(tracking: string): string {
    return /^https?:\/\//i.test(tracking) ? tracking : tracking.replace(/[\s-]+/g, '').toUpperCase();
}
const removed = (details: Data) => details.removedFromOrder === true || details.removedFromOrder === 'true';
const statusOf = (details: Data) => details.fulfillmentStatus ?? details.status;

// Only an owner's save that leaves the order Shipped can owe the customer a shipped email.
export function savesShipped(input: unknown): boolean {
    if (!isObject(input) || !Array.isArray(input.changes)) return false;
    return input.changes.some(change => isObject(change) && isObject(change.updates) && isObject(change.updates.details)
        && !removed(change.updates.details) && statusOf(change.updates.details) === 'shipped');
}

const ACTIVE_SALE = "type = 'sale' AND coalesce(json_extract(details, '$.removedFromOrder'), 0) NOT IN (1, 'true')";
async function loadOrder(db: D1Database, orderId: string): Promise<OrderRow[]> {
    const result = await db.prepare(`SELECT id, amount, details FROM transactions WHERE ${ACTIVE_SALE}
            AND (order_id = ? OR coalesce(nullif(json_extract(details, '$.orderId'), ''), id) = ?)
        ORDER BY date, rowid`).bind(orderId, orderId).all<{ id: string; amount: string | number; details: string | null }>();
    return result.results.flatMap(row => {
        try {
            const details: unknown = row.details === null ? null : JSON.parse(row.details);
            return isObject(details) ? [{ id: row.id, amount: String(row.amount), details }] : [];
        } catch {
            return [];
        }
    });
}
function emailOf(rows: OrderRow[]): string | null {
    for (const row of rows) {
        const email = normalizeCustomerEmail(row.details.customerEmail);
        if (email) return email;
    }
    return null;
}

function lineOf(source: Data, amount?: string): Line {
    const details: Data = isObject(source.details) ? { ...source, ...source.details } : source;
    const count = Number(details.quantity);
    const quantity = Number.isSafeInteger(count) && count > 0 ? count : 1;
    const size = plain(details.size, 20);
    const color = plain(details.color ?? details.linkedColor, 40);
    const unit = details.unitPrice ?? details.price;
    const raw = details.originalAmount ?? (unit !== undefined && unit !== null && unit !== '' ? Number(unit) * quantity : amount);
    return {
        name: plain(details.itemName ?? details.name, 120) || 'Item',
        variant: [size && size !== 'N/A' ? size : '', color && color !== 'Varied' ? color : ''].filter(Boolean).join(' · '),
        quantity,
        value: raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw)) ? null : cents(raw)
    };
}
const PAYMENT_LABELS: Record<string, string> = { COD: 'Cash on delivery', Gcash: 'GCash', GCash: 'GCash', 'Bank Transfer': 'Bank transfer', Cash: 'Cash' };
function summarize(orderId: string, rows: OrderRow[]): Summary {
    const first = rows[0]?.details ?? {};
    const shipping: Data = isObject(first.shippingDetails) ? first.shippingDetails : {};
    const lines: Line[] = [];
    let discount = 0;
    let rush = 0;
    let freight = 0;
    let total = 0;
    let flat = true;
    for (const row of rows) {
        const details = row.details;
        total += cents(row.amount);
        discount += cents(details.discountShare);
        freight += cents(details.shippingShare);
        rush += cents(isObject(details.shippingDetails) ? details.shippingDetails.rushFee : 0);
        if (Array.isArray(details.items)) {
            flat = false;
            for (const item of details.items) {
                if (isObject(item) && !removed(isObject(item.details) ? item.details : item)) lines.push(lineOf(item));
            }
        } else lines.push(lineOf(details, row.amount));
    }
    const subtotal = lines.reduce((sum, line) => sum + (line.value ?? 0), 0);
    // Legacy multi-item rows don't keep reliable per-item values, so they show the total only.
    const breakdown = flat && lines.length > 0 && lines.every(line => line.value !== null);
    const mode = plain(first.paymentMode, 40);
    const payment = [PAYMENT_LABELS[mode] ?? mode, first.paymentStatus === 'paid' ? 'Paid'
        : typeof first.proofOfPayment === 'string' && first.proofOfPayment ? 'Receipt uploaded' : ''].filter(Boolean).join(' · ');
    const shipTo = [
        plain(shipping.address) || plain(first.customerAddress), plain(shipping.barangay) || plain(first.customerBarangay),
        plain(shipping.city) || plain(first.customerCity), plain(shipping.province) || plain(first.customerProvince)
    ].filter(Boolean).join(', ');
    const contact = plain(first.contactNumber, 40) || plain(shipping.contactNumber, 40) || plain(first.customerContact, 40);
    return {
        orderId, customerName: plain(first.customerName, 150), lines, breakdown, subtotal, discount, rush, shipping: freight,
        adjustment: breakdown ? total - (subtotal - discount + rush + freight) : 0, total, payment, shipTo,
        awaitingShipment: Boolean(shipTo) && ['pending', 'paid', 'in_progress', 'ready'].includes(String(statusOf(first) ?? 'pending')),
        // The order page opens with the order's mobile number, so it is only offered when there is one.
        orderPage: Boolean(contact)
    };
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
// Barlow Condensed loads where the mail app allows web fonts (Apple Mail); elsewhere the closest
// condensed face on that platform (iOS, macOS/Windows, Android) keeps the display voice.
const DISPLAY = "'Barlow Condensed','Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif-condensed,Arial,sans-serif";
const C = { ground: '#0b0b0c', ink: '#18181b', ink2: '#52525b', line: '#e4e4e7', page: '#f4f4f5', red: '#dc2626' };
const body = `font-family:${FONT};font-size:16px;line-height:24px;color:${C.ink};`;
const paragraph = (html: string, style = '') => `<p style="margin:0 0 16px;${body}${style}">${html}</p>`;
const link = (url: string, label: string) => `<a href="${escapeHtml(url)}" target="_blank" style="color:${C.ink};font-weight:600;text-decoration:underline;">${escapeHtml(label)}</a>`;
function button(url: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px;"><tr>
<td bgcolor="${C.red}" style="border-radius:999px;background:${C.red};"><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a></td>
</tr></table>`;
}
const subheading = (label: string) => `<h2 style="margin:28px 0 10px;font-family:${DISPLAY};font-size:18px;line-height:22px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:${C.ground};">${escapeHtml(label)}</h2>`;

function itemsBlock(summary: Summary, prices: boolean): Block {
    const cell = `font-family:${FONT};font-size:16px;line-height:22px;color:${C.ink};`;
    const priced = prices && summary.breakdown;
    const rows = summary.lines.map(line => `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.line};${cell}"><strong>${line.quantity} × ${escapeHtml(line.name)}</strong>${line.variant ? `<br><span style="font-size:14px;color:${C.ink2};">${escapeHtml(line.variant)}</span>` : ''}</td>${priced ? `<td align="right" valign="top" style="padding:12px 0 12px 16px;border-bottom:1px solid ${C.line};white-space:nowrap;${cell}">${escapeHtml(peso(line.value ?? 0))}</td>` : ''}</tr>`).join('');
    const text = summary.lines.map(line => `${line.quantity} × ${line.name}${line.variant ? ` (${line.variant})` : ''}${priced ? `  ${peso(line.value ?? 0)}` : ''}`);
    if (!prices) {
        return { html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, text: text.join('\n') };
    }
    const charges: [string, number][] = summary.breakdown ? [
        ['Items', summary.subtotal],
        ...(summary.discount ? [['Discount', -summary.discount] as [string, number]] : []),
        ...(summary.rush ? [['Rush fee', summary.rush] as [string, number]] : []),
        ...(summary.shipping ? [['Shipping (LBC)', summary.shipping] as [string, number]] : []),
        ...(summary.adjustment ? [['Adjustment', summary.adjustment] as [string, number]] : [])
    ] : [];
    const chargeRows = charges.map(([label, amount]) => `<tr><td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink2};">${escapeHtml(label)}</td><td align="right" style="padding:4px 0;white-space:nowrap;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink2};">${escapeHtml(peso(amount))}</td></tr>`).join('');
    const totalRow = `<tr><td style="padding:12px 0 0;border-top:2px solid ${C.ground};font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${C.ground};">Total</td><td align="right" style="padding:12px 0 0;border-top:2px solid ${C.ground};white-space:nowrap;font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${C.ground};">${escapeHtml(peso(summary.total))}</td></tr>`;
    return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">${chargeRows}${totalRow}</table>`,
        text: [...text, '', ...charges.map(([label, amount]) => `${label}: ${peso(amount)}`), `Total: ${peso(summary.total)}`].join('\n')
    };
}
function detailsBlock(pairs: [string, string[]][]): Block {
    const shown = pairs.map(([label, lines]) => [label, lines.filter(Boolean)] as [string, string[]]).filter(([, lines]) => lines.length);
    return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">${shown.map(([label, lines]) => `<tr><td valign="top" style="padding:6px 16px 6px 0;width:72px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.ink2};">${escapeHtml(label)}</td><td style="padding:6px 0;font-family:${FONT};font-size:16px;line-height:22px;color:${C.ink};">${lines.map(escapeHtml).join('<br>')}</td></tr>`).join('')}</table>`,
        text: shown.map(([label, lines]) => `${label}: ${lines.join(', ')}`).join('\n')
    };
}
function noteBlock(title: string, note: string): Block {
    return { html: `${subheading(title)}${paragraph(escapeHtml(note))}`, text: `${title.toUpperCase()}\n${note}` };
}

function layout(env: AppEnv, content: {
    subject: string; preheader: string; heading: string; intro: string; blocks: Block[]; sentTo: string; banner?: string; keep?: string[];
}): Message {
    const site = siteUrl(env);
    const host = site.replace(/^https:\/\//, '');
    // Order numbers ("ST-…") stay on one line instead of breaking at the hyphen.
    const unbroken = (value: string) => (content.keep ?? []).reduce((html, word) =>
        html.split(escapeHtml(word)).join(`<span style="white-space:nowrap;">${escapeHtml(word)}</span>`), escapeHtml(value));
    const banner = content.banner ? `<p style="margin:0 0 24px;padding:12px 16px;border:1px solid ${C.line};border-radius:12px;background:${C.page};font-family:${FONT};font-size:14px;line-height:20px;color:${C.ground};">${escapeHtml(content.banner)}</p>` : '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
<style>
@font-face { font-family: 'Barlow Condensed'; font-style: normal; font-weight: 800; font-display: swap; src: url('${escapeHtml(site)}/fonts/barlow-condensed-latin-800-normal.woff2') format('woff2'); }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${escapeHtml(content.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px 32px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td bgcolor="${C.ground}" style="background:${C.ground};border-radius:16px 16px 0 0;padding:22px 28px;">
<a href="${escapeHtml(site)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(site)}/logo-mark.png" width="116" height="60" alt="SportsTech PH" style="display:block;border:0;outline:none;width:116px;height:60px;font-family:${DISPLAY};font-size:18px;line-height:60px;font-weight:800;color:#f4f4f5;"></a>
</td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 16px 16px;padding:32px 28px 28px;">
${banner}<h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:32px;line-height:34px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:${C.ground};">${escapeHtml(content.heading)}</h1>
${paragraph(unbroken(content.intro))}
${content.blocks.map(block => block.html).join('\n')}
</td></tr>
<tr><td style="padding:24px 28px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink2};">
<p style="margin:0 0 8px;">Questions? Message us on ${link(FACEBOOK, 'Facebook')} or ${link(INSTAGRAM, 'Instagram')}. Replies to this email aren’t read.</p>
<p style="margin:0 0 8px;">${unbroken(content.sentTo)}</p>
<p style="margin:0;">SportsTech PH · ${link(site, host)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
    const text = [
        'SPORTSTECH PH', '',
        ...(content.banner ? [content.banner, ''] : []),
        content.heading.toUpperCase(), '', content.intro, '',
        ...content.blocks.flatMap(block => [block.text, '']),
        '—',
        `Questions? Message us on Facebook (${FACEBOOK}) or Instagram (${INSTAGRAM}). Replies to this email aren’t read.`,
        content.sentTo,
        `SportsTech PH · ${site}`
    ].join('\n');
    return { subject: content.subject, html, text };
}

const greeting = (summary: Summary) => summary.customerName.split(' ')[0] || 'there';
function orderPageBlock(env: AppEnv, summary: Summary, asButton: boolean): Block[] {
    if (!summary.orderPage) return [];
    const url = `${siteUrl(env)}/track/${encodeURIComponent(summary.orderId)}`;
    const note = 'Open it with the mobile number on your order.';
    return [{
        html: asButton ? `<div style="margin-top:28px;">${button(url, 'View your order')}${paragraph(escapeHtml(note), `font-size:14px;line-height:20px;color:${C.ink2};`)}</div>`
            : paragraph(`${link(url, 'View your order')} <span style="color:${C.ink2};">(${escapeHtml(note.replace(/\.$/, '').replace(/^O/, 'o'))})</span>`, 'margin-top:24px;'),
        text: `View your order: ${url}\n${note}`
    }];
}
function receivedMessage(env: AppEnv, summary: Summary, recipient: string, test = false): Message {
    const blocks: Block[] = [
        itemsBlock(summary, true),
        detailsBlock([['Payment', [summary.payment]], ['Ship to', summary.shipTo ? [summary.customerName, summary.shipTo] : []]])
    ];
    if (summary.awaitingShipment) {
        blocks.push(noteBlock('What’s next', 'Order by Thursday, ships Sunday via LBC. We’ll email you the LBC tracking number when your parcel ships.'));
    }
    blocks.push(...orderPageBlock(env, summary, true));
    return layout(env, {
        subject: `${test ? 'Test: ' : ''}We got your order ${summary.orderId}`,
        preheader: `Total ${peso(summary.total)}.${summary.awaitingShipment ? ' Order by Thursday, ships Sunday via LBC.' : ''}`,
        heading: 'We got your order',
        intro: `Hi ${greeting(summary)}, thanks for shopping with SportsTech PH. Your order number is ${summary.orderId}.`,
        blocks,
        sentTo: test ? `Sent to ${recipient} as a test from Settings.` : `Sent to ${recipient} for updates on order ${summary.orderId}.`,
        keep: [summary.orderId],
        ...(test ? { banner: 'Test email from Settings: this is how customers see an order confirmation. No order was placed.' } : {})
    });
}
function shippedMessage(env: AppEnv, summary: Summary, tracking: string, recipient: string): Message {
    const url = parcelTrackingUrl(tracking);
    const isLink = /^https?:\/\//i.test(tracking);
    const label = isLink ? 'LBC tracking link' : 'LBC tracking number';
    const trackingHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:20px;">
<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;line-height:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.ink2};">${label}</p>
${isLink ? '' : `<p style="margin:0 0 16px;font-family:${DISPLAY};font-size:32px;line-height:36px;font-weight:800;letter-spacing:1px;color:${C.ground};word-break:break-all;">${escapeHtml(tracking)}</p>`}
${url ? button(url, 'Track with LBC') : ''}
</td></tr></table>`;
    const blocks: Block[] = [
        { html: trackingHtml, text: `${label}: ${tracking}${url && url !== tracking ? `\nTrack with LBC: ${url}` : ''}` },
        { html: subheading('In this parcel'), text: 'IN THIS PARCEL' },
        itemsBlock(summary, false),
        ...orderPageBlock(env, summary, false)
    ];
    return layout(env, {
        subject: `Your order ${summary.orderId} has shipped`,
        preheader: isLink ? 'Follow your parcel with LBC.' : `LBC tracking number ${tracking}.`,
        heading: 'It’s on its way',
        intro: `Hi ${greeting(summary)}, your SportsTech PH order ${summary.orderId} is on its way via LBC.`,
        blocks,
        sentTo: `Sent to ${recipient} for updates on order ${summary.orderId}.`,
        keep: [summary.orderId]
    });
}

function errorCode(error: unknown): string {
    const code = isObject(error) && typeof error.code === 'string' ? error.code : '';
    return /^E_[A-Z_]{1,60}$/.test(code) ? code : 'E_UNKNOWN';
}
function failed(kind: EmailKind, code: string, recipient?: string): EmailResult {
    return { kind, status: 'failed', ...(recipient ? { recipient } : {}), reason: code, message: FAILURES[code] ?? FAILURES.E_UNKNOWN! };
}
async function record(env: AppEnv, id: string, status: 'sent' | 'failed', messageId: string | null, error: string | null) {
    try {
        await env.DB.prepare('UPDATE customer_notifications SET status = ?, message_id = ?, error = ?, updated_at = ? WHERE id = ?')
            .bind(status, messageId, error, new Date().toISOString(), id).run();
    } catch (failure) {
        // The email itself already went (or failed); losing the log entry must not fail the request.
        console.error(JSON.stringify({ event: 'customer_email_log_failed', errorType: failure instanceof Error ? failure.name : 'UnknownError' }));
    }
}
// Claims the dedupe row first: a new email, a failed one, or a send that died mid-way 10+ minutes
// ago. A sent email, or one another request is sending right now, is skipped.
async function deliver(env: AppEnv, email: SendEmail, delivery: Delivery, message: Message): Promise<EmailResult> {
    const base = { kind: delivery.kind, recipient: delivery.recipient };
    const now = new Date();
    const claimed = await env.DB.prepare(`INSERT INTO customer_notifications(id, order_id, kind, recipient, status, attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'sending', 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = 'sending', recipient = excluded.recipient, attempts = customer_notifications.attempts + 1,
            message_id = NULL, error = NULL, updated_at = excluded.updated_at
        WHERE customer_notifications.status = 'failed'
            OR (customer_notifications.status = 'sending' AND customer_notifications.updated_at < ?)
        RETURNING attempts`)
        .bind(delivery.id, delivery.orderId, delivery.kind, delivery.recipient, now.toISOString(), now.toISOString(),
            new Date(now.getTime() - STALE_CLAIM_MS).toISOString())
        .first<{ attempts: number }>();
    if (!claimed) {
        const existing = await env.DB.prepare('SELECT status FROM customer_notifications WHERE id = ?').bind(delivery.id).first<{ status: string }>();
        return { ...base, status: 'skipped', reason: existing?.status === 'sent' ? 'already_sent' : 'in_progress' };
    }
    try {
        const sent = await email.send({ to: delivery.recipient, from: SENDER, subject: message.subject, html: message.html, text: message.text });
        await record(env, delivery.id, 'sent', typeof sent?.messageId === 'string' ? sent.messageId.slice(0, 256) : null, null);
        return { ...base, status: 'sent' };
    } catch (error) {
        const code = errorCode(error);
        await record(env, delivery.id, 'failed', null, code);
        console.error(JSON.stringify({ event: 'customer_email_failed', kind: delivery.kind, code }));
        return failed(delivery.kind, code, delivery.recipient);
    }
}
// Sending never fails the request that triggered it: an unexpected error becomes a failed result.
async function safely(kind: EmailKind, task: () => Promise<EmailResult | null>): Promise<EmailResult | null> {
    try {
        return await task();
    } catch (error) {
        console.error(JSON.stringify({ event: 'customer_email_error', kind, errorType: error instanceof Error ? error.name : 'UnknownError' }));
        return failed(kind, 'E_INTERNAL');
    }
}

// The confirmation for a new order that has an email: once per order, whoever placed it.
export async function sendOrderReceived(env: AppEnv, orderId: string): Promise<EmailResult | null> {
    const email = env.EMAIL;
    if (!email) return null;
    return safely('received', async () => {
        const rows = await loadOrder(env.DB, orderId);
        const recipient = emailOf(rows);
        if (!recipient) return null;
        const recent = await env.DB.prepare(`SELECT count(*) AS sent FROM customer_notifications
            WHERE recipient = ? AND kind = 'received' AND id <> ? AND created_at > ?`)
            .bind(recipient, `received:${orderId}`, new Date(Date.now() - 86_400_000).toISOString()).first<{ sent: number }>();
        if ((recent?.sent ?? 0) >= RECEIVED_PER_ADDRESS_PER_DAY) return { kind: 'received', status: 'skipped', recipient, reason: 'address_limit' };
        return deliver(env, email, { id: `received:${orderId}`, orderId, kind: 'received', recipient },
            receivedMessage(env, summarize(orderId, rows), recipient));
    });
}

// Owner decision (2026-10-27), matching the tracking text: a Shipped order with a tracking number
// and an email gets one shipped email per tracking number and address. Shipping without a number
// (another courier, a pickup, or a bulk Shipped) sends nothing; a corrected number or a corrected
// address sends again; any later save retries an email that failed.
export async function sendShippedEmail(env: AppEnv, orderId: string): Promise<EmailResult | null> {
    const email = env.EMAIL;
    if (!email) return null;
    return safely('shipped', async () => {
        const rows = await loadOrder(env.DB, orderId);
        const tracking = rows[0] ? shippedTracking(rows[0].details) : null;
        const recipient = emailOf(rows);
        if (!tracking || !recipient) return null;
        return deliver(env, email, { id: `shipped:${orderId}:${trackingKey(tracking)}:${recipient}`, orderId, kind: 'shipped', recipient },
            shippedMessage(env, summarize(orderId, rows), tracking, recipient));
    });
}

const SAMPLE: Summary = {
    orderId: 'ST-SAMPLE00000', customerName: 'Juan Dela Cruz',
    lines: [
        { name: 'Sample team shirt', variant: 'M · Black', quantity: 2, value: 70_000 },
        { name: 'Sample pickleball', variant: '', quantity: 3, value: 30_000 }
    ],
    breakdown: true, subtotal: 100_000, discount: 0, rush: 0, shipping: 10_000, adjustment: 0, total: 110_000,
    payment: 'Cash on delivery', shipTo: '123 Sample Street, Barangay Sample, Quezon City, Metro Manila',
    awaitingShipment: true, orderPage: false
};
// Settings preview, sent to the signed-in owner only, at most once a minute.
export async function sendTestEmail(env: AppEnv, member: Member): Promise<EmailResult> {
    const recipient = normalizeCustomerEmail(member.email);
    if (!recipient) return { kind: 'test', status: 'skipped', reason: 'no_email' };
    const email = env.EMAIL;
    if (!email) return { kind: 'test', status: 'skipped', recipient, reason: 'not_configured' };
    const minute = new Date().toISOString().slice(0, 16);
    return await safely('test', () => deliver(env, email, { id: `test:${member.id}:${minute}`, orderId: null, kind: 'test', recipient },
        receivedMessage(env, SAMPLE, recipient, true))) ?? { kind: 'test', status: 'skipped', recipient };
}

// Runs after the response when the runtime allows it; tests (no context) wait for it instead.
export function background(ctx: Background | undefined, task: Promise<unknown>): Promise<void> {
    const settled = task.then(() => undefined, error => {
        console.error(JSON.stringify({ event: 'customer_email_error', errorType: error instanceof Error ? error.name : 'UnknownError' }));
    });
    if (!ctx) return settled;
    ctx.waitUntil(settled);
    return Promise.resolve();
}
