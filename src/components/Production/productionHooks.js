import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/apiClient.js';
import { newProductionRequest, productionError } from '../../lib/production.js';
import { useToast } from '../ui/Toast.jsx';

async function loadPages(path, key) {
    const entries = [];
    let nextOffset = 0;
    do {
        const page = await apiRequest(`${path}${nextOffset ? `?offset=${nextOffset}` : ''}`);
        if (!Array.isArray(page[key])) throw new Error('Print response could not be verified.');
        entries.push(...page[key]);
        if (page.nextOffset != null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= nextOffset)) {
            throw new Error('Print source pages could not be verified. Reload the list.');
        }
        nextOffset = page.nextOffset ?? null;
    } while (nextOffset !== null);
    return { [key]: [...new Map(entries.map(entry => [key === 'jobs' ? entry.id : `${entry.sourceId}:${entry.itemIndex ?? -1}`, entry])).values()] };
}

export function useProductionData(owner = false) {
    const [data, setData] = useState({ jobs: [], sources: [], members: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
    const generation = useRef(0);
    const load = useCallback(async () => {
        const current = ++generation.current;
        setLoading(true);
        try {
            const [jobs, sources, members] = await Promise.all([
                loadPages('/api/production/jobs', 'jobs'),
                owner ? loadPages('/api/production/sources', 'sources') : { sources: [] },
                owner ? apiRequest('/api/members') : { members: [] }
            ]);
            if (current !== generation.current) return;
            setData({ jobs: jobs.jobs, sources: sources.sources, members: Array.isArray(members) ? members : members.members || [] });
            setError(null);
        } catch (failure) {
            if (current === generation.current) setError(failure);
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [owner]);
    useEffect(() => {
        load();
        const refresh = () => { if (document.visibilityState === 'visible') load(); };
        const connected = () => { setOnline(true); load(); };
        const disconnected = () => setOnline(false);
        const timer = window.setInterval(refresh, 30000);
        window.addEventListener('online', connected);
        window.addEventListener('offline', disconnected);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            ++generation.current;
            window.clearInterval(timer);
            window.removeEventListener('online', connected);
            window.removeEventListener('offline', disconnected);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [load]);
    return { ...data, loading, error, online, load };
}

export function useProductionMutation(reload) {
    const { showToast } = useToast();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const pending = useRef(null);
    const inFlight = useRef(false);
    const execute = async (operation) => {
        if (inFlight.current) return false;
        inFlight.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await apiRequest(operation.path, { method: operation.method, body: operation.body });
            pending.current = null;
            setUncertain(false);
            operation.onSuccess?.(result);
            showToast(operation.message);
            await reload();
            return true;
        } catch (failure) {
            const unknown = !failure.status || failure.status >= 500 || failure.code === 'invalid_response';
            setUncertain(unknown);
            if (!unknown) pending.current = null;
            setError(unknown ? 'Save not confirmed. Keep these inputs unchanged and retry the same save. It will not be counted twice.'
                : productionError(failure));
            if (failure.status === 409 || failure.status === 403) await reload();
            return false;
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const run = (path, body, message, onSuccess, method = 'POST') => {
        if (pending.current) return execute(pending.current);
        const operation = { path, body: newProductionRequest(body), message, onSuccess, method };
        pending.current = operation;
        return execute(operation);
    };
    return { busy, error, uncertain, run, retry: () => pending.current && execute(pending.current) };
}
