export const getCheckoutStatuses = (role, paymentStatus = 'paid', fulfillmentStatus = 'pending') => {
    if (role !== 'owner' && role !== 'reseller') throw new Error('Your account cannot create orders.');
    if (role === 'reseller') return { paymentStatus: 'unpaid', fulfillmentStatus: 'pending', status: 'pending' };
    return { paymentStatus, fulfillmentStatus, status: fulfillmentStatus };
};
