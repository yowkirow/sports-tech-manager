import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { smsSettings, validateExport } from '../scripts/cutover/export-source.mjs';
import { cachedCopyValid, classifyMedia, sourcePath } from '../scripts/cutover/sync-media.mjs';
import { checkPreflight, MUST_BE_EMPTY, preflightSql, reconcile } from '../scripts/cutover/load-target.mjs';
import { privatePath } from '../scripts/cutover/common.mjs';

const PREFIX = 'https://dmmydgioujpablalezsn.supabase.co/storage/v1/object/public/product-images/';
const migrations = readdirSync(new URL('../worker/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(`../worker/migrations/${name}`, import.meta.url), 'utf8')).join('\n');
const OWNER = 'owner@example.test';
const ownerSql = `INSERT INTO members(id,email,role,active) VALUES ('owner-id','${OWNER}','owner',1);`;

test('private migration artifacts cannot be written inside the repository', () => {
    assert.throws(() => privatePath(new URL('../tmp/export.json', import.meta.url).pathname.slice(1)), /outside the repository/);
    assert.ok(privatePath('C:\\private\\export.json').endsWith('export.json'));
});

test('media classification keeps receipts private and records only unresolved references as missing', () => {
    const exported = {
        transactions: [
            { id: 'p1', type: 'define_product', details: JSON.stringify({ imageUrl: `${PREFIX}shirt%20one.png`, images: [`${PREFIX}back.png`] }) },
            { id: 's1', type: 'sale', details: JSON.stringify({ orderId: 'ST-1', paymentProof: `${PREFIX}receipt.png`, note: `${PREFIX}gone.png` }) },
            { id: 'p2', type: 'define_product', details: JSON.stringify({ imageUrl: `${PREFIX}receipt.png` }) }
        ],
        storage_inventory: ['shirt one.png', 'back.png', 'receipt.png', 'orphan.png'].map((name, index) => ({
            id: `00000000-0000-4000-8000-00000000000${index}`, bucket_id: 'product-images', name,
            metadata: { mimetype: 'image/png', size: 3, eTag: '"abc"' }
        }))
    };
    const { objects, missingReferences } = classifyMedia(exported);
    assert.deepEqual(objects.map(object => object.visibility), ['public', 'public', 'private', 'private']);
    assert.equal(objects[2].orderId, 'ST-1');
    assert.equal(objects[0].sourceUrl, `${PREFIX}shirt%20one.png`);
    assert.equal(objects[0].key, `migrated/${objects[0].id}`);
    assert.deepEqual(missingReferences, ['gone.png']);
    assert.equal(sourcePath('https://elsewhere.test/x.png'), null);
});

test('cached files are reused only when size and source checksum still match', () => {
    const bytes = Buffer.from('abc');
    const md5 = createHash('md5').update(bytes).digest('hex');
    assert.ok(cachedCopyValid(bytes, { size: 3, eTag: `"${md5}"` }));
    assert.ok(!cachedCopyValid(Buffer.from('abd'), { size: 3, eTag: `"${md5}"` }));
    assert.ok(!cachedCopyValid(bytes, { size: 4, eTag: null }));
    assert.ok(cachedCopyValid(bytes, { size: 3, eTag: '"multipart-etag-2"' }));
});

test('SMS settings preserve legacy profiles and share a gateway only when credentials agree', () => {
    const profile = (id, key, tracking) => ({ source_user_id: id, settings: {
        apiKey: ` ${key} `, deviceId: 'device', enableSmsNotifications: false, enableTrackingSms: tracking, trackingSmsTemplate: null } });
    const shared = smsSettings([profile('a', 'k', false), profile('b', 'k', true)]);
    assert.deepEqual(shared.settings.map(item => item.name), ['legacy-sms:a', 'legacy-sms:b', 'sms']);
    assert.equal(shared.settings[2].settings.apiKey, 'k');
    assert.equal(shared.settings[2].settings.enableTrackingSms, true);
    assert.match(shared.settings[0].settings.trackingSmsTemplate, /\{trackingLink\}/);
    assert.deepEqual(smsSettings([profile('a', 'k1', false), profile('b', 'k2', false)]).settings.map(item => item.name),
        ['legacy-sms:a', 'legacy-sms:b']);
});

test('exports must contain unique transactions with exact decimal text', () => {
    const valid = { format: 'sportstech-migration-baseline-v1', transaction_count: 1, transactions: [{ id: 't', amount: '1.005', details: '{}' }],
        customers: [], admin_directory: [], referrers: [], auth_identity_mapping: [], storage_inventory: [] };
    validateExport(valid);
    assert.throws(() => validateExport({ ...valid, transactions: [{ id: 't', amount: '1e3', details: null }] }));
    assert.throws(() => validateExport({ ...valid, transaction_count: 2 }));
});

test('target preflight refuses non-empty, unmigrated or differently owned databases', () => {
    const clean = Object.fromEntries(MUST_BE_EMPTY.map(table => [table, 0]));
    const row = { ...clean, members: 1, active_owners: 1, member_emails: OWNER, applied_migrations: 6 };
    checkPreflight(row, OWNER.toUpperCase(), 6);
    assert.throws(() => checkPreflight({ ...row, transactions: 1 }, OWNER, 6), /Refusing to import twice/);
    assert.throws(() => checkPreflight({ ...row, applied_migrations: 5 }, OWNER, 6), /migration level/);
    assert.throws(() => checkPreflight({ ...row, members: 2, member_emails: `${OWNER},x@example.test` }, OWNER, 6), /only the approved owner/);
    assert.throws(() => checkPreflight({ ...row, member_emails: 'x@example.test' }, OWNER, 6), /differs/);
    assert.match(preflightSql(), /count\(\*\) FROM production_jobs/);
});

test('reconciliation matches an exact remote restore and detects changed values', () => {
    const importSql = `-- Private migration data. Never commit this file.
INSERT INTO orders(id,version) VALUES ('ST-1',0);
INSERT INTO transactions(id,type,category,amount,date,description,details,order_id,created_at)
    VALUES ('t1','sale','shirts','400.005','2026-09-01T00:00:00.123456Z',NULL,'{"orderId":"ST-1"}','ST-1','2026-09-01T00:00:00Z');
INSERT INTO migration_runs(export_sha256,source_exported_at,transaction_count) VALUES ('hash','2026-10-01T00:00:00Z',1);`;
    const exported = `${migrations}\n${ownerSql}\n${importSql}`;
    const result = reconcile(importSql, exported, OWNER);
    assert.equal(result.exactRestoreMatched, true);
    assert.equal(result.tables.transactions, 1);
    assert.throws(() => reconcile(importSql, exported.replace("'400.005'", "'400.01'"), OWNER), /mismatch in transactions/);
    assert.throws(() => reconcile(importSql, `${migrations}\n${importSql}`, OWNER));
});
