export const getFulfillmentStatus = (transaction) => (
    transaction?.details?.fulfillmentStatus || transaction?.details?.status || ''
).toLowerCase();

export const isReturnedSale = (transaction) => (
    transaction?.type === 'sale' && getFulfillmentStatus(transaction) === 'returned'
);
