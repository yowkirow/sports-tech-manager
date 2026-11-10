// Shipping fees for shop orders. Every order pays LBC's flat fee for its area (₱100 Metro Manila, ₱200
// provincial). Pickleball balls cost more to ship than that covers (owner request 2026-11-10), so the owner can set
// ball shipping by how many balls an order has, in each area. With those rates set, balls pay them on top of the flat
// fee for the rest of the order, and an order of only balls pays only ball shipping. With none set, balls ride the
// flat fee as they always did. The rates in force are the newest `shipping_rates` record in the transaction history.
import { isBallProduct } from './orderPricing.js';

export const SHIPPING_REGIONS = ['MM', 'Provincial'];
export const FLAT_SHIPPING = { MM: 100, Provincial: 200 };
export const MAX_SHIPPING_FEE = 100000;
export const MAX_BALL_TIERS = 12;
export const MAX_TIER_START = 100000;

const wholePesos = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SHIPPING_FEE;
const tierStart = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_TIER_START;

/** Sorted by where each tier starts; null unless the first starts at 1 ball and no two start at the same count. */
function ordered(tiers) {
    const sorted = [...tiers].sort((left, right) => left.from - right.from);
    return sorted[0]?.from === 1 && sorted.every((tier, index) => !index || tier.from > sorted[index - 1].from) ? sorted : null;
}

/**
 * The ball tiers in a `shipping_rates` record's details: [{ from, mm, provincial }] in whole pesos, sorted by `from`,
 * the first from 1 ball. Anything malformed reads as no rates ([]), so a bad record can never break checkout.
 */
export function ballShippingTiers(details) {
    const list = details?.balls;
    if (!Array.isArray(list) || !list.length || list.length > MAX_BALL_TIERS) return [];
    const tiers = list.map(tier => ({ from: tier?.from, mm: tier?.mm, provincial: tier?.provincial }));
    if (!tiers.every(tier => tierStart(tier.from) && wholePesos(tier.mm) && wholePesos(tier.provincial))) return [];
    return ordered(tiers) ?? [];
}

/** The ball tiers in force: the newest `shipping_rates` record in a newest-first transaction feed. */
export function currentBallTiers(transactions = []) {
    const latest = transactions.find(transaction => transaction?.type === 'shipping_rates');
    return latest ? ballShippingTiers(latest.details) : [];
}

/** How an order to one area pays for shipping. Saved with the order, so a later quantity change reprices the same way. */
export function shippingPlan(tiers, region) {
    if (!SHIPPING_REGIONS.includes(region)) throw new Error('Choose a shipping region.');
    const key = region === 'MM' ? 'mm' : 'provincial';
    return { flatFee: FLAT_SHIPPING[region], ballTiers: (tiers || []).map(tier => ({ from: tier.from, fee: tier[key] })) };
}

/** A plan read back from an order's saved pricing, or null when it has none or it doesn't hold together. */
export function savedShippingPlan(value) {
    if (!value || typeof value !== 'object' || !wholePesos(value.flatFee)) return null;
    const list = value.ballTiers;
    if (!Array.isArray(list) || !list.length || list.length > MAX_BALL_TIERS) return null;
    const tiers = list.map(tier => ({ from: tier?.from, fee: tier?.fee }));
    if (!tiers.every(tier => tierStart(tier.from) && wholePesos(tier.fee))) return null;
    const sorted = ordered(tiers);
    return sorted ? { flatFee: value.flatFee, ballTiers: sorted } : null;
}

/** The fee for a number of balls: the last tier that count reaches. */
export function ballFee(ballTiers, count) {
    let fee = 0;
    for (const tier of ballTiers) if (count >= tier.from) fee = tier.fee;
    return fee;
}

const quantityOf = item => {
    const quantity = Number(item?.quantity);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
};

/**
 * Shipping for these items under a plan, in pesos: { flat, balls, ballCount, total }. Without ball tiers the flat fee
 * covers everything, as before; with them, balls pay by count and the flat fee covers the rest, if any.
 */
export function shippingFor(items, plan) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { flat: 0, balls: 0, ballCount: 0, total: 0 };
    if (!plan?.ballTiers?.length) return { flat: plan.flatFee, balls: 0, ballCount: 0, total: plan.flatFee };
    const ballCount = list.filter(item => isBallProduct(item)).reduce((sum, item) => sum + quantityOf(item), 0);
    const flat = list.some(item => !isBallProduct(item)) ? plan.flatFee : 0;
    const balls = ballCount ? ballFee(plan.ballTiers, ballCount) : 0;
    return { flat, balls, ballCount, total: flat + balls };
}
