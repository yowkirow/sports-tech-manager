const assertRows = rows => {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !row.id)
        || new Set(rows.map(row => row.id)).size !== rows.length) {
        throw new Error('The transaction response could not be verified. Refresh before retrying.');
    }
};

export const fetchApiTransactionHistory = async (request, { signal, pageSize = 1000, onRevision } = {}) => {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
        throw new RangeError('The transaction page size must be between 1 and 1000.');
    }
    const rows = [];
    const ids = new Set();
    let revision;
    let expectedCount;
    do {
        signal?.throwIfAborted();
        const query = new URLSearchParams({ offset: String(rows.length), limit: String(pageSize) });
        if (revision !== undefined) query.set('revision', String(revision));
        const page = await request(`/api/transactions?${query}`, { signal });
        signal?.throwIfAborted();
        assertRows(page?.rows);
        if (!Number.isSafeInteger(page.count) || page.count < 0
            || !['string', 'number'].includes(typeof page.revision) || String(page.revision) === '') {
            throw new Error('The server did not return a verifiable transaction snapshot. Retry to reload.');
        }
        if (revision !== undefined && (page.revision !== revision || page.count !== expectedCount)) {
            throw new Error('Transaction history changed while loading. Retry to load a complete snapshot.');
        }
        revision = page.revision;
        expectedCount = page.count;
        if (rows.length + page.rows.length > expectedCount || (!page.rows.length && rows.length < expectedCount)) {
            throw new Error('The transaction history is incomplete. Retry to reload.');
        }
        for (const row of page.rows) {
            if (ids.has(row.id)) throw new Error('Transaction pages overlap. Retry to reload.');
            ids.add(row.id);
            rows.push(row);
        }
    } while (rows.length < expectedCount);
    onRevision?.(revision);
    return rows;
};

export const hasLegacyTransactionCache = storage => {
    try {
        const value = storage.getItem('sports-tech-transactions');
        return value !== null && value !== '[]';
    } catch {
        return false;
    }
};

// Keep an unsuccessful operation's key in memory so a lost response cannot duplicate its retry.
export const createTransactionMutations = ({ request, getTransactions, apply, makeId = () => crypto.randomUUID() }) => {
    const retries = new Map();
    const mutate = async (path, method, body, verify, requestId) => {
        const key = JSON.stringify([path, method, body]);
        const id = requestId || retries.get(key) || makeId();
        retries.set(key, id);
        const result = await request(path, { method, body: { ...body, requestId: id } });
        verify(result);
        retries.delete(key);
        return result;
    };
    const originalFor = id => {
        const original = getTransactions().find(row => row.id === id);
        if (!original) throw new Error('The original transaction is unavailable. Refresh before retrying.');
        return { ...original, amount: original.amountExact ?? original.amount };
    };
    return {
        async add(rows, { requestId } = {}) {
            if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
                throw new TypeError('At least one valid transaction is required.');
            }
            const result = await mutate('/api/transactions', 'POST', { rows }, data => {
                assertRows(data?.rows);
                if (data.rows.length !== rows.length || rows.some(row => row.id && !data.rows.some(saved => saved.id === row.id))) {
                    throw new Error('The saved transactions could not be confirmed. Refresh before retrying.');
                }
            }, requestId);
            apply({ type: 'upsert', rows: result.rows });
            return result.rows;
        },
        async update(id, updates, { requestId } = {}) {
            if (!updates || typeof updates !== 'object' || Array.isArray(updates) || !Object.keys(updates).length) {
                throw new TypeError('Transaction updates are required.');
            }
            const expected = originalFor(id);
            if (updates.amount !== undefined && Number(updates.amount) === Number(expected.amount)) {
                updates = { ...updates, amount: expected.amount };
            }
            const result = await mutate(`/api/transactions/${encodeURIComponent(id)}`, 'PATCH', { updates, expected }, data => {
                assertRows([data?.row]);
                if (data.row.id !== id) throw new Error('The updated transaction could not be confirmed. Refresh before retrying.');
            }, requestId);
            apply({ type: 'upsert', rows: [result.row] });
            return result.row;
        },
        async remove(id, { requestId } = {}) {
            const expected = originalFor(id);
            await mutate(`/api/transactions/${encodeURIComponent(id)}`, 'DELETE', { expected }, data => {
                if (data?.id !== id) throw new Error('The deletion could not be confirmed. Refresh before retrying.');
            }, requestId);
            apply({ type: 'delete', ids: [id] });
        },
        async clear({ requestId } = {}) {
            await mutate('/api/transactions', 'DELETE', { confirmation: 'DELETE ALL' }, data => {
                if (data?.ok !== true) throw new Error('The reset could not be confirmed. Refresh before retrying.');
            }, requestId);
            apply({ type: 'clear' });
        }
    };
};
