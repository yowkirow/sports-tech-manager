export const getFulfillmentStatus = (transaction) => (
    transaction?.details?.fulfillmentStatus || transaction?.details?.status || ''
).toLowerCase();

export const isReturnedSale = (transaction) => (
    transaction?.type === 'sale' && getFulfillmentStatus(transaction) === 'returned'
);

// Returned and cancelled orders stay on record, but neither is a sale.
export const isVoidedSale = (transaction) => (
    transaction?.type === 'sale' && ['returned', 'cancelled'].includes(getFulfillmentStatus(transaction))
);
