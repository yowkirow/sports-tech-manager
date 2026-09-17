import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchApiTransactionHistory, hasLegacyTransactionCache, createTransactionMutations } from '../src/lib/transactionApi.js';
import { createTransactionSync, reconcileTransactions } from '../src/lib/transactionSync.js';

const row = id => ({ id, type: 'expense', amount: 20, amountExact: '20.00000000000000001', details: {}, date: '2026-09-01' });

test('API history verifies all pages with a stable revision and actual server page lengths', async () => {
    const paths = [];
    const result = await fetchApiTransactionHistory(async path => {
        paths.push(path);
        const offset = Number(new URL(path, 'https://example.test').searchParams.get('offset'));
        return { rows: [row(String(offset))], count: 3, revision: 'revision-1' };
    });
    assert.deepEqual(result.map(item => item.id), ['0', '1', '2']);
    assert.equal(paths[0], '/api/transactions?offset=0&limit=1000');
    assert.equal(paths[1], '/api/transactions?offset=1&limit=1000&revision=revision-1');
});

test('API history rejects changing revisions, counts, overlapping, incomplete and invalid snapshots', async () => {
    for (const second of [
        { rows: [row('b')], count: 2, revision: 'new' },
        { rows: [row('b')], count: 3, revision: 'first' },
        { rows: [row('a')], count: 2, revision: 'first' },
        { rows: [], count: 2, revision: 'first' },
        { rows: [row('b')], count: 2 },
        { rows: [row('b'), row('c')], count: 2, revision: 'first' },
        { rows: [row('b')], count: null, revision: 'first' }
    ]) {
        let calls = 0;
        await assert.rejects(fetchApiTransactionHistory(async () => ++calls === 1
            ? { rows: [row('a')], count: 2, revision: 'first' } : second));
        assert.equal(calls, 2);
    }
    assert.deepEqual(await fetchApiTransactionHistory(async () => ({ rows: [], count: 0, revision: 0 })), []);
});

test('history aborts rather than publishing a partial response', async () => {
    const controller = new AbortController();
    await assert.rejects(fetchApiTransactionHistory(async () => {
        controller.abort();
        return { rows: [row('a')], count: 1, revision: 'r' };
    }, { signal: controller.signal }), { name: 'AbortError' });
});

test('legacy cache detection never parses, imports, overwrites or deletes cached records', () => {
    for (const content of ['[{"id":"legacy"}]', 'invalid JSON']) {
        const storage = {
            getItem(key) { assert.equal(key, 'sports-tech-transactions'); return content; },
            setItem() { assert.fail('must not overwrite'); },
            removeItem() { assert.fail('must not delete'); }
        };
        assert.equal(hasLegacyTransactionCache(storage), true);
    }
    assert.equal(hasLegacyTransactionCache({ getItem: () => null }), false);
    assert.equal(hasLegacyTransactionCache({ getItem: () => '[]' }), false);
    assert.equal(hasLegacyTransactionCache({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('mutations preserve retry IDs, surface rejected saves and only sync verified responses', async () => {
    const calls = [];
    let current = [row('a')];
    let fail = true;
    const mutations = createTransactionMutations({
        request: async (path, options) => {
            calls.push({ path, ...options });
            if (fail) throw new Error('lost response');
            return { rows: options.body.rows };
        },
        makeId: () => `request-${calls.length}`,
        getTransactions: () => current,
        apply: change => { current = reconcileTransactions(current, [change]); }
    });
    await assert.rejects(mutations.add([row('b')]), /lost response/);
    assert.deepEqual(current.map(item => item.id), ['a']);
    fail = false;
    await mutations.add([row('b')]);
    assert.equal(calls[0].body.requestId, calls[1].body.requestId);
    assert.equal(current.length, 2);
    await assert.rejects(mutations.add([]), /required/);
    await assert.rejects(mutations.update('missing', { amount: 1 }), /original transaction/);
    await assert.rejects(mutations.remove('missing'), /original transaction/);
    assert.equal(calls.length, 2);
});

test('update and delete require the source snapshot and refuse unverifiable responses', async () => {
    const calls = [];
    const changes = [];
    const source = row('a');
    let valid = false;
    const mutations = createTransactionMutations({
        getTransactions: () => [source], apply: change => changes.push(change),
        request: async (path, options) => {
            calls.push({ path, ...options });
            if (options.method === 'PATCH') return { row: valid ? { ...source, amount: 30 } : row('wrong') };
            return { id: valid ? 'a' : 'wrong' };
        }
    });
    await assert.rejects(mutations.update('a', { amount: 30 }), /confirmed/);
    await assert.rejects(mutations.remove('a'), /confirmed/);
    assert.equal(changes.length, 0);
    valid = true;
    await mutations.update('a', { amount: 30 });
    await mutations.remove('a');
    assert.equal(calls[0].body.expected.amount, source.amountExact);
    assert.equal(calls[0].body.requestId, calls[2].body.requestId);
    assert.deepEqual(changes.map(change => change.type), ['upsert', 'delete']);
});

test('reset uses explicit confirmation and cannot clear local data after failure', async () => {
    const changes = [];
    let ok = false;
    let payload;
    const mutations = createTransactionMutations({
        getTransactions: () => [row('a')], apply: change => changes.push(change),
        request: async (path, options) => { payload = { path, ...options }; return { ok }; }
    });

    await assert.rejects(mutations.clear(), /reset could not be confirmed/);
    assert.equal(changes.length, 0);
    ok = true;
    await mutations.clear();
    assert.equal(payload.path, '/api/transactions');
    assert.equal(payload.body.confirmation, 'DELETE ALL');
    assert.equal(typeof payload.body.requestId, 'string');
    assert.deepEqual(changes, [{ type: 'clear' }]);
});

test('metadata-only transaction patches retain the exact source amount', async () => {
    let payload;
    const original = row('a');
    const mutations = createTransactionMutations({
        getTransactions: () => [original], apply() {},
        request: async (_path, options) => { payload = options.body; return { row: original }; }
    });
    await mutations.update('a', { amount: 20, description: 'New description' });
    assert.equal(payload.updates.amount, original.amountExact);
    assert.equal(payload.expected.amount, original.amountExact);
});

test('API refresh retains optimistic saves made while reading and disposal clears the old owner', async () => {
    let resolve;
    let published = [];
    const sync = createTransactionSync({
        read: () => new Promise(done => { resolve = done; }),
        onTransactions: rows => { published = rows; }, onLoading() {}, onError() {}
    });
    const reading = sync.refresh();
    await Promise.resolve();
    sync.apply({ type: 'upsert', rows: [row('b')] });
    resolve([row('a')]);
    await reading;
    assert.deepEqual(new Set(published.map(item => item.id)), new Set(['a', 'b']));
    sync.dispose();
    sync.apply({ type: 'clear' });
    assert.equal(published.length, 2);
});
