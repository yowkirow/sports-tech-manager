import { getOrderPricingOptions, priceOrder } from './orderPricing.js';

const money = value => Math.round(Number(value) * 100) / 100;

export const getEditableOrderItems = (order) => order.items.map(item => ({
    id: item.id,
    name: item.details.itemName,
    category: item.details.category,
    size: item.details.size,
    color: item.details.color,
    quantity: item.details.quantity,
    imageUrl: item.details.imageUrl
}));

export const priceOrderChanges = (order, drafts) => {
    if (!drafts.length) throw new Error('Order cannot be empty.');
    if (new Set(drafts.map(item => item.id)).size !== drafts.length) throw new Error('Order contains duplicate items.');
    const options = getOrderPricingOptions(order.items);
    const originals = new Map(order.items.map(item => [item.id, item]));
    const items = drafts.map(draft => {
        const original = originals.get(draft.id);
        if (!original) throw new Error('An order item no longer exists. Refresh before editing.');
        const details = original.details;
        const quantity = Number(draft.quantity ?? draft.details?.quantity);
        const originalShipping = details.shippingShare ?? (options.shippingLineId === original.id ? options.shippingFee : 0);
        const originalRush = Number(details.shippingDetails?.rushFee || 0);
        const adjustment = draft.productChanged ? 0 : money(Number(original.amount) -
            (Number(details.originalAmount) - Number(details.discountShare || 0) + originalRush + Number(originalShipping)));
        return {
            id: original.id,
            name: draft.name ?? draft.details?.itemName ?? details.itemName,
            category: draft.productChanged ? draft.details.category : details.category,
            quantity,
            unitPrice: Number(draft.productChanged ? draft.details.unitPrice : details.unitPrice),
            brand: draft.productChanged ? draft.details.brand : details.brand,
            imageUrl: draft.productChanged ? draft.details.imageUrl : details.imageUrl,
            size: draft.size ?? draft.details?.size ?? details.size,
            color: draft.color ?? draft.details?.color ?? details.color,
            priceAdjustment: draft.priceAdjustment ?? adjustment,
            originalAmount: details.originalAmount,
            preserveOriginalAmount: !draft.productChanged && quantity === Number(details.quantity),
            preserveUnitPrice: !draft.productChanged && quantity === Number(details.quantity)
        };
    });
    const preserveAllocations = items.length === order.items.length && items.every(item => item.preserveOriginalAmount);
    const priced = preserveAllocations
        ? priceOrder(items.map(item => ({ ...item, priceAdjustment: 0 })), { ...options, discount: null })
        : priceOrder(items, options);
    if (preserveAllocations) {
        // Address/status-only edits retain historical per-line allocations, not just the order total.
        priced.items = priced.items.map((item, index) => {
            const original = originals.get(item.id);
            const details = original.details;
            const shippingShare = Number(details.shippingShare ?? (options.shippingLineId === item.id ? options.shippingFee : 0));
            const rushFee = Number(details.shippingDetails?.rushFee || 0);
            const discountShare = Number(details.discountShare || 0);
            const priceAdjustment = Number(items[index].priceAdjustment);
            const amount = money(Number(details.originalAmount) - discountShare + shippingShare + rushFee + priceAdjustment);
            if (!Number.isFinite(amount)) throw new Error(`${item.name} amount must be a finite number.`);
            if (amount < 0) throw new Error(`${item.name} amount cannot be negative.`);
            return { ...item, originalAmount: Number(details.originalAmount), discountShare, shippingShare, rushFee, priceAdjustment, amount };
        });
        priced.discountAmount = money(priced.items.reduce((sum, item) => sum + item.discountShare, 0));
        priced.rushFeeAmount = money(priced.items.reduce((sum, item) => sum + item.rushFee, 0));
        priced.total = money(priced.items.reduce((sum, item) => sum + item.amount, 0));
    }
    return { ...priced, options };
};

