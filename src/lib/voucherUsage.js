import { isReturnedSale } from './transactionStatus.js';

export const getVoucherUsage = (transactions) => {
    const ordersByCode = new Map();
    for (const transaction of transactions) {
        const code = transaction.details?.voucherCode;
        if (transaction.type !== 'sale' || isReturnedSale(transaction) || !code) continue;

        if (!ordersByCode.has(code)) ordersByCode.set(code, new Set());
        const orderId = transaction.details.orderId;
        ordersByCode.get(code).add(orderId ? `order:${orderId}` : `transaction:${transaction.id}`);
    }
    return new Map([...ordersByCode].map(([code, orders]) => [code, orders.size]));
};
