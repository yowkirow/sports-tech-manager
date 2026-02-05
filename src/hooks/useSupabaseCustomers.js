import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const useSupabaseCustomers = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);

    // Search customers by name
    const searchCustomers = useCallback(async (query) => {
        if (!query) return [];
        try {
            const { data, error } = await supabase
                .from('customers')
                .select('*')
                .ilike('name', `%${query}%`)
                .limit(5);

            if (error) throw error;
            return data;
        } catch (err) {
            console.error('Error searching customers:', err);
            return [];
        }
    }, []);

    // Create or Update Customer
    // Checks if name exists. If so, updates fields. If not, creates new.
    const upsertCustomer = async (details) => {
        try {
            setLoading(true);
            const { name, contact_number, address, total_spent } = details;

            // Check if exists
            const { data: existing } = await supabase
                .from('customers')
                .select('id, total_spent')
                .eq('name', name)
                .single();

            let result;
            if (existing) {
                // Update
                const { data, error } = await supabase
                    .from('customers')
                    .update({
                        contact_number: contact_number || undefined,
                        address: address || undefined,
                        total_spent: (existing.total_spent || 0) + (total_spent || 0)
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            } else {
                // Insert
                const { data, error } = await supabase
                    .from('customers')
                    .insert([{
                        name,
                        contact_number,
                        address,
                        total_spent: total_spent || 0
                    }])
                    .select()
                    .single();
                if (error) throw error;
                result = data;
            }
            return result;
        } catch (err) {
            console.error('Error saving customer:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        searchCustomers,
        upsertCustomer,
        loading
    };
};

export default useSupabaseCustomers;
