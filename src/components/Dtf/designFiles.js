import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/apiClient';
import { svgUrl } from '../../lib/svgDesign.js';

// Design files are private, so each one is fetched once per visit and shown from a blob URL, where an
// SVG can't run scripts or load anything. The cache outlives the tab, so switching tabs doesn't refetch.
const cache = new Map();
const listeners = new Set();
const CONCURRENCY = 4;
let active = 0;
const queue = [];

const notify = () => listeners.forEach(listener => listener());

function settle(id, entry) {
    cache.set(id, entry);
    notify();
}

function pump() {
    while (active < CONCURRENCY && queue.length) {
        const { id, url } = queue.shift();
        active += 1;
        api.dtf.svg(url)
            .then(svg => settle(id, { status: 'ready', svg, url: svgUrl(svg) }))
            .catch(error => settle(id, { status: 'error', error: error.message || 'The design could not be loaded.' }))
            .finally(() => { active -= 1; pump(); });
    }
}

function request(design) {
    if (cache.has(design.id)) return;
    cache.set(design.id, { status: 'loading' });
    queue.push({ id: design.id, url: design.svgUrl });
    pump();
}

/** Registers a design file the app already has (a fresh upload), without fetching it again. */
export function rememberDesignFile(id, svg) {
    forgetDesignFile(id);
    settle(id, { status: 'ready', svg, url: svgUrl(svg) });
}

export function forgetDesignFile(id) {
    const entry = cache.get(id);
    if (entry?.url) URL.revokeObjectURL(entry.url);
    if (cache.delete(id)) notify();
}

/** The design files for these designs: { status: 'loading' | 'ready' | 'error', svg, url, error } by ID. */
export function useDesignFiles(designs) {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const listener = () => setVersion(current => current + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    useEffect(() => {
        for (const design of designs || []) request(design);
    }, [designs]);
    const retry = useCallback(design => {
        if (cache.get(design.id)?.status !== 'error') return;
        cache.delete(design.id);
        request(design);
    }, []);
    return { files: cache, version, retry };
}
