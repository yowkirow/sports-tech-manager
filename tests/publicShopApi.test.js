import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshTrackedOrder, saveTrackedOrder, trackOrder, uploadReceipt } from '../src/lib/publicShopApi.js';

test('public client sends bearer capabilities in headers, never URLs, and stores refreshed capability per tab', async t => {
    const previous = globalThis.fetch;
    const previousStorage = globalThis.sessionStorage;
    const storage = new Map();
    globalThis.sessionStorage = { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) };
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ order: { id: 'ST-TEST' }, token: 'synthetic-signed-token' }), { headers: { 'Content-Type': 'application/json' } });
    };
    t.after(() => { globalThis.fetch = previous; globalThis.sessionStorage = previousStorage; });
    await trackOrder('09171234567', 'ST-TEST');
    await refreshTrackedOrder('ST-TEST');
    await saveTrackedOrder('ST-TEST', { requestId: 'retry-key', items: [] });
    assert.deepEqual(JSON.parse(requests[0].options.body), { contact: '09171234567', orderId: 'ST-TEST' });
    assert.equal(requests[1].options.headers.Authorization, 'Bearer synthetic-signed-token');
    assert.equal(requests[2].options.headers.Authorization, 'Bearer synthetic-signed-token');
    assert.equal(JSON.parse(requests[2].options.body).requestId, 'retry-key');
    assert.ok(requests.every(request => !request.url.includes('synthetic-signed-token')));
    assert.ok(requests.every(request => request.options.credentials === 'same-origin' && request.options.redirect === 'error'));
});

test('receipt client rejects oversized uploads and propagates non-JSON/errors rather than a public URL', async t => {
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; });
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response('not-json'); };
    await assert.rejects(uploadReceipt({ size: 5 * 1024 * 1024 + 1 }), /5 MiB/);
    assert.equal(called, false);
    await assert.rejects(uploadReceipt(new Blob(['synthetic'])), /could not be verified/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Wait before retrying.' } }), {
        status: 429, headers: { 'Content-Type': 'application/json' }
    });
    await assert.rejects(uploadReceipt(new Blob(['synthetic'])), error => error.status === 429 && error.code === 'rate_limited');
});
