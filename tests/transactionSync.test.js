import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createTransactionSync,
    fetchTransactionHistory,
    insertTransactionBatch,
    reconcileTransactions
} from '../src/lib/transactionSync.js';

const row = (id, date = '2026-09-07T00:00:00Z', extra = {}) => ({ id, date, ...extra });
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

const historyClient = (readPage) => {
    const requests = [];
    return {
        requests,
        from(table) {
            const request = { table, orders: [] };
            const query = {
                select(columns, options) { Object.assign(request, { columns, options }); return query; },
                order(column, options) { request.orders.push({ column, options }); return query; },
                range(from, to) { Object.assign(request, { from, to }); return query; },
                abortSignal(signal) { request.signal = signal; return query; },
                then(resolve, reject) {
                    requests.push(request);
                    return Promise.resolve().then(() => readPage(request)).then(resolve, reject);
                }
            };
            return query;
        }
    };
};

const insertClient = (response) => {
    const statements = [];
    return {
        statements,
        from(table) {
            return {
                insert(rows) {
                    statements.push({ table, rows });
                    return { select: () => response };
                }
            };
        }
    };
};

const syncFixture = (read) => {
    const changes = [];
    const loading = [];
    const errors = [];
    const sync = createTransactionSync({
        read,
        onTransactions: rows => changes.push(rows),
        onLoading: value => loading.push(value),
        onError: error => errors.push(error)
    });
    return { sync, changes, loading, errors, latest: () => changes.at(-1) };
};

test('loads beyond the server row cap without skipping rows and requests deterministic ordering', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => row(String(7 - index)));
    const client = historyClient(({ from, to }) => ({
        data: rows.slice(from, Math.min(to + 1, from + 2)),
        count: rows.length,
        error: null
    }));
    const signal = new AbortController().signal;
    assert.deepEqual(await fetchTransactionHistory(client, { pageSize: 5, signal }), rows);
    assert.deepEqual(client.requests.map(({ from, to }) => [from, to]), [[0, 4], [2, 6], [4, 8], [6, 10]]);
    for (const request of client.requests) {
        assert.equal(request.table, 'transactions');
        assert.equal(request.columns, '*');
        assert.deepEqual(request.options, { count: 'exact' });
        assert.deepEqual(request.orders, [
            { column: 'date', options: { ascending: false, nullsFirst: false } },
            { column: 'id', options: { ascending: false } }
        ]);
        assert.equal(request.signal, signal);
    }
});

test('accepts a verified empty history without issuing an extra request', async () => {
    const client = historyClient(() => ({ data: [], count: 0 }));
    assert.deepEqual(await fetchTransactionHistory(client), []);
    assert.equal(client.requests.length, 1);
});

test('rejects unverified, truncated, overlapping, or changing histories instead of publishing partial data', async (t) => {
    const cases = [
        ['missing count', [{ data: [row('a')], count: null }], /exact count/],
        ['invalid rows', [{ data: null, count: 1 }], /invalid/],
        ['missing ID', [{ data: [{ date: '2026-09-07' }], count: 1 }], /invalid/],
        ['duplicate page IDs', [{ data: [row('a'), row('a')], count: 2 }], /duplicate/],
        ['empty early page', [{ data: [row('a')], count: 2 }, { data: [], count: 2 }], /incomplete/],
        ['overlapping pages', [{ data: [row('a')], count: 2 }, { data: [row('a')], count: 2 }], /overlap/],
        ['count changes', [{ data: [row('a')], count: 2 }, { data: [row('b')], count: 3 }], /changed while loading/],
        ['excess rows', [{ data: [row('a'), row('b')], count: 1 }], /incomplete/]
    ];
    for (const [name, pages, expected] of cases) {
        await t.test(name, async () => {
            const client = historyClient(() => pages.shift());
            await assert.rejects(fetchTransactionHistory(client, { pageSize: 2 }), expected);
        });
    }
});

