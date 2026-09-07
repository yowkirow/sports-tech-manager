const numberOr = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

export const getOrderId = (transaction) => transaction.details?.orderId || transaction.id;
export const createOrderId = () => `ST-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;

export const getItemCategory = (item, fallback = '') => {
    const category = (item.category || fallback).trim().toLowerCase();
    if (category === 'shirts' || category === 'blanks') return 'shirts';
    if (category && !['sales', 'sale', 'general'].includes(category)) return category;
    return item.size && item.size !== 'N/A' ? 'shirts' : 'accessories';
};

const allocateAmount = (amount, weights) => {
    if (!weights.length) return [];
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const totalCents = Math.round(amount * 100);
    const shares = weights.map(weight => totalCents * (totalWeight ? weight / totalWeight : 1 / weights.length));
    const cents = shares.map(Math.floor);
    const ranked = shares.map((share, index) => ({ index, fraction: share - cents[index] }))
        .sort((left, right) => right.fraction - left.fraction);
    const remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < remainder; index++) cents[ranked[index].index]++;
    return cents.map(value => value / 100);
};

export const getSaleItems = (transaction) => {
    const parent = transaction.details || {};
    if (transaction.type !== 'sale' || parent.club === 'downtown-dinks' || parent.removedFromOrder) return [];

    const { items: nestedItems, ...common } = parent;
    const nested = Array.isArray(nestedItems);
    const sourceItems = nested ? nestedItems : [parent];
    const contactNumber = parent.contactNumber || parent.shippingDetails?.contactNumber || parent.customerContact || '';
    const shippingDetails = {
        address: parent.customerAddress || '',
        city: parent.customerCity || '',
        province: parent.customerProvince || '',
        barangay: parent.customerBarangay || '',
        region: parent.shippingRegion || '',
        ...parent.shippingDetails,
        contactNumber
    };

    const lines = sourceItems.map((source, index) => {
        const item = source.details || source;
        const quantity = numberOr(item.quantity, 1);
        const originalAmount = numberOr(item.originalAmount,
            numberOr(item.unitPrice ?? item.price, nested ? 0 : numberOr(transaction.amount, 0) / (quantity || 1)) * quantity);
        return {
            ...transaction,
            id: nested ? `${transaction.id}:${index}` : transaction.id,
            transactionId: transaction.id,
            itemIndex: nested ? index : null,
            details: {
                ...item,
                ...common,
                customerName: parent.customerName || parent.customer || 'Unknown',
                contactNumber,
                shippingDetails: { ...item.shippingDetails, ...shippingDetails, contactNumber },
                orderId: getOrderId(transaction),
                itemName: item.itemName || item.name || transaction.description || 'Unknown Item',
                imageUrl: item.imageUrl || parent.imageUrl,
                brand: item.brand || parent.brand || 'Sypik',
                category: getItemCategory(item, transaction.category),
                size: item.size || 'N/A',
                color: item.linkedColor || item.color || parent.linkedColor || parent.color || '',
                quantity,
                unitPrice: numberOr(item.unitPrice ?? item.price, originalAmount / (quantity || 1)),
                originalAmount
            }
        };
    });

    if (nested) {
        const weights = lines.map(line => Math.max(0, line.details.originalAmount));
        const amounts = allocateAmount(numberOr(transaction.amount, 0), weights);
        const discounts = allocateAmount(numberOr(parent.discountShare, 0), weights);
        const rushWeights = lines.map(line => line.details.category === 'shirts' ? Math.max(0, line.details.quantity) : 0);
        const rushFees = allocateAmount(numberOr(shippingDetails.rushFee, 0), rushWeights);
        const savedAmounts = sourceItems.map(item => numberOr(item.amount, NaN));
        const hasSavedAmounts = savedAmounts.every(Number.isFinite)
            && Math.round(savedAmounts.reduce((sum, value) => sum + value, 0) * 100) === Math.round(numberOr(transaction.amount, 0) * 100);
        lines.forEach((line, index) => {
            line.amount = hasSavedAmounts ? savedAmounts[index] : amounts[index];
            line.details.discountShare = numberOr(sourceItems[index].discountShare, discounts[index]);
            line.details.shippingShare = numberOr(sourceItems[index].shippingShare, index === 0 ? numberOr(shippingDetails.shippingFee, 0) : 0);
            line.details.shippingDetails.rushFee = numberOr(sourceItems[index].shippingDetails?.rushFee, rushFees[index]);
        });
    }
    return lines;
};

export const groupOrders = (transactions) => {
    const groups = new Map();
    for (const transaction of transactions) {
        const items = getSaleItems(transaction);
        if (items.length === 0) continue;
        const details = items[0].details;
        const id = getOrderId(transaction);
        if (!groups.has(id)) {
            const legacyStatus = details.status || 'paid';
            groups.set(id, {
                id,
                date: transaction.date,
                customerName: details.customerName,
                fulfillmentStatus: details.fulfillmentStatus || (legacyStatus === 'paid' ? 'pending' : legacyStatus),
                paymentStatus: details.paymentStatus || (legacyStatus === 'paid' ? 'paid' : 'unpaid'),
                paymentMode: details.paymentMode || 'Cash',
                isOnlineOrder: false,
                isRushOrder: false,
                comments: details.comments || [],
                transactions: [],
                items: [],
                totalAmount: 0,
                subtotal: 0,
                discountAmount: 0,
                paidAmount: 0,
                shippingFee: 0,
                totalRushFee: 0
            });
        }
        const order = groups.get(id);
        order.transactions.push(transaction);
        order.items.push(...items);
        order.totalAmount += numberOr(transaction.amount, 0);
        order.subtotal += items.reduce((sum, item) => sum + item.details.originalAmount, 0);
        order.discountAmount += items.reduce((sum, item) => sum + numberOr(item.details.discountShare, 0), 0);
        if ((details.paymentStatus || (!details.status || details.status === 'paid' ? 'paid' : 'unpaid')) === 'paid') {
            order.paidAmount += numberOr(transaction.amount, 0);
        }
        order.isOnlineOrder ||= Boolean(details.isOnlineOrder);
        order.isRushOrder ||= Boolean(details.isRushOrder || details.shippingDetails?.isRushOrder);
        order.shippingFee = Math.max(order.shippingFee, numberOr(details.shippingDetails?.shippingFee, 0));
        order.totalRushFee += items.reduce((sum, item) => sum + numberOr(item.details.shippingDetails?.rushFee, 0), 0);
    }
    return [...groups.values()].map(order => ({
        ...order,
        details: { ...order.items[0].details, fulfillmentStatus: order.fulfillmentStatus, paymentStatus: order.paymentStatus },
        totalAmount: Math.round(order.totalAmount * 100) / 100,
        priceAdjustment: Math.round((order.totalAmount - order.subtotal + order.discountAmount - order.shippingFee - order.totalRushFee) * 100) / 100
    })).sort((left, right) => new Date(right.date) - new Date(left.date));
};
