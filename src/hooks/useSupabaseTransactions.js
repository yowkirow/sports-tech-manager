import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { createTransactionSync, fetchTransactionHistory, insertTransactionBatch } from '../lib/transactionSync';

let nextChannelId = 0;
let migrationPromise = null;

const migrateFromLocalStorage = () => {
    if (!migrationPromise) {
        migrationPromise = (async () => {
            const localData = window.localStorage.getItem('sports-tech-transactions');
            if (!localData) return;

            const parsedData = JSON.parse(localData);
            if (!Array.isArray(parsedData)) throw new Error('Stored transactions are not a valid transaction array.');
            if (parsedData.length === 0) return;

            const { error } = await supabase.from('transactions').insert(parsedData);
            if (error) throw error;
            window.localStorage.removeItem('sports-tech-transactions');
        })().finally(() => {
            migrationPromise = null;
        });
    }
    return migrationPromise;
};

const useSupabaseTransactions = ({ enabled = true } = {}) => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const syncRef = useRef(null);

    const fetchTransactions = useCallback(() => syncRef.current?.refresh() ?? Promise.resolve(), []);

    const addTransactions = useCallback(async (newTransactions) => {
        const sync = syncRef.current;
        try {
            const data = await insertTransactionBatch(supabase, newTransactions);
            sync?.apply({ type: 'upsert', rows: data });
            return data;
        } catch (err) {
            sync?.reportError(err);
            throw err;
        }
    }, []);

    const addTransaction = useCallback(async (transaction) => {
        const [saved] = await addTransactions([transaction]);
        return saved;
    }, [addTransactions]);

    const updateTransaction = useCallback(async (id, updates) => {
        const sync = syncRef.current;
        try {
            const { data, error } = await supabase
                .from('transactions')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            if (!data || data.id !== id) throw new Error('The updated transaction could not be verified. Please refresh.');
            sync?.apply({ type: 'upsert', rows: [data] });
            return data;
        } catch (err) {
            sync?.reportError(err);
            throw err;
        }
    }, []);

    const deleteTransaction = useCallback(async (id) => {
        const sync = syncRef.current;
        try {
            const { error } = await supabase.from('transactions').delete().eq('id', id);
            if (error) throw error;
            sync?.apply({ type: 'delete', ids: [id] });
        } catch (err) {
            sync?.reportError(err);
            throw err;
        }
    }, []);

    const deleteAllTransactions = useCallback(async () => {
        const sync = syncRef.current;
        try {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000');
            if (error) throw error;
            sync?.apply({ type: 'clear' });
        } catch (err) {
            sync?.reportError(err);
            throw err;
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            setTransactions([]);
            setLoading(false);
            setError(null);
            return;
        }

        const sync = createTransactionSync({
            // Share an in-progress migration across StrictMode setups, then fetch only once.
            prepare: migrateFromLocalStorage,
            read: signal => fetchTransactionHistory(supabase, { signal }),
            onTransactions: setTransactions,
            onLoading: setLoading,
            onError: err => setError(err ? (err.message || String(err)) : null)
        });
        syncRef.current = sync;
        sync.refresh();

        const channel = supabase
            .channel(`transaction-changes-${++nextChannelId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'transactions' },
                (payload) => {
                    if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && payload.new?.id != null) {
                        sync.apply({ type: 'upsert', rows: [payload.new] });
                    } else if (payload.eventType === 'DELETE' && payload.old?.id != null) {
                        sync.apply({ type: 'delete', ids: [payload.old.id] });
                    }
                }
            )
            .subscribe((status, subscriptionError) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('Transaction live updates disconnected:', subscriptionError || status);
                }
            });

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') sync.refresh();
        };
        const handleReload = () => sync.refresh();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleReload);
        window.addEventListener('online', handleReload);

        return () => {
            sync.dispose();
            if (syncRef.current === sync) syncRef.current = null;
            void supabase.removeChannel(channel);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleReload);
            window.removeEventListener('online', handleReload);
        };
    }, [enabled]);

    return {
        transactions,
        loading: enabled && loading,
        error,
        addTransaction,
        addTransactions,
        updateTransaction,
        deleteTransaction,
        deleteAllTransactions,
        refetch: fetchTransactions
    };
};

export default useSupabaseTransactions;