test('propagates database failures even after a successful first page', async () => {
    const failure = new Error('Database unavailable');
    const client = historyClient(({ from }) => from === 0
        ? { data: [row('a')], count: 2 }
        : { data: null, error: failure });
    await assert.rejects(fetchTransactionHistory(client), error => error === failure);
});

test('aborting a page prevents subsequent pages and rejects a late response', async () => {
    const page = deferred();
    const controller = new AbortController();
    const client = historyClient(() => page.promise);
    const pending = fetchTransactionHistory(client, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    page.resolve({ data: [row('a')], count: 2 });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(client.requests.length, 1);
});

test('rejects invalid pagination sizes before any database call', async () => {
    const client = historyClient(() => assert.fail('Unexpected database call'));
    for (const pageSize of [0, -1, 1.5, Infinity]) {
        await assert.rejects(fetchTransactionHistory(client, { pageSize }), RangeError);
    }
    assert.equal(client.requests.length, 0);
});

test('reconciliation merges partial updates, deduplicates IDs, sorts by time/id, and does not mutate inputs', () => {
    const original = [
        row('c', '2026-09-07T00:00:00Z', { quantity: 2 }),
        row('a', '2026-09-06T00:00:00Z', { quantity: 1 })
    ];
    const result = reconcileTransactions(original, [{
        type: 'upsert',
        rows: [
            row('b', '2026-09-07T08:00:00+08:00'),
            { id: 'a', date: '2026-09-08T00:00:00Z' },
            row('d', null)
        ]
    }]);
    assert.deepEqual(result.map(item => item.id), ['a', 'c', 'b', 'd']);
    assert.equal(result[0].quantity, 1);
    assert.equal(original[1].date, '2026-09-06T00:00:00Z');
    assert.equal(original.length, 2);
});

test('duplicate acknowledgements, missing deletions, and empty changes preserve state identity', () => {
    const original = [row('a')];
    assert.equal(reconcileTransactions(original, []), original);
    assert.equal(reconcileTransactions(original, [{ type: 'upsert', rows: [{ ...original[0] }] }]), original);
    assert.equal(reconcileTransactions(original, [{ type: 'delete', ids: ['missing'] }]), original);
    const empty = [];
    assert.equal(reconcileTransactions(empty, [{ type: 'clear' }]), empty);
});

test('bulk insert executes one insert/select and returns all saved rows', async () => {
    const input = [{ type: 'sale' }, { type: 'expense' }];
    const saved = [row('a'), row('b')];
    const client = insertClient({ data: saved, error: null });
    assert.equal(await insertTransactionBatch(client, input), saved);
    assert.deepEqual(client.statements, [{ table: 'transactions', rows: input }]);
    assert.deepEqual(input, [{ type: 'sale' }, { type: 'expense' }]);
});

test('bulk insert rejects failed or incomplete representations rather than claiming partial success', async () => {
    const failure = new Error('Insert rejected');
    await assert.rejects(
        insertTransactionBatch(insertClient({ data: null, error: failure }), [{ type: 'sale' }]),
        error => error === failure
    );
    await assert.rejects(
        insertTransactionBatch(insertClient({ data: [row('a')] }), [{}, {}]),
        /incomplete/
    );
    await assert.rejects(
        insertTransactionBatch(insertClient({ data: null }), [{}]),
        /invalid/
    );
    await assert.rejects(
        insertTransactionBatch(insertClient({ data: [row('a'), row('a')] }), [{}, {}]),
        /duplicate/
    );
});

test('empty bulk inserts avoid the database and invalid inputs reject', async () => {
    const client = insertClient({});
    assert.deepEqual(await insertTransactionBatch(client, []), []);
    for (const invalid of [null, {}, [null], [[]], ['sale']]) {
        await assert.rejects(insertTransactionBatch(client, invalid), TypeError);
    }
    assert.equal(client.statements.length, 0);
});

test('simultaneous reloads share a promise and one read, with later refreshes still allowed', async () => {
    const page = deferred();
    let reads = 0;
    const fixture = syncFixture(() => { reads += 1; return page.promise; });
    const first = fixture.sync.refresh();
    assert.equal(fixture.sync.refresh(), first);
    assert.equal(fixture.sync.refresh(), first);
    await Promise.resolve();
    assert.equal(reads, 1);
    page.resolve([row('a')]);
    await first;
    assert.deepEqual(fixture.loading, [true, false]);
    const later = fixture.sync.refresh();
    assert.notEqual(later, first);
    await later;
    assert.equal(reads, 2);
});

test('successful write retries clear write errors without hiding a failed history read', async () => {
    const errors = [];
    let failRead = false;
    const sync = createTransactionSync({
        read: async () => { if (failRead) throw new Error('Read failed'); return []; },
        onTransactions() {},
        onLoading() {},
        onError: error => errors.push(error?.message || null)
    });
    await sync.refresh();
    sync.reportError(new Error('Write failed'));
    sync.reportError(null);
    assert.equal(errors.at(-1), null);
    failRead = true;
    await sync.refresh();
    sync.reportError(null);
    assert.equal(errors.at(-1), 'Read failed');
    failRead = false;
    await sync.refresh();
    assert.equal(errors.at(-1), null);
});

test('a bulk acknowledgement after realtime is deduplicated and publishes the full batch atomically', async () => {
    const page = deferred();
    const response = deferred();
    const fixture = syncFixture(() => page.promise);
    const refresh = fixture.sync.refresh();
    const saved = [row('b'), row('a')];
    const insert = insertTransactionBatch(insertClient(response.promise), [{}, {}]).then(rows => {
        fixture.sync.apply({ type: 'upsert', rows });
        return rows;
    });
    fixture.sync.apply({ type: 'upsert', rows: [saved[0]] });
    const beforeAcknowledgement = fixture.changes.length;
    response.resolve({ data: saved });
    assert.equal(await insert, saved);
    assert.equal(fixture.changes.length, beforeAcknowledgement + 1);
    assert.deepEqual(fixture.latest().map(item => item.id), ['b', 'a']);
    page.resolve([]);
    await refresh;
    assert.deepEqual(fixture.latest().map(item => item.id), ['b', 'a']);
});

test('replays updates and deletions during a fetch even when the affected row is not yet local', async () => {
    const page = deferred();
    const fixture = syncFixture(() => page.promise);
    const pending = fixture.sync.refresh();
    fixture.sync.apply({ type: 'upsert', rows: [{ id: 'a', date: '2026-09-09T00:00:00Z' }] });
    fixture.sync.apply({ type: 'delete', ids: ['b'] });
    page.resolve([row('c'), row('b'), row('a', '2026-09-06T00:00:00Z', { quantity: 3 })]);
    await pending;
    assert.deepEqual(fixture.latest().map(item => item.id), ['a', 'c']);
    assert.equal(fixture.latest()[0].quantity, 3);
});

test('a locally redundant event is still replayed against an older pending snapshot', async () => {
    const page = deferred();
    const fixture = syncFixture(() => page.promise);
    const saved = row('a');
    fixture.sync.apply({ type: 'upsert', rows: [saved] });
    const pending = fixture.sync.refresh();
    const previous = fixture.latest();
    fixture.sync.apply({ type: 'upsert', rows: [saved] });
    assert.equal(fixture.latest(), previous);
    page.resolve([]);
    await pending;
    assert.deepEqual(fixture.latest(), [saved]);
});

test('replays clear and later writes in event order without resurrecting deleted rows', async () => {
    const page = deferred();
    const fixture = syncFixture(() => page.promise);
    const pending = fixture.sync.refresh();
    fixture.sync.apply({ type: 'clear' });
    fixture.sync.apply({ type: 'upsert', rows: [row('new')] });
    page.resolve([row('old')]);
    await pending;
    assert.deepEqual(fixture.latest(), [row('new')]);
});

test('a failed refresh preserves useful data and writes, and success clears the previous error', async () => {
    const failure = new Error('Offline');
    const page = deferred();
    let read = () => page.promise;
    const fixture = syncFixture(() => read());
    fixture.sync.apply({ type: 'upsert', rows: [row('existing')] });
    const pending = fixture.sync.refresh();
    fixture.sync.apply({ type: 'upsert', rows: [row('new')] });
    page.reject(failure);
    await pending;
    assert.deepEqual(fixture.latest().map(item => item.id), ['new', 'existing']);
    assert.equal(fixture.errors.at(-1), failure);
    assert.equal(fixture.loading.at(-1), false);

    read = () => Promise.resolve([row('new'), row('existing')]);
    await fixture.sync.refresh();
    assert.equal(fixture.errors.at(-1), null);
});

test('cleanup aborts stale reads and ignores old subscription, write, and error callbacks', async () => {
    const page = deferred();
    let signal;
    const fixture = syncFixture(receivedSignal => { signal = receivedSignal; return page.promise; });
    const pending = fixture.sync.refresh();
    await Promise.resolve();
    fixture.sync.dispose();
    assert.equal(signal.aborted, true);
    fixture.sync.apply({ type: 'upsert', rows: [row('late-write')] });
    fixture.sync.reportError(new Error('Late mutation failure'));
    page.resolve([row('stale')]);
    await pending;
    await fixture.sync.refresh();
    assert.deepEqual(fixture.changes, []);
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.loading, [true]);
});

