// What the shop tells the Meta Pixel. A product is named by its Meta catalog item ID, which is its
// link slug. Never add a customer's name, mobile number, address, email or order number.
import { isBallProduct } from './orderPricing.js';

const money = value => {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};
const BULK_LISTING = /\bper piece\b/i;

/**
 * Meta catalog item IDs by product name: each product's link slug, except the ball's bulk-price
 * listings ("Nelson Balls (21-49) (Php 90 per piece)"). They aren't in the Meta catalog, so they
 * count as the main ball.
 */
export function catalogIds(products, slugs) {
    const ids = new Map((products || []).map(product => [product.name, slugs.get(product.name)]));
    const mainBall = (products || []).find(product => isBallProduct(product) && !BULK_LISTING.test(product.name));
    if (mainBall) {
        for (const product of products) {
            if (isBallProduct(product) && BULK_LISTING.test(product.name)) ids.set(product.name, slugs.get(mainBall.name));
        }
    }
    return ids;
}

/** ViewContent: one product opened in the shop. */
export function productView(product, slug) {
    return {
        content_ids: [slug], content_type: 'product', content_name: String(product?.name ?? ''),
        value: money(product?.price), currency: 'PHP'
    };
}

/** Bag lines as catalog IDs and quantities; sizes of one design share its ID. */
export function bagContents(items, slugFor) {
    const lines = new Map();
    for (const item of items || []) {
        const id = slugFor(item);
        const quantity = Number(item?.quantity);
        if (!id || !Number.isFinite(quantity) || quantity <= 0) continue;
        lines.set(id, (lines.get(id) || 0) + quantity);
    }
    return [...lines].map(([id, quantity]) => ({ id, quantity }));
}

/** AddToCart, InitiateCheckout and Purchase: the lines and the peso value, nothing about the buyer. */
export function bagEvent(items, slugFor, value) {
    const contents = bagContents(items, slugFor);
    return {
        content_ids: contents.map(line => line.id), content_type: 'product', contents,
        num_items: contents.reduce((sum, line) => sum + line.quantity, 0), value: money(value), currency: 'PHP'
    };
}