export const buildOrderChanges = (order, drafts, commonDetails = {}, recordUpdates = {}) => {
    const priced = priceOrderChanges(order, drafts);
    const originals = new Map(order.items.map(item => [item.id, item]));
    const pricing = {
        version: 1,
        discount: priced.options.discount,
        shippingFee: priced.shippingFee,
        isRushOrder: priced.options.isRushOrder,
        rushFeePerShirt: priced.options.rushFeePerShirt,
        shippingLineId: priced.items.find(item => item.shippingShare > 0)?.id || priced.items[0].id
    };
    const byTransaction = new Map();
    priced.items.forEach(item => {
        const original = originals.get(item.id);
        const details = {
            ...original.details,
            ...commonDetails,
            itemName: item.name,
            brand: item.brand,
            category: item.category,
            imageUrl: item.imageUrl,
            size: item.size,
            color: item.color,
            linkedColor: item.color,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            originalAmount: item.originalAmount,
            discountShare: item.discountShare,
            shippingShare: item.shippingShare,
            priceAdjustment: item.priceAdjustment || 0,
            pricing,
            shippingDetails: {
                ...original.details.shippingDetails,
                ...commonDetails.shippingDetails,
                shippingFee: priced.shippingFee,
                isRushOrder: pricing.isRushOrder,
                rushFee: item.rushFee
            }
        };
        const transactionItems = byTransaction.get(original.transactionId) || [];
        transactionItems.push({ original, details, amount: item.amount });
        byTransaction.set(original.transactionId, transactionItems);
    });

    const changes = order.transactions.map(original => {
        const items = byTransaction.get(original.id) || [];
        let details;
        if (!items.length) {
            details = {
                ...original.details,
                removedFromOrder: true,
                quantity: 0,
                originalAmount: 0,
                discountShare: 0,
                shippingShare: 0,
                shippingDetails: { ...original.details.shippingDetails, rushFee: 0 }
            };
        } else if (Array.isArray(original.details?.items)) {
            details = {
                ...original.details,
                ...commonDetails,
                customerName: commonDetails.customerName ?? items[0].details.customerName,
                contactNumber: commonDetails.contactNumber ?? items[0].details.contactNumber,
                pricing,
                discountShare: money(items.reduce((sum, item) => sum + item.details.discountShare, 0)),
                shippingDetails: {
                    ...original.details.shippingDetails,
                    ...items[0].details.shippingDetails,
                    rushFee: money(items.reduce((sum, item) => sum + item.details.shippingDetails.rushFee, 0))
                },
                items: items.map(item => ({
                    ...original.details.items[item.original.itemIndex],
                    name: item.details.itemName,
                    itemName: item.details.itemName,
                    brand: item.details.brand,
                    category: item.details.category,
                    imageUrl: item.details.imageUrl,
                    size: item.details.size,
                    color: item.details.color,
                    linkedColor: item.details.color,
                    quantity: item.details.quantity,
                    price: item.details.unitPrice,
                    unitPrice: item.details.unitPrice,
                    originalAmount: item.details.originalAmount,
                    discountShare: item.details.discountShare,
                    shippingShare: item.details.shippingShare,
                    priceAdjustment: item.details.priceAdjustment,
                    shippingDetails: { rushFee: item.details.shippingDetails.rushFee },
                    amount: item.amount
                }))
            };
        } else {
            details = items[0].details;
        }
        return {
            id: original.id,
            original,
            updates: {
                ...recordUpdates,
                ...(!Array.isArray(original.details?.items) && items.length ? { category: details.category } : {}),
                amount: money(items.reduce((sum, item) => sum + item.amount, 0)),
                details
            }
        };
    });
    return { ...priced, changes };
};

export const buildOrderDetailChanges = (order, updateDetails) => order.transactions.map(original => ({
    id: original.id,
    original,
    updates: {
        amount: Number(original.amount),
        details: updateDetails(original.details)
    }
}));

export const saveOrderChanges = async (client, changes, { requirePending = false } = {}) => {
    if (!Array.isArray(changes) || changes.length === 0) throw new Error('Order cannot be empty.');
    if (changes.some(change => !change?.id || change.original?.id !== change.id || !change.updates)) {
        throw new Error('Order contains an invalid source transaction.');
    }
    const ids = new Set(changes.map(change => change.id));
    if (ids.size !== changes.length) throw new Error('Order contains duplicate source transactions.');

    const { data, error } = await client.rpc('save_order_changes', {
        p_changes: changes.map(({ id, original, updates }) => ({
            id,
            expected: {
                type: original.type,
                category: original.category,
                amount: original.amount,
                date: original.date,
                description: original.description ?? null,
                details: original.details
            },
            updates
        })),
        p_require_pending: requirePending
    });
    if (error) {
        if (error.code === '40001') throw new Error('This order changed while you were editing. No changes were saved. Reload before retrying.', { cause: error });
        if (['22023', '42501'].includes(error.code)) throw new Error(`${error.message} No changes were saved.`, { cause: error });
        // A lost response can follow a committed transaction: reload instead of claiming a rollback.
        throw new Error('The order save could not be confirmed. Reload before retrying.', { cause: error });
    }
    if (!Array.isArray(data) || data.length !== ids.size || new Set(data.map(row => row?.id)).size !== ids.size
        || data.some(row => !ids.has(row?.id))) {
        throw new Error('The complete order save could not be confirmed. Reload before retrying.');
    }
};
