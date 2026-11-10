import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, api, apiRequest } from '../src/lib/apiClient.js';

test('API requests stay same-origin and never follow credential-bearing redirects', async t => {
    let captured;
    t.mock.method(globalThis, 'fetch', async (path, options) => {
        captured = { path, options };
        return Response.json({ saved: true });
    });
    assert.deepEqual(await apiRequest('/api/example', { method: 'POST', body: { value: 1 } }), { saved: true });
    assert.equal(captured.options.credentials, 'same-origin');
    assert.equal(captured.options.redirect, 'error');
    assert.equal(captured.options.body, '{"value":1}');
    await assert.rejects(apiRequest('https://untrusted.example/api/example'), /same-origin/);
});

test('API errors preserve explicit failure codes, and invalid responses never look successful', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({
        error: { code: 'ORDER_CONFLICT', message: 'Reload this order.' }
    }, { status: 409 }));
    await assert.rejects(apiRequest('/api/example'), error =>
        error instanceof ApiError && error.status === 409 && error.code === 'ORDER_CONFLICT');
    fetchMock.mock.mockImplementation(async () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
    await assert.rejects(apiRequest('/api/example'), { code: 'invalid_response' });
    fetchMock.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(apiRequest('/api/example'), { code: 'network_error', status: 0 });
});

test('product upload errors use the same verified response contract', async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response('gateway unavailable', { status: 502 }));
    await assert.rejects(api.uploadProductImage(new Blob(['not-real-image'], { type: 'image/png' })), { code: 'invalid_response' });
});

test('a DTF design file is read as text, same-origin, and its errors keep the PIN prompt working', async t => {
    let captured;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (path, options) => {
        captured = { path, options };
        return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'application/octet-stream' } });
    });
    assert.equal(await api.dtf.svg('/api/media/objects/abc'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.deepEqual([captured.path, captured.options.credentials, captured.options.redirect], ['/api/media/objects/abc', 'same-origin', 'error']);
    await assert.rejects(api.dtf.svg('https://untrusted.example/design.svg'), /same-origin/);
    const prompts = [];
    globalThis.window = { dispatchEvent: event => prompts.push(event.type) };
    t.after(() => { delete globalThis.window; });
    fetchMock.mock.mockImplementation(async () => Response.json({ error: { code: 'pin_required', message: 'Enter your PIN.' } }, { status: 401 }));
    await assert.rejects(api.dtf.svg('/api/media/objects/abc'), { code: 'pin_required', status: 401 });
    assert.deepEqual(prompts, ['sportstech:pin-required']);
    fetchMock.mock.mockImplementation(async () => new Response('<html>Sign in</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }));
    await assert.rejects(api.dtf.svg('/api/media/objects/abc'), { code: 'invalid_response' });
});

test('the DTF gallery calls go to the owner-only endpoints', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (path, options) => {
        calls.push([options.method || 'GET', path, options.body ?? null]);
        return Response.json({ ok: true });
    });
    await api.dtf.list();
    await api.dtf.create({ id: 'x', name: 'Crest' });
    await api.dtf.update('a/b', { name: 'New' });
    await api.dtf.remove('a b');
    assert.deepEqual(calls, [
        ['GET', '/api/dtf/designs', null], ['POST', '/api/dtf/designs', '{"id":"x","name":"Crest"}'],
        ['PATCH', '/api/dtf/designs/a%2Fb', '{"name":"New"}'], ['DELETE', '/api/dtf/designs/a%20b', null]
    ]);
});
