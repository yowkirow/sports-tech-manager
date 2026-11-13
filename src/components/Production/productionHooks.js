import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiRequest } from '../../lib/apiClient.js';
import { readCountColors, readSavedBlankCount } from '../../lib/blankCounts.js';
import { newProductionRequest, productionError } from '../../lib/production.js';
import { prepareReceiptImage } from '../../lib/receiptImage.js';
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

export function useProductionWallet(enabled = true) {
    const [data, setData] = useState({ wallet: null, wallets: [], unattributed: { shirts: 0, recent: [] } });
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const generation = useRef(0);
    const load = useCallback(async () => {
        if (!enabled) return;
        const current = ++generation.current;
        setLoading(true);
        try {
            const result = await apiRequest('/api/production/wallet');
            if (!result || (!result.wallet && !Array.isArray(result.wallets))) throw new Error('Wallet response could not be verified.');
            if (current !== generation.current) return;
            setData({ wallet: result.wallet || null, wallets: result.wallets || [],
                unattributed: result.unattributed || { shirts: 0, recent: [] } });
            setError(null);
        } catch (failure) {
            if (current === generation.current) setError(failure);
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return undefined;
        load();
        const refresh = () => { if (document.visibilityState === 'visible') load(); };
        const timer = window.setInterval(refresh, 30000);
        window.addEventListener('online', load);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            ++generation.current;
            window.clearInterval(timer);
            window.removeEventListener('online', load);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [enabled, load]);
    return { ...data, loading, error, load };
}

export function useProductionMutation(reload, { serverErrors = false } = {}) {
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
            showToast(typeof operation.message === 'function' ? operation.message(result) : operation.message);
            await reload();
            return true;
        } catch (failure) {
            const unknown = !failure.status || failure.status >= 500 || failure.code === 'invalid_response';
            setUncertain(unknown);
            if (!unknown) pending.current = null;
            setError(unknown ? 'Save not confirmed. Keep these inputs unchanged and retry the same save. It will not be counted twice.'
                : serverErrors && failure.message ? failure.message : productionError(failure));
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

// A print operator's history (owner request 2026-11-03), 40 entries a page, newest first. Staff
// read their own (no memberId); the owner passes the operator's memberId. Loads when enabled, so a
// tab or dialog fetches fresh entries each time it opens.
export function usePrintHistory({ memberId = null, enabled = true } = {}) {
    const [state, setState] = useState({ entries: [], next: null, loaded: false });
    const [loading, setLoading] = useState(false);
    // The last failed read, and whether it was for older entries, so the screen retries that read.
    const [failure, setFailure] = useState(null);
    const generation = useRef(0);
    const cursor = useRef(null);
    const fetchPage = useCallback(async before => {
        const params = new URLSearchParams();
        if (memberId) params.set('memberId', memberId);
        if (before) params.set('before', before);
        const query = params.toString();
        const page = await apiRequest(`/api/production/history${query ? `?${query}` : ''}`);
        if (!page || !Array.isArray(page.entries) || (page.next !== null && typeof page.next !== 'string')) {
            throw new Error('History could not be verified. Reload to try again.');
        }
        return page;
    }, [memberId]);
    const read = useCallback(async before => {
        const current = ++generation.current;
        setLoading(true);
        try {
            const page = await fetchPage(before);
            if (current !== generation.current) return;
            cursor.current = page.next;
            setState(previous => {
                if (!before) return { entries: page.entries, next: page.next, loaded: true };
                const seen = new Set(previous.entries.map(entry => entry.id));
                return { entries: [...previous.entries, ...page.entries.filter(entry => !seen.has(entry.id))], next: page.next, loaded: true };
            });
            // Older entries clear only their own error; a failed refresh stays until a refresh works.
            setFailure(previous => (!before || previous?.older ? null : previous));
        } catch (error) {
            if (current === generation.current) setFailure({ error, older: !!before });
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [fetchPage]);
    const load = useCallback(() => (enabled ? read(null) : Promise.resolve()), [enabled, read]);
    const more = useCallback(() => (cursor.current ? read(cursor.current) : Promise.resolve()), [read]);
    useEffect(() => {
        if (!enabled) return undefined;
        load();
        // A read still in flight is ignored from here on; it must not leave Reload stuck on "Refreshing…".
        return () => { ++generation.current; setLoading(false); };
    }, [enabled, load]);
    return { ...state, loading, error: failure?.error ?? null, olderFailed: !!failure?.older, load, more };
}

// The newest blank shirt count (src/lib/blankCounts.js) with the shop's colors to count with, for print
// staff. Loads each time the Blanks tab opens, on Reload and after a save.
export function useBlankCount({ enabled = true } = {}) {
    const [state, setState] = useState({ blanks: null, colors: [], suggested: [], loaded: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const generation = useRef(0);
    const load = useCallback(async () => {
        if (!enabled) return;
        const current = ++generation.current;
        setLoading(true);
        try {
            const result = await apiRequest('/api/production/blanks');
            const blanks = result?.blanks === null ? null : readSavedBlankCount(result?.blanks);
            if (result?.blanks !== null && !blanks) throw new Error('The blank shirt count could not be verified. Reload to try again.');
            if (current !== generation.current) return;
            setState({ blanks, ...readCountColors(result), loaded: true });
            setError(null);
        } catch (failure) {
            if (current === generation.current) setError(failure);
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return undefined;
        load();
        return () => { ++generation.current; setLoading(false); };
    }, [enabled, load]);
    return { ...state, loading, error, load };
}

// Prepares (see receiptImage.js) and uploads one payout receipt image. The upload is private and
// unattached until a payout save references it.
export function useReceiptUpload() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const clearError = useCallback(() => setError(''), []);
    const upload = useCallback(async file => {
        setBusy(true);
        setError('');
        try {
            const image = await prepareReceiptImage(file);
            const saved = await api.uploadPayoutReceipt(image);
            if (!saved?.id || !saved?.url) throw new Error('The upload could not be confirmed. Choose the receipt again.');
            return { id: saved.id, url: saved.url, preview: URL.createObjectURL(image) };
        } catch (failure) {
            setError(failure?.status === 413 ? 'This image is too large. Choose a screenshot or a smaller photo.'
                : failure?.message || 'The receipt could not be uploaded. Try again.');
            return null;
        } finally {
            setBusy(false);
        }
    }, []);
    return { busy, error, upload, clearError };
}
