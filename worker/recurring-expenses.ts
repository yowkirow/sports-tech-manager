import { canonical } from './order-store.ts';
import { chargeDaysThrough, manilaToday, readSubscription, RECURRING_EXPENSE } from '../src/lib/recurringExpenses.js';

// Subscription charges (src/lib/recurringExpenses.js). The production cron runs this every day at
// 00:05 in Manila, and owners run it right after adding a subscription. Each run checks every
// charge day since the first, so a missed night catches up; a charge that exists, or that the
// owner deleted (tombstone), is skipped.
const CHUNK = 100;

/** A charge's ID: a UUID derived from its subscription and day, so each charge is recorded once. */
export async function chargeId(recurringId: string, day: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`recurring_expense\n${recurringId}\n${day}`));
    const bytes = new Uint8Array(digest).slice(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Records every charge due by `today` (YYYY-MM-DD in Manila) and returns how many were new. */
export async function recordDueCharges(db: D1Database, today = manilaToday()): Promise<number> {
    const { results } = await db.prepare('SELECT id, details FROM transactions WHERE type = ?')
        .bind(RECURRING_EXPENSE).all<{ id: string; details: string | null }>();
    const charges = [];
    for (const record of results) {
        const details: Record<string, unknown> | null = record.details === null ? null : JSON.parse(record.details);
        const subscription = readSubscription(details);
        if (!subscription) continue;
        for (const day of chargeDaysThrough(subscription, today)) {
            charges.push({
                id: await chargeId(record.id, day), recurringId: record.id,
                category: subscription.subCategory === 'Marketing/Ads' ? 'ads' : 'general',
                amount: String(subscription.amount), date: `${day}T01:00:00Z`, description: subscription.name,
                details: canonical({
                    subCategory: subscription.subCategory, isGeneral: true, club: subscription.club,
                    reimbursed: false, reimbursedAmount: 0, recurringId: record.id, recurringDate: day,
                    createdBy: typeof details?.createdBy === 'string' ? details.createdBy : null, userRole: 'owner'
                })
            });
        }
    }
    let inserted = 0;
    for (let start = 0; start < charges.length; start += CHUNK) {
        // The subscription must still exist: one stopped while this ran records nothing more.
        const result = await db.prepare(`INSERT INTO transactions(id, type, category, amount, date, description, details)
            SELECT json_extract(c.value, '$.id'), 'expense', json_extract(c.value, '$.category'), json_extract(c.value, '$.amount'),
                json_extract(c.value, '$.date'), json_extract(c.value, '$.description'), json_extract(c.value, '$.details')
            FROM json_each(?) AS c
            WHERE NOT EXISTS (SELECT 1 FROM transactions AS t WHERE t.id = json_extract(c.value, '$.id'))
                AND NOT EXISTS (SELECT 1 FROM transaction_tombstones AS x WHERE x.id = json_extract(c.value, '$.id'))
                AND EXISTS (SELECT 1 FROM transactions AS s WHERE s.id = json_extract(c.value, '$.recurringId') AND s.type = ?)`)
            .bind(JSON.stringify(charges.slice(start, start + CHUNK)), RECURRING_EXPENSE).run();
        inserted += result.meta.changes ?? 0;
    }
    return inserted;
}
