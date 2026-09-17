import { apiRequest, ApiError } from './apiClient.js';

const tokenKey = id => `sportstech.tracking.${id}`;
export const rememberTracking = (id, token) => {
    try { sessionStorage.setItem(tokenKey(id), token); } catch { /* Verification remains available when storage is disabled. */ }
};
export const trackingToken = id => {
    try { return sessionStorage.getItem(tokenKey(id)); } catch { return null; }
};
export const trackOrder = async (contact, orderId) => {
    const result = await apiRequest('/api/public/track', { method: 'POST', body: { contact, ...(orderId ? { orderId } : {}) } });
    rememberTracking(result.order.id, result.token);
    return result;
};
export const refreshTrackedOrder = (id, token = trackingToken(id)) => apiRequest(`/api/public/orders/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token || ''}` }
});
export const saveTrackedOrder = async (id, intent, token = trackingToken(id)) => {
    const result = await apiRequest(`/api/public/orders/${encodeURIComponent(id)}/save`, {
        method: 'POST', body: intent, headers: { Authorization: `Bearer ${token || ''}` }
    });
    rememberTracking(id, result.token);
    return result;
};
export const uploadReceipt = async file => {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a receipt image smaller than 5 MiB.');
    const response = await fetch('/api/public/receipts', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The upload could not be verified. Try again.');
    const result = await response.json();
    if (!response.ok) throw new ApiError(result.error?.message || 'Receipt upload failed.', response.status, result.error?.code);
    return result;
};
