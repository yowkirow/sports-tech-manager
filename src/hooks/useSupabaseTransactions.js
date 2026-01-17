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

            // Update local state
            setTransactions([data, ...transactions]);
            return data;
        } catch (err) {
            console.error('Error adding transaction:', err);
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
            setTransactions(transactions.filter(t => t.id !== id));
        } catch (err) {
            console.error('Error deleting transaction:', err);
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
    }, []);

    return {
        transactions,
        loading,
        error,
        addTransaction,
        deleteTransaction,
        refetch: fetchTransactions
    };
};

export default useSupabaseTransactions;
