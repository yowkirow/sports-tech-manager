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
