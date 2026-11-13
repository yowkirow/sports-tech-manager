// Blank shirts on the shelf (owner request, November 2026). The owner and the print staff count the blank
// shirts by color and size and enter them, the owner under Stock › Blank shirts and the staff on /print
// (owner request, November 13). Each save is a `blank_count` record holding the whole board and naming who
// counted it; the newest one is the board. Inventory is separate: it works blanks out from what was bought
// and sold, while this is what was counted.
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

/** Who counted: the name saved with the count, or the role for counts saved before names were. */
export function countedByName(details) {
    const name = typeof details?.countedBy === 'string' ? details.countedBy.trim() : '';
    return name || (details?.userRole === 'print_operator' ? 'Print staff' : 'Owner');
}

const ROLE_NAMES = new Map([['Owner', 'the owner'], ['Print staff', 'the print staff'], ['Print operator', 'the print operator']]);
/** Who saved a count as a sentence reads it: "you", "the owner" or the print operator's name. */
export const whoCounted = count => (count.byYou ? 'you' : ROLE_NAMES.get(count.countedBy) ?? count.countedBy);

/**
 * The board in force: the newest count in a newest-first transaction feed, with its ID, when it was saved
 * and who counted it (`byYou` when that was the viewer).
 */
export function currentBlankCount(transactions = [], viewerEmail = null) {
    const latest = transactions.find(transaction => transaction?.type === BLANK_COUNT);
    const count = latest ? readBlankCount(latest.details) : null;
    return count ? {
        ...count, id: latest.id, countedAt: latest.date, countedBy: countedByName(latest.details),
        byYou: Boolean(viewerEmail) && latest.details?.createdBy === viewerEmail
    } : null;
}

/** A saved board as GET /api/production/blanks sends it, or null when anything in it is off. */
export function readSavedBlankCount(value) {
    const board = readBlankCount(value);
    if (!board || typeof value.id !== 'string' || !value.id || typeof value.countedAt !== 'string' || Number.isNaN(Date.parse(value.countedAt))
        || typeof value.countedBy !== 'string' || !value.countedBy.trim() || typeof value.byYou !== 'boolean') return null;
    return { ...board, id: value.id, countedAt: value.countedAt, countedBy: value.countedBy, byYou: value.byYou };
}

/** The catalog colors and first-count suggestions GET /api/production/blanks sends, keeping only well-formed ones. */
export function readCountColors(value) {
    const colors = Array.isArray(value?.colors) ? value.colors.filter(color => plain(color) && typeof color.name === 'string'
        && color.name.trim() && color.name.length <= BLANK_COLOR_MAX).map(color => ({ name: color.name, hex: blankHex(color.hex) })) : [];
    const suggested = Array.isArray(value?.suggested) ? value.suggested.filter(row => plain(row) && typeof row.color === 'string'
        && row.color.trim() === row.color && row.color && row.color.length <= BLANK_COLOR_MAX && !CONTROL.test(row.color))
        .slice(0, MAX_BLANK_COLORS).map(row => ({ color: row.color, hex: blankHex(row.hex) })) : [];
    return { colors, suggested };
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
