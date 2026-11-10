// Print sizes for DTF designs (owner request 2026-11-10): a design is sized by its width or by its height, and
// the other follows its shape. The limits are the gallery's, which worker/dtf-api.ts checks in whole thousandths
// of an inch: 0.1 to 60 in wide and 0.1 to 120 in tall.

export const MIN_SIZE_IN = 0.1;
export const MAX_WIDTH_IN = 60;
export const MAX_HEIGHT_IN = 120;

const mils = inches => Math.round(inches * 1000);

/**
 * The print widths a design of this shape (ratio = height / width) can take within the limits, or null when
 * none can: a hairline so thin or so tall that no width keeps both sides in range.
 */
export function widthLimits(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const min = Math.max(MIN_SIZE_IN, MIN_SIZE_IN / ratio);
    const max = Math.min(MAX_WIDTH_IN, MAX_HEIGHT_IN / ratio);
    return min <= max ? { min, max } : null;
}

/** A width moved inside the limits for its shape; unchanged when it is already inside, or when nothing fits. */
export function clampWidth(widthIn, ratio) {
    const limits = widthLimits(ratio);
    return limits ? Math.min(limits.max, Math.max(limits.min, widthIn)) : widthIn;
}

/** Why the gallery would refuse this size, or null when it takes it. Rounds as the server does. */
export function sizeProblem(widthIn, heightIn) {
    if (!(mils(widthIn) >= 100 && mils(heightIn) >= 100)) return 'At this size the design is too thin to print. Make it bigger.';
    if (mils(widthIn) > MAX_WIDTH_IN * 1000) return `At this size the design is wider than ${MAX_WIDTH_IN} in. Make it smaller.`;
    if (mils(heightIn) > MAX_HEIGHT_IN * 1000) return `At this size the design is taller than ${MAX_HEIGHT_IN} in. Make it smaller.`;
    return null;
}