test('StrictMode-style cleanup before the read starts performs no discarded load', async () => {
    let reads = 0;
    const fixture = syncFixture(() => { reads += 1; return Promise.resolve([]); });
    const pending = fixture.sync.refresh();
    fixture.sync.dispose();
    await pending;
    assert.equal(reads, 0);
    assert.deepEqual(fixture.changes, []);
});

test('a new enabled lifetime is unaffected by an old load settling last', async () => {
    const oldPage = deferred();
    const newPage = deferred();
    const published = [];
    const options = {
        onTransactions: rows => published.push(rows),
        onError: error => { if (error) assert.fail(error.message); },
        onLoading: () => {}
    };
    const oldSync = createTransactionSync({ ...options, read: () => oldPage.promise });
    const oldPending = oldSync.refresh();
    await Promise.resolve();
    oldSync.dispose();
    const newSync = createTransactionSync({ ...options, read: () => newPage.promise });
    const newPending = newSync.refresh();
    newPage.resolve([row('current')]);
    await newPending;
    oldPage.resolve([row('stale')]);
    await oldPending;
    assert.deepEqual(published, [[row('current')]]);
});

test('a failed migration still loads server history, reports the failure, and clears it on recovery', async () => {
    const failure = new Error('Legacy migration rejected');
    let shouldFail = true;
    const changes = [];
    const errors = [];
    const sync = createTransactionSync({
        prepare: async () => { if (shouldFail) throw failure; },
        read: () => Promise.resolve([row('server')]),
        onTransactions: rows => changes.push(rows),
        onLoading: () => {},
        onError: error => errors.push(error)
    });
    await sync.refresh();
    assert.deepEqual(changes.at(-1), [row('server')]);
    assert.equal(errors.at(-1), failure);
    shouldFail = false;
    await sync.refresh();
    assert.equal(errors.at(-1), null);
});

test('cleanup during migration prevents the disposed lifetime from fetching afterward', async () => {
    const migration = deferred();
    let reads = 0;
    const changes = [];
    const options = {
        prepare: () => migration.promise,
        read: () => { reads += 1; return Promise.resolve([row('migrated')]); },
        onTransactions: rows => changes.push(rows),
        onLoading: () => {},
        onError: error => { if (error) assert.fail(error.message); }
    };
    const oldSync = createTransactionSync(options);
    const oldPending = oldSync.refresh();
    await Promise.resolve();
    oldSync.dispose();
    const currentSync = createTransactionSync(options);
    const currentPending = currentSync.refresh();
    migration.resolve();
    await Promise.all([oldPending, currentPending]);
    assert.equal(reads, 1);
    assert.deepEqual(changes, [[row('migrated')]]);
});
