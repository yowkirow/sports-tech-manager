import { apiRequest } from './apiClient.js';
export { getEditableOrderItems, priceOrderChanges, buildOrderChanges, buildOrderDetailChanges } from './orderEditingPure.js';

export const saveOrderChanges = async (changes, {
    requirePending = false,
    packingConfirmed,
    requestId = crypto.randomUUID(),
    save = body => apiRequest('/api/orders/save', { method: 'POST', body })
} = {}) => {
    if (!Array.isArray(changes) || changes.length === 0) throw new Error('Order cannot be empty.');
    if (changes.some(change => !change?.id || change.original?.id !== change.id || !change.updates)) {
        throw new Error('Order contains an invalid source transaction.');
    }
    const ids = new Set(changes.map(change => change.id));
    if (ids.size !== changes.length) throw new Error('Order contains duplicate source transactions.');

    const orderId = changes[0].original.details?.orderId || changes[0].original.id;
    const expectedVersion = changes[0].original.orderVersion;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0
        || changes.some(({ original }) => (original.details?.orderId || original.id) !== orderId || original.orderVersion !== expectedVersion)) {
        throw new Error('The order version is unavailable or inconsistent. Reload before editing.');
    }
    const body = {
        orderId,
        expectedVersion,
        requestId,
        changes: changes.map(({ id, original, updates }) => ({
            id,
            expected: {
                type: original.type,
                category: original.category,
                amount: original.amountExact ?? original.amount,
                date: original.date,
                description: original.description ?? null,
                details: original.details
            },
            updates: {
                ...updates,
                ...(updates.amount !== undefined && Number(updates.amount) === Number(original.amount)
                    ? { amount: original.amountExact ?? original.amount } : {})
            }
        })),
        requirePending
    };
    if (packingConfirmed !== undefined) body.packingConfirmed = packingConfirmed;
    let data;
    try {
        data = await save(body);
    } catch (error) {
        if (error.code === 'invalid_response') {
            throw new Error('The order save could not be confirmed. Reload before retrying.', { cause: error });
        }
        if (error.status === 409 || error.code === '40001') {
            const reason = error.message || 'This order changed while you were editing.';
            throw new Error(`${reason} No changes were saved. Review the order before retrying.`, { cause: error });
        }
        if ([400, 401, 403, 404, 422].includes(error.status) || ['22023', '42501'].includes(error.code)) {
            throw new Error(`${error.message} No changes were saved.`, { cause: error });
        }
        throw new Error('The order save could not be confirmed. Reload before retrying.', { cause: error });
    }
    if (data?.orderId !== orderId || !Number.isSafeInteger(data.version) || data.version !== expectedVersion + 1
        || !Array.isArray(data.ids) || data.ids.length !== ids.size || new Set(data.ids).size !== ids.size
        || data.ids.some(id => !ids.has(id))) {
        throw new Error('The complete order save could not be confirmed. Reload before retrying.');
    }
    return data;
};
