import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const useSupabaseTransactions = () => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch transactions from Supabase
    const fetchTransactions = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .order('date', { ascending: false });

            if (error) throw error;
            setTransactions(data || []);
        } catch (err) {
            console.error('Error fetching transactions:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Add a new transaction
    const addTransaction = async (transaction) => {
        try {
            const { data, error } = await supabase
                .from('transactions')
                .insert([transaction])
                .select()
                .single();

            if (error) throw error;

            // Update local state with functional update to avoid stale closures
            setTransactions(prev => [data, ...prev]);
            return data;
        } catch (err) {
            console.error('Error adding transaction:', err);
            setError(err.message);
            throw err;
        }
    };

    // Update a transaction
    const updateTransaction = async (id, updates) => {
        try {
            const { data, error } = await supabase
                .from('transactions')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            // Update local state
            setTransactions(prev => prev.map(t => t.id === id ? data : t));
            return data;
        } catch (err) {
            console.error('Error updating transaction:', err);
            setError(err.message);
            throw err;
        }
    };

    // Delete a transaction
    const deleteTransaction = async (id) => {
        try {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .eq('id', id);

            if (error) throw error;

            // Update local state
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (err) {
            console.error('Error deleting transaction:', err);
            setError(err.message);
            throw err;
        }
    };

    // Delete all transactions
    const deleteAllTransactions = async () => {
        try {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

            if (error) throw error;

            // Clear local state
            setTransactions([]);
        } catch (err) {
            console.error('Error deleting all transactions:', err);
            setError(err.message);
            throw err;
        }
    };

    // Migrate data from LocalStorage to Supabase
    const migrateFromLocalStorage = async () => {
        try {
            const localData = window.localStorage.getItem('sports-tech-transactions');
            if (!localData) return false;

            const parsedData = JSON.parse(localData);
            if (!Array.isArray(parsedData) || parsedData.length === 0) return false;

            console.log(`Migrating ${parsedData.length} transactions from LocalStorage...`);

            // Insert all transactions
            const { error } = await supabase
                .from('transactions')
                .insert(parsedData);

            if (error) throw error;

            // Clear LocalStorage after successful migration
            window.localStorage.removeItem('sports-tech-transactions');
            console.log('Migration complete!');

            return true;
        } catch (err) {
            console.error('Error migrating data:', err);
            setError(err.message);
            return false;
        }
    };

    // Initial load
    useEffect(() => {
        const init = async () => {
            // First, try to migrate any existing LocalStorage data
            const migrated = await migrateFromLocalStorage();

            // Then fetch all transactions
            await fetchTransactions();

            if (migrated) {
                // Reload to show migrated data
                await fetchTransactions();
            }
        };

        init();

        // Real-time Subscription
        const channel = supabase
            .channel('public:transactions')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'transactions' },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        setTransactions(prev => {
                            // Avoid duplicates if local state was already updated optimistically
                            if (prev.find(t => t.id === payload.new.id)) return prev;
                            return [payload.new, ...prev];
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        setTransactions(prev => prev.map(t => t.id === payload.new.id ? payload.new : t));
                    } else if (payload.eventType === 'DELETE') {
                        setTransactions(prev => prev.filter(t => t.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return {
        transactions,
        loading,
        error,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        deleteAllTransactions,
        refetch: fetchTransactions
    };
};

export default useSupabaseTransactions;
