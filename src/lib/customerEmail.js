// The customer's optional email for order updates (owner decision 2026-10-27): the shop checkout asks
// for it, owners can add it in POS or Orders, and the server sends the "order received" and
// "shipped" emails to it. Resellers never set it. The browser and the Worker share these helpers so
// both accept exactly the same addresses.

export const MAX_EMAIL_LENGTH = 254;

// A practical check, not the full RFC: a plain local part, then a dotted domain with a letter TLD.
const ADDRESS = /^[^\s@"(),:;<>[\\\]\u0000-\u001f\u007f]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// '' for a blank field, the trimmed lowercase address when it is valid, otherwise null.
export function normalizeCustomerEmail(value) {
    if (value == null) return '';
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (!email) return '';
    if (email.length > MAX_EMAIL_LENGTH || !ADDRESS.test(email) || /^\.|\.\.|\.@/.test(email)) return null;
    return email;
}

// The email saved on a grouped order (it is a common detail, copied to every line).
export function orderCustomerEmail(order) {
    const sources = [...(order?.transactions || []), ...(order?.items || [])];
    return sources.map(source => source?.details?.customerEmail).find(email => typeof email === 'string' && email) || '';
}

const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.com.ph', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com'];

// Edit distance that counts a swapped pair ("gmial") as one edit.
function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
    }
    return rows[a.length][b.length];
}

// "juan@gmial.com" → "juan@gmail.com", for a "Did you mean …?" hint under the field. Null when the
// domain is already a common one, or when nothing common is clearly closest.
export function suggestEmailFix(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const at = email.lastIndexOf('@');
    const domain = at > 0 ? email.slice(at + 1) : '';
    if (!domain || domain.length > 40 || COMMON_DOMAINS.includes(domain)) return null;
    if (!domain.includes('.') && COMMON_DOMAINS.includes(`${domain}.com`)) return `${email.slice(0, at)}@${domain}.com`;
    let best = null;
    let bestDistance = 3;
    let tied = false;
    for (const candidate of COMMON_DOMAINS) {
        const current = distance(domain, candidate);
        if (current < bestDistance) {
            best = candidate;
            bestDistance = current;
            tied = false;
        } else if (current === bestDistance && best) tied = true;
    }
    return best && !tied ? `${email.slice(0, at)}@${best}` : null;
}
