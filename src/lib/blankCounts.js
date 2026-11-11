// Blank shirts on the shelf (owner request, November 2026). The owner counts the blank shirts by color
// and size and enters them under Stock › Blank shirts; print staff see the same board on /print. Each
// save is a `blank_count` record holding the whole board, and the newest one is the board. Inventory is
// separate: it works blanks out from what was bought and sold, while this is what the owner counted.
export const BLANK_COUNT = 'blank_count';
export const BLANK_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
export const MAX_BLANK_COLORS = 60;
export const MAX_BLANKS_PER_SIZE = 100_000;
export const BLANK_NOTE_MAX = 200;
export const BLANK_COLOR_MAX = 64;

const HEX = /^#[0-9a-f]{6}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MANILA = 8 * 3_600_000;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

/** A count's board ({ rows: [{ color, hex, sizes }], note }), or null when anything in it is off. */
export function readBlankCount(details) {
    if (!plain(details) || !Array.isArray(details.rows)) return null;
    const { rows, note = '' } = details;
    if (!rows.length || rows.length > MAX_BLANK_COLORS) return null;
    if (typeof note !== 'string' || note.length > BLANK_NOTE_MAX || CONTROL.test(note)) return null;
    const seen = new Set();
    const board = [];
    for (const row of rows) {
        if (!plain(row) || !onlyKeys(row, ['color', 'hex', 'sizes'])) return null;
        const { color, hex = null, sizes } = row;
        if (typeof color !== 'string' || !color || color !== color.trim() || color.length > BLANK_COLOR_MAX || CONTROL.test(color)) return null;
        if (hex !== null && (typeof hex !== 'string' || !HEX.test(hex))) return null;
        if (seen.has(color.toLowerCase())) return null;
        seen.add(color.toLowerCase());
        if (!plain(sizes) || Object.keys(sizes).length !== BLANK_SIZES.length || !onlyKeys(sizes, BLANK_SIZES)) return null;
        if (!BLANK_SIZES.every(size => Number.isSafeInteger(sizes[size]) && sizes[size] >= 0 && sizes[size] <= MAX_BLANKS_PER_SIZE)) return null;
        board.push({ color, hex, sizes: Object.fromEntries(BLANK_SIZES.map(size => [size, sizes[size]])) });
    }
    return { rows: board, note: note.trim() };
}

/** The board in force: the newest count in a newest-first transaction feed, with when it was saved. */
export function currentBlankCount(transactions = []) {
    const latest = transactions.find(transaction => transaction?.type === BLANK_COUNT);
    const count = latest ? readBlankCount(latest.details) : null;
    return count ? { ...count, countedAt: latest.date } : null;
}

export const rowTotal = row => BLANK_SIZES.reduce((sum, size) => sum + row.sizes[size], 0);

/** Shirts per size across every color, and the grand total. */
export function blankTotals(rows) {
    const sizes = Object.fromEntries(BLANK_SIZES.map(size => [size, rows.reduce((sum, row) => sum + row.sizes[size], 0)]));
    return { sizes, total: BLANK_SIZES.reduce((sum, size) => sum + sizes[size], 0) };
}

const clock = time => {
    const local = new Date(time + MANILA);
    const hours = local.getUTCHours();
    return `${hours % 12 || 12}:${String(local.getUTCMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};

/** When a count was saved, in Philippine time: "today at 11:09 PM", "yesterday at 9:15 AM" or "Nov 3 (8 days ago)". */
export function countedWhen(iso, now = new Date()) {
    const time = new Date(iso).getTime();
    const days = Math.floor((now.getTime() + MANILA) / DAY) - Math.floor((time + MANILA) / DAY);
    if (days <= 0) return `today at ${clock(time)}`;
    if (days === 1) return `yesterday at ${clock(time)}`;
    const local = new Date(time + MANILA);
    const year = local.getUTCFullYear() === new Date(now.getTime() + MANILA).getUTCFullYear() ? '' : `, ${local.getUTCFullYear()}`;
    return `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}${year} (${days} days ago)`;
}

/**
 * The colors to start a first count with: the ones the shop's shirts use, most-used first, with their
 * swatch from the catalog colors. Falls back to the catalog colors when no shirt names one.
 */
export function suggestedBlankColors(products = [], colors = []) {
    const hexOf = new Map(colors.map(color => [color.name.toLowerCase(), color.hex]));
    const uses = new Map();
    for (const product of products) {
        const color = typeof product?.linkedColor === 'string' ? product.linkedColor.trim() : '';
        if ((product?.category ?? 'shirts') !== 'shirts' || !color || color.length > BLANK_COLOR_MAX) continue;
        const key = color.toLowerCase();
        uses.set(key, { color: uses.get(key)?.color ?? color, count: (uses.get(key)?.count ?? 0) + 1 });
    }
    const picked = uses.size ? [...uses.values()].sort((a, b) => b.count - a.count || a.color.localeCompare(b.color)).map(entry => entry.color)
        : colors.map(color => color.name.trim()).filter(Boolean);
    return picked.slice(0, MAX_BLANK_COLORS).map(color => ({ color, hex: blankHex(hexOf.get(color.toLowerCase())) }));
}

/** A catalog swatch the board can keep, or null. */
export const blankHex = hex => (typeof hex === 'string' && HEX.test(hex) ? hex.toLowerCase() : null);
