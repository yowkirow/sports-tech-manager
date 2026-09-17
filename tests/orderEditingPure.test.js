import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as pure from '../src/lib/orderEditingPure.js';
import * as client from '../src/lib/orderEditing.js';

test('server-safe order editing exports are shared by the frontend without copies', async () => {
    for (const name of ['getEditableOrderItems', 'priceOrderChanges', 'buildOrderChanges', 'buildOrderDetailChanges']) {
        assert.equal(typeof pure[name], 'function');
        assert.equal(client[name], pure[name]);
    }
    assert.equal(pure.saveOrderChanges, undefined);
    const source = await readFile(new URL('../src/lib/orderEditingPure.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /apiClient|apiRequest|\bfetch\s*\(|\bwindow\b|\bdocument\b|supabase/);
});
