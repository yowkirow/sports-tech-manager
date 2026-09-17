import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encryptSettings, handleMediaRequest, handleSmsRequest, imageType, loadSmsSettings } from '../../worker/media-api.ts';
import { readJson, sameOriginMutation } from '../../worker/http.ts';

function fixture(t) {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE members(id TEXT PRIMARY KEY,role TEXT,active INTEGER); CREATE TABLE orders(id TEXT PRIMARY KEY);");
    sqlite.exec(readFileSync(new URL('../../worker/migrations/0006_media_sms.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO members VALUES (?,?,?)').run('owner', 'owner', 1);
    const db = {
        prepare(sql) {
            return {
                values: [], sql,
                bind(...values) { this.values = values; return this; },
                async first() { return sqlite.prepare(sql).get(...this.values) ?? null; },
                async run() { sqlite.prepare(sql).run(...this.values); return { success: true }; }
            };
        },
        async batch(statements) {
            sqlite.exec('BEGIN');
            try {
                const result = statements.map(statement => ({
                    success: true, results: sqlite.prepare(statement.sql).all(...statement.values)
                }));
                sqlite.exec('COMMIT');
                return result;
            } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        }
    };
    return { sqlite, env: { DB: db, ENVIRONMENT: 'staging', GUEST_TOKEN_SECRET: 'a'.repeat(64) }, member: { id: 'owner', email: 'owner@example.test', role: 'owner' } };
}

test('binary sniffing rejects SVG, HTML and arbitrary MIME claims', () => {
    assert.equal(imageType(new Uint8Array([137,80,78,71,13,10,26,10])), 'image/png');
    assert.equal(imageType(new Uint8Array([255,216,255,0])), 'image/jpeg');
    assert.equal(imageType(new TextEncoder().encode('<svg onload="alert(1)"></svg>')), null);
    assert.equal(imageType(new TextEncoder().encode('<html>no</html>')), null);
});

test('protected SMS settings round-trip encrypted and never return the key', async t => {
    const { sqlite, env, member } = fixture(t);
    const settings = { apiKey: 'demo-key-not-real', deviceId: 'device-1', enableSmsNotifications: false, enableTrackingSms: true, trackingSmsTemplate: 'Track {trackingLink}' };
    const ciphertext = await encryptSettings(settings, env.GUEST_TOKEN_SECRET);
    assert.equal(ciphertext.includes(settings.apiKey), false);
    sqlite.prepare("INSERT INTO private_settings(name,encrypted_value) VALUES ('sms',?)").run(ciphertext);
    assert.deepEqual(await loadSmsSettings(env), settings);
    const response = await handleSmsRequest(new Request('https://test/api/settings/sms'), env, member);
    const body = await response.json();
    assert.equal(body.configured, true);
    assert.equal(Object.hasOwn(body, 'apiKey'), false);
    const patch = await handleSmsRequest(new Request('https://test/api/settings/sms', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, apiKey: '' })
    }), env, member);
    assert.equal(patch.status, 200);
    assert.equal((await loadSmsSettings(env)).apiKey, settings.apiKey);
    await assert.rejects(loadSmsSettings({ ...env, GUEST_TOKEN_SECRET: 'b'.repeat(64) }));
});

test('SMS and product uploads reject nonowners and disabled memberships', async t => {
    const { sqlite, env, member } = fixture(t);
    await assert.rejects(handleSmsRequest(new Request('https://test/api/settings/sms'), env, { ...member, role: 'print_operator' }),
        { status: 403 });
    sqlite.exec('UPDATE members SET active=0');
    await assert.rejects(handleMediaRequest(new Request('https://test/api/media/products', { method: 'POST', body: 'bad' }), env, member),
        { status: 403 });
});

test('SMS cannot send real notifications while staging', async t => {
    const { env, member } = fixture(t);
    await assert.rejects(handleSmsRequest(new Request('https://test/api/sms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: '09123456789', message: 'Synthetic message', requestId: crypto.randomUUID() })
    }), { ...env, SMS_API_KEY: 'synthetic', SMS_DEVICE_ID: 'test-device' }, member), { status: 409, code: 'sms_staging_disabled' });
});

test('mutations reject cross-origin requests and oversized JSON', async () => {
    assert.throws(() => sameOriginMutation(new Request('https://app.example/api/profile', {
        method: 'PATCH', headers: { Origin: 'https://attacker.example' }
    })), { status: 403 });
    await assert.rejects(readJson(new Request('https://app.example/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'large' })
    }), 5), { status: 413 });
});
