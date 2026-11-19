// Cash on delivery is not offered for bulk ball orders (owner request 2026-11-19). An order is a bulk ball order once
// it holds BULK_BALL_QUANTITY balls or more, counted across the whole order the way ball shipping counts them. The shop
// shows the notice, checkout and customer order edits enforce it, and the owner's own tools are left alone.
import { BULK_BALL_QUANTITY, isBallProduct } from './orderPricing.js';

export const COD_BULK_BALLS_NOTICE = `Cash on delivery isn't available for orders of ${BULK_BALL_QUANTITY} or more balls. Pay by GCash or bank transfer.`;
export const COD_BULK_BALLS_EDIT_NOTICE = `Cash on delivery isn't available for orders of ${BULK_BALL_QUANTITY} or more balls, so this order can't grow to that size. Place a new order and pay by GCash or bank transfer.`;

const quantityOf = item => {
    const quantity = Number(item?.quantity ?? item?.details?.quantity);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
};

/** How many balls these order lines hold. A line reads its quantity from `quantity`, or from its `details`. */
export const ballCount = items => (Array.isArray(items) ? items : [])
    .reduce((sum, item) => (isBallProduct(item) ? sum + quantityOf(item) : sum), 0);

export const isBulkBallCount = count => count >= BULK_BALL_QUANTITY;

/** Whether a new order of these lines may be paid cash on delivery. */
export const codAllowed = items => !isBulkBallCount(ballCount(items));

/**
 * The message for a customer's edit that would make a cash-on-delivery order a bulk ball order, or null. An older order
 * that is already that size may keep or shrink its balls, so only growing into it (or beyond) is refused.
 * `drafts` are the edited lines, { id, quantity }; a line left out is removed.
 */
export function codEditProblem(order, drafts) {
    if (order?.paymentMode !== 'COD') return null;
    const quantities = new Map((drafts || []).map(draft => [draft.id, draft.quantity]));
    const before = ballCount(order.items);
    const after = ballCount(order.items.map(item => ({ ...item, quantity: quantities.get(item.id) ?? 0 })));
    return isBulkBallCount(after) && after > before ? COD_BULK_BALLS_EDIT_NOTICE : null;
}
