export class ApiError extends Error {
    constructor(message, status, code, details = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const PIN_REQUIRED_EVENT = 'sportstech:pin-required';
export const PIN_UNLOCKED_EVENT = 'sportstech:pin-unlocked';

async function decodeResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new ApiError('The response could not be verified. Reload and sign in again.', response.status, 'invalid_response');
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new ApiError('The response could not be verified. Reload before retrying.', response.status, 'invalid_response');
    }
    if (!response.ok) {
        const code = data?.error?.code;
        // The server enforces the daily PIN; let the workspace show the PIN screen.
        if ((code === 'pin_required' || code === 'pin_setup_required') && typeof window !== 'undefined') {
            window.dispatchEvent(new Event(PIN_REQUIRED_EVENT));
        }
        throw new ApiError(data?.error?.message || 'The request failed. Please try again.', response.status, code, data?.error || {});
    }
    return data;
}

async function requestJson(path, options) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) throw new TypeError('Use a same-origin API path.');
    let response;
    try { response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error' }); }
    catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new ApiError('Unable to reach the app. Check your connection or reload to sign in again.', 0, 'network_error');
    }
    return decodeResponse(response);
}

export async function apiRequest(path, { body, headers, ...options } = {}) {
    return requestJson(path, {
        ...options,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
}

export const api = {
    getSession: () => apiRequest('/api/session'),
    getCurrentUser: async () => {
        const { member, profile = {} } = await apiRequest('/api/session');
        return { id: member.id, email: member.email, user_metadata: { ...profile, role: member.role } };
    },
    getProfile: () => apiRequest('/api/profile'),
    updateProfile: updates => apiRequest('/api/profile', { method: 'PATCH', body: updates }),
    logout: () => { window.location.assign('/cdn-cgi/access/logout'); },
    pin: {
        setup: pin => apiRequest('/api/pin/setup', { method: 'POST', body: { pin } }),
        unlock: pin => apiRequest('/api/pin/unlock', { method: 'POST', body: { pin } }),
        change: (currentPin, pin) => apiRequest('/api/pin/change', { method: 'POST', body: { currentPin, pin } }),
        reset: pin => apiRequest('/api/pin/reset', { method: 'POST', body: { pin } }),
        lock: () => apiRequest('/api/pin/lock', { method: 'POST', body: {} })
    },
    uploadProductImage: async file => {
        return requestJson('/api/media/products', {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
        });
    },
    sendSms: details => apiRequest('/api/sms', { method: 'POST', body: { requestId: crypto.randomUUID(), ...details } })
};
