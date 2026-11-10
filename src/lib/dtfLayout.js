// DTF gang sheet layout (owner request 2026-11-09). Pure: sizes in inches in, positions in inches out.
//
// The owner picks designs and how many of each. They are placed in straight rows, copies of a design
// together, tallest first. When they don't all fit, another sheet is added, and the rows are balanced
// across the sheets. Then the leftover film is shared out so the designs are spread evenly over the
// whole sheet: every cut is a straight line, first across the sheet between rows, then between the
// designs in each row.

export const SHEET_DEFAULTS = Object.freeze({ widthIn: 22, lengthIn: 39, marginIn: 0.25, gapIn: 0.5 });
// The supplier sells film by the meter, and calls a 22 x 39 in sheet one meter.
export const INCHES_PER_METER = 39;
const LIMITS = { widthIn: [2, 120], lengthIn: [2, 400], gapIn: [0, 6] };
const EPSILON = 1e-6;

const finite = (value, fallback) => {
    const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
    return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

/** Sheet settings with every value present and inside sensible bounds. */
export function sheetSettings(input = {}) {
    const widthIn = clamp(finite(input.widthIn, SHEET_DEFAULTS.widthIn), LIMITS.widthIn);
    const lengthIn = clamp(finite(input.lengthIn, SHEET_DEFAULTS.lengthIn), LIMITS.lengthIn);
    const marginIn = clamp(finite(input.marginIn, SHEET_DEFAULTS.marginIn), [0, Math.min(widthIn, lengthIn) / 4]);
    const gapIn = clamp(finite(input.gapIn, SHEET_DEFAULTS.gapIn), LIMITS.gapIn);
    return { widthIn, lengthIn, marginIn, gapIn };
}

/** Rows of copies, filled left to right: a row takes the next copy while it fits with the minimum gap. */
function buildRows(groups, usableWidth, gap) {
    const rows = [];
    let row = null;
    for (const group of groups) {
        for (let copy = 1; copy <= group.quantity; copy++) {
            if (!row || row.width + gap + group.widthIn > usableWidth + EPSILON) {
                row = { items: [], width: -gap, height: 0 };
                rows.push(row);
            }
            row.items.push({ key: group.key, designId: group.designId, copy, widthIn: group.widthIn, heightIn: group.heightIn });
            row.width += gap + group.widthIn;
            row.height = Math.max(row.height, group.heightIn);
        }
    }
    return rows;
}

/** Rows split into consecutive sheets, each holding as many rows as fit within `capacity`. */
function stack(rows, capacity, gap) {
    const sheets = [];
    let current = null;
    let used = 0;
    for (const row of rows) {
        if (!current || used + gap + row.height > capacity + EPSILON) {
            current = [];
            sheets.push(current);
            used = row.height;
        } else {
            used += gap + row.height;
        }
        current.push(row);
    }
    return sheets;
}

/**
 * The fewest sheets, with the rows balanced between them: the smallest fill that still needs no
 * more sheets than packing each one full.
 */
function balance(rows, usableLength, gap) {
    const sheets = stack(rows, usableLength, gap);
    if (sheets.length < 2) return sheets;
    let low = Math.max(...rows.map(row => row.height));
    let high = usableLength;
    for (let step = 0; step < 60 && high - low > 1e-4; step++) {
        const middle = (low + high) / 2;
        if (stack(rows, middle, gap).length <= sheets.length) high = middle;
        else low = middle;
    }
    return stack(rows, high, gap);
}

/**
 * Gaps for a line of `count` things of total size `size` across a sheet side of `full` inches.
 * Every visible gap is the same, the space to the sheet's edge included, so the designs spread
 * over the whole side. When that would put a design inside the margin or two designs closer than
 * the minimum gap, the outer designs move to the margin and the inner gaps take all the space.
 */
export function spread(count, size, full, margin, minimumGap) {
    if (count <= 0) return { start: margin, gap: 0 };
    const free = full - 2 * margin - size;
    if (count === 1) return { start: margin + free / 2, gap: 0 };
    const even = (free + 2 * margin) / (count + 1);
    if (even >= margin - EPSILON && even >= minimumGap - EPSILON) return { start: even, gap: even };
    return { start: margin, gap: free / (count - 1) };
}

/**
 * picks: [{ key, designId, name, widthIn, heightIn, quantity }]. The same design can be picked
 * twice at two sizes, under two keys.
 */
export function layoutSheets(picks = [], input = SHEET_DEFAULTS) {
    const settings = sheetSettings(input);
    const { widthIn, lengthIn, marginIn, gapIn } = settings;
    const usableWidth = widthIn - 2 * marginIn;
    const usableLength = lengthIn - 2 * marginIn;
    const tooBig = [];
    const groups = [];
    for (const pick of picks) {
        const quantity = Math.floor(finite(pick.quantity, 0));
        const width = finite(pick.widthIn, 0);
        const height = finite(pick.heightIn, 0);
        if (quantity < 1 || width <= 0 || height <= 0) continue;
        if (width > usableWidth + EPSILON || height > usableLength + EPSILON) {
            tooBig.push({ key: pick.key, designId: pick.designId, name: pick.name, widthIn: width, heightIn: height, quantity,
                reason: width > usableWidth + EPSILON ? 'width' : 'length' });
            continue;
        }
        groups.push({ key: pick.key, designId: pick.designId, name: String(pick.name ?? ''), widthIn: width, heightIn: height, quantity });
    }
    const order = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
    groups.sort((left, right) => right.heightIn - left.heightIn || right.widthIn - left.widthIn
        || order(left.name.toLowerCase(), right.name.toLowerCase()) || order(String(left.key), String(right.key)));

    const rows = buildRows(groups, usableWidth, gapIn);
    const sheets = balance(rows, usableLength, gapIn).map((sheetRows, index) => {
        const vertical = spread(sheetRows.length, sheetRows.reduce((sum, row) => sum + row.height, 0), lengthIn, marginIn, gapIn);
        const placements = [];
        const bands = [];
        let y = vertical.start;
        sheetRows.forEach((row, rowIndex) => {
            const across = spread(row.items.length, row.items.reduce((sum, item) => sum + item.widthIn, 0), widthIn, marginIn, gapIn);
            let x = across.start;
            for (const item of row.items) {
                placements.push({ ...item, row: rowIndex, x, y: y + (row.height - item.heightIn) / 2 });
                x += item.widthIn + across.gap;
            }
            bands.push({ y, height: row.height, count: row.items.length, gapIn: row.items.length > 1 ? across.gap : null });
            y += row.height + vertical.gap;
        });
        const gaps = [...bands.flatMap(band => band.gapIn ?? []), ...(bands.length > 1 ? [vertical.gap] : [])];
        const printed = placements.reduce((sum, item) => sum + item.widthIn * item.heightIn, 0);
        return {
            index, placements, rows: bands, cuts: cutLines(bands, placements, vertical.gap, widthIn, lengthIn),
            rowGapIn: bands.length > 1 ? vertical.gap : null,
            smallestGapIn: gaps.length ? Math.min(...gaps) : null,
            usedPercent: (printed / (widthIn * lengthIn)) * 100
        };
    });
    const smallest = sheets.flatMap(sheet => sheet.smallestGapIn ?? []);
    return {
        settings, sheets, tooBig,
        copies: sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0),
        meters: (sheets.length * lengthIn) / INCHES_PER_METER,
        smallestGapIn: smallest.length ? Math.min(...smallest) : null
    };
}

/**
 * Where to cut, for the on-screen guide only: across the sheet halfway between rows, then down the
 * middle of each gap inside a row, from cut to cut (or to the sheet's edge).
 */
function cutLines(bands, placements, rowGap, sheetWidth, sheetLength) {
    const cuts = [];
    const across = bands.slice(0, -1).map(band => band.y + band.height + rowGap / 2);
    for (const y of across) cuts.push({ x1: 0, y1: y, x2: sheetWidth, y2: y });
    bands.forEach((band, rowIndex) => {
        if (!band.gapIn) return;
        const top = rowIndex === 0 ? 0 : across[rowIndex - 1];
        const bottom = rowIndex === bands.length - 1 ? sheetLength : across[rowIndex];
        const items = placements.filter(item => item.row === rowIndex);
        for (const item of items.slice(0, -1)) {
            const x = item.x + item.widthIn + band.gapIn / 2;
            cuts.push({ x1: x, y1: top, x2: x, y2: bottom, row: rowIndex });
        }
    });
    return cuts;
}
