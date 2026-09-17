import { useState, useCallback } from 'react';
import { apiRequest } from '../lib/apiClient';

export const useActivityLog = () => {
    const [logging, setLogging] = useState(false);

    const logActivity = useCallback(async (action, details = null, entityId = null) => {
        setLogging(true);
        try {
            await apiRequest('/api/activity', { method: 'POST', body: { action, details, entityId } });

        } catch (err) {
            console.error('Failed to log activity:', err);
            // Don't block UI for logging failures
        } finally {
            setLogging(false);
        }
    }, []);

    return { logActivity, logging };
};
