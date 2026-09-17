import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import { createTransactionSync } from '../lib/transactionSync';
import { createTransactionMutations, fetchApiTransactionHistory, hasLegacyTransactionCache } from '../lib/transactionApi';

const useTransactions = ({ enabled = false, accountId } = {}) => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const [legacyCache, setLegacyCache] = useState(false);
    const syncRef = useRef(null);
    const mutationsRef = useRef(null);

    const refetch = useCallback(() => syncRef.current?.refresh() ?? Promise.resolve(), []);
    const mutate = useCallback(async (method, ...args) => {
        const sync = syncRef.current;
        if (!sync || !mutationsRef.current) throw new Error('Sign in and load your workspace before saving.');
        try {
            const result = await mutationsRef.current[method](...args);
            sync.reportError(null);
            return result;
        } catch (err) {
            sync.reportError(err);
            throw err;
        }
    }, []);
    const addTransactions = useCallback((rows, options) => mutate('add', rows, options), [mutate]);
    const addTransaction = useCallback(async (row, options) => (await addTransactions([row], options))[0], [addTransactions]);
    const updateTransaction = useCallback((id, updates, options) => mutate('update', id, updates, options), [mutate]);
    const deleteTransaction = useCallback((id, options) => mutate('remove', id, options), [mutate]);
    const deleteAllTransactions = useCallback(options => mutate('clear', options), [mutate]);
    const applyOrderSave = useCallback((changes, result) => {
        const rows = changes.map(({ original, updates }) => {
            const amount = updates.amount === undefined || Number(updates.amount) === Number(original.amount)
                ? original.amountExact ?? original.amount : updates.amount;
            return { ...original, ...updates, amount: Number(amount), amountNumber: Number(amount),
                amountExact: String(amount), orderVersion: result.version };
        });
        syncRef.current?.apply({ type: 'upsert', rows });
    }, []);

    useEffect(() => {
        setTransactions([]);
        setError(null);
        setLoading(enabled);
        setLegacyCache(false);
        if (!enabled || !accountId) return;

        let currentTransactions = [];
        let snapshotRevision;
        setLegacyCache(hasLegacyTransactionCache(window.localStorage));
        const sync = createTransactionSync({
            read: async signal => {
                const { revision } = await apiRequest('/api/transactions/revision', { signal });
                if (!Number.isSafeInteger(revision)) throw new Error('Transaction revision could not be verified.');
                if (snapshotRevision === revision) return currentTransactions;
                return fetchApiTransactionHistory(apiRequest, { signal, onRevision: value => { snapshotRevision = value; } });
            },
            onTransactions: rows => {
                currentTransactions = rows;
                setTransactions(rows);
            },
            onLoading: setLoading,
            onError: err => setError(err ? (err.message || String(err)) : null)
        });
        syncRef.current = sync;
        mutationsRef.current = createTransactionMutations({
            request: apiRequest,
            getTransactions: () => currentTransactions,
            apply: change => sync.apply(change)
        });
        const refreshVisible = () => {
            if (document.visibilityState === 'visible') void sync.refresh();
        };
        refreshVisible();
        const timer = window.setInterval(refreshVisible, 30_000);
        document.addEventListener('visibilitychange', refreshVisible);
        window.addEventListener('focus', refreshVisible);
        window.addEventListener('online', refreshVisible);
        return () => {
            sync.dispose();
            if (syncRef.current === sync) {
                syncRef.current = null;
                mutationsRef.current = null;
            }
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refreshVisible);
            window.removeEventListener('focus', refreshVisible);
            window.removeEventListener('online', refreshVisible);
        };
    }, [enabled, accountId]);

    return { transactions, loading: enabled && loading, error, legacyCache, addTransaction, addTransactions,
        updateTransaction, deleteTransaction, deleteAllTransactions, applyOrderSave, refetch };
};

export default useTransactions;
