import { useState, useCallback } from 'react';
import { apiRequest } from '../lib/apiClient';

export default function useCustomers() {
    const [loading, setLoading] = useState(false);
    const searchCustomers = useCallback(async query => {
        if (!query?.trim()) return [];
        const { customers } = await apiRequest(`/api/customers?q=${encodeURIComponent(query.trim())}`);
        if (!Array.isArray(customers)) throw new Error('Customer search could not be verified. Try again.');
        return customers;
    }, []);
    const upsertCustomer = useCallback(async (details, { requestId = crypto.randomUUID() } = {}) => {
        setLoading(true);
        try {
            const { customer } = await apiRequest('/api/customers', { method: 'POST', body: { details, requestId } });
            if (!customer?.id) throw new Error('The customer update could not be confirmed.');
            return customer;
        } finally {
            setLoading(false);
        }
    }, []);
    return { searchCustomers, upsertCustomer, loading };
}
