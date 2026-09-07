const assertRows = (rows) => {
    if (!Array.isArray(rows) || rows.some(row => !row || row.id == null)) {
        throw new Error('The transaction response is invalid. Refresh before retrying.');
    }
    if (new Set(rows.map(row => row.id)).size !== rows.length) {
        throw new Error('The transaction response contains duplicate IDs. Refresh before retrying.');
    }
};

const compareTransactions = (left, right) => {
    const leftTime = left.date == null ? NaN : Date.parse(left.date);
    const rightTime = right.date == null ? NaN : Date.parse(right.date);
    const dateOrder = (Number.isNaN(rightTime) ? -Infinity : rightTime)
        - (Number.isNaN(leftTime) ? -Infinity : leftTime);
    if (dateOrder) return dateOrder;
    if (left.id === right.id) return 0;
    return left.id > right.id ? -1 : 1;
};

export const reconcileTransactions = (transactions, changes) => {
    if (changes.length === 0) return transactions;
    const byId = new Map(transactions.map(row => [row.id, row]));
    let changed = false;

    for (const change of changes) {
        if (change.type === 'upsert') {
            for (const row of change.rows) {
                const previous = byId.get(row.id);
                if (previous && Object.keys(row).every(key => Object.is(previous[key], row[key]))) continue;
                byId.set(row.id, previous ? { ...previous, ...row } : row);
                changed = true;
            }
        } else if (change.type === 'delete') {
            for (const id of change.ids) {
                if (byId.delete(id)) changed = true;
            }
        } else if (change.type === 'clear') {
            if (byId.size) changed = true;
            byId.clear();
        }
    }

    return changed ? [...byId.values()].sort(compareTransactions) : transactions;
};

export const fetchTransactionHistory = async (client, { signal, pageSize = 1000 } = {}) => {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
        throw new RangeError('The transaction page size must be a positive integer.');
    }

    const rows = [];
    const ids = new Set();
    let expectedCount;

    while (true) {
        signal?.throwIfAborted();
        let query = client.from('transactions')
            .select('*', { count: 'exact' })
            .order('date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
            .range(rows.length, rows.length + pageSize - 1);
        if (signal) query = query.abortSignal(signal);
        const { data, error, count } = await query;
        signal?.throwIfAborted();
        if (error) throw error;
        assertRows(data);
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error('Cannot verify the complete transaction history: the server did not return an exact count.');
        }
        if (expectedCount !== undefined && count !== expectedCount) {
            throw new Error('Transaction history changed while loading. Please refresh to load a complete history.');
        }
        expectedCount = count;
        if ((data.length === 0 && rows.length < count) || rows.length + data.length > count) {
            throw new Error('The server returned an incomplete transaction history. Please refresh.');
        }
        for (const row of data) {
            if (ids.has(row.id)) {
                throw new Error('Transaction pages overlap. Please refresh to load a complete history.');
            }
            ids.add(row.id);
            rows.push(row);
        }
        if (rows.length === expectedCount) return rows.sort(compareTransactions);
        // Advance by the actual response length: a server cap can be below pageSize.
    }
};

export const insertTransactionBatch = async (client, transactions) => {
    if (!Array.isArray(transactions) || transactions.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new TypeError('Transactions must be an array of transaction objects.');
    }
    if (transactions.length === 0) return [];

    const { data, error } = await client.from('transactions').insert(transactions).select();
    if (error) throw error;
    assertRows(data);
    if (data.length !== transactions.length) {
        throw new Error('The saved transaction response is incomplete. Refresh before retrying to avoid duplicate writes.');
    }
    return data;
};

// One enabled hook lifetime owns this coordinator; disposing it also invalidates old callbacks.
export const createTransactionSync = ({ prepare, read, onTransactions, onLoading, onError }) => {
    let active = true;
    let transactions = [];
    let request = null;

    const publish = (next) => {
        if (next === transactions) return;
        transactions = next;
        onTransactions(next);
    };

    return {
        refresh() {
            if (!active) return Promise.resolve();
            if (request) return request.promise;

            const current = { controller: new AbortController(), changes: [], promise: null };
            request = current;
            onLoading(true);
            current.promise = Promise.resolve().then(async () => {
                try {
                    if (!active) return;
                    let preparationError = null;
                    if (prepare) {
                        try {
                            await prepare();
                        } catch (error) {
                            preparationError = error;
                        }
                        if (!active) return;
                    }
                    const snapshot = await read(current.controller.signal);
                    if (!active) return;
                    publish(reconcileTransactions(snapshot, current.changes));
                    // A failed legacy migration must not hide readable server data or its own error.
                    onError(preparationError);
                } catch (error) {
                    if (active) onError(error);
                } finally {
                    if (active) {
                        request = null;
                        onLoading(false);
                    }
                }
            });
            return current.promise;
        },
        apply(change) {
            if (!active) return;
            // Record events outside React state updaters, which StrictMode can invoke twice.
            if (request) request.changes.push(change);
            publish(reconcileTransactions(transactions, [change]));
        },
        reportError(error) {
            if (active) onError(error);
        },
        dispose() {
            active = false;
            request?.controller.abort();
            request = null;
        }
    };
};
