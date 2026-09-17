import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { normalizeDecimal, normalizeTimestamp } from '../worker/order-store.ts';

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
    const separator = argument.indexOf('=');
    assert.ok(argument.startsWith('--') && separator > 2, 'Use --name=value arguments.');
    return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
for (const name of ['source', 'media', 'sms', 'output']) assert.ok(args[name], `--${name} is required.`);
assert.ok(Object.keys(args).every(name => ['source', 'media', 'sms', 'output', 'missing-media', 'validate-only'].includes(name)), 'Unknown migration argument.');
const sourceBytes = readFileSync(resolve(args.source));
const source = JSON.parse(sourceBytes);
assert.equal(source.format, 'sportstech-migration-baseline-v1');
assert.equal(source.transactions.length, source.transaction_count);
assert.equal(new Set(source.transactions.map(row => row.id)).size, source.transaction_count);
const media = JSON.parse(readFileSync(resolve(args.media), 'utf8'));
const sms = JSON.parse(readFileSync(resolve(args.sms), 'utf8'));
const mediaPaths = new Map(media.map(object => [object.name, object.url]));
const missingMedia = args['missing-media']
    ? JSON.parse(readFileSync(resolve(args['missing-media']), 'utf8')) : [];
for (const missing of missingMedia) {
    assert.equal(missing.confirmedMissing, true, 'Missing-file exceptions must be verified against the source.');
    assert.equal(missing.message, 'Object not found');
    assert.ok(missing.url.startsWith('https://dmmydgioujpablalezsn.supabase.co/storage/v1/object/public/product-images/'));
    const hex = createHash('sha256').update(`missing:${missing.path}`).digest('hex').slice(0, 32);
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    assert.ok(!media.some(object => object.id === id));
    // Keep an explicit 404 reference, not a fake successfully copied object.
    mediaPaths.set(missing.path, `/api/media/objects/${id}`);
}
const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
const schema = new DatabaseSync(':memory:');
const migrationDirectory = new URL('../worker/migrations/', import.meta.url);
for (const name of readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()) {
    schema.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
}

function literal(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return String(value); }
    return `'${String(value).replaceAll("'", "''")}'`;
}
function rewrite(value) {
    if (typeof value === 'string' && value.startsWith('https://dmmydgioujpablalezsn.supabase.co/storage/v1/object/public/product-images/')) {
        const name = decodeURIComponent(new URL(value).pathname.slice('/storage/v1/object/public/product-images/'.length));
        assert.ok(mediaPaths.has(name), 'A stored media URL has no verified migration mapping.');
        return mediaPaths.get(name);
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
    return value;
}
function insert(table, row) {
    assert.match(table, /^[a-z_]+$/);
    const columns = schema.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    assert.ok(columns.length, `Target table ${table} is missing.`);
    const fields = Object.keys(row);
    assert.ok(fields.every(key => columns.includes(key)), `Target table ${table} would drop source fields: ${fields.filter(key => !columns.includes(key)).join(', ')}.`);
    assert.ok(fields.length);
    return `INSERT INTO ${table}(${fields.join(',')}) VALUES (${fields.map(key => literal(row[key])).join(',')});`;
}
const statements = [];
const orders = new Set();
const transformed = [];
for (const row of source.transactions) {
    const details = row.details === null ? null : JSON.parse(row.details);
    const key = row.type === 'sale' && details?.club !== 'downtown-dinks' ? (details?.orderId || row.id) : null;
    if (key) orders.add(key);
    transformed.push({
        ...row, amount: normalizeDecimal(row.amount), date: normalizeTimestamp(row.date),
        created_at: normalizeTimestamp(row.created_at),
        details: details === null ? null : JSON.stringify(rewrite(details)), order_id: key
    });
}
for (const id of orders) statements.push(insert('orders', { id, version: 0 }));
for (const row of transformed) statements.push(insert('transactions', row));
for (const row of source.customers) statements.push(insert('customers', {
    ...row, total_spent: normalizeDecimal(row.total_spent || '0'),
    created_at: normalizeTimestamp(row.created_at)
}));
for (const row of source.referrers) statements.push(insert('referrers', {
    ...row, target_reimbursement: normalizeDecimal(row.target_reimbursement || '0'),
    created_at: normalizeTimestamp(row.created_at)
}));
for (const collection of ['transactions', 'admin_directory', 'auth_identity_mapping', 'referrers', 'customers']) {
    for (const row of source[collection]) statements.push(insert('migration_archive', {
        source: collection, source_id: row.id, data: JSON.stringify(row)
    }));
}
for (const object of media) {
    assert.equal(object.uploaded, true);
    statements.push(insert('media_objects', {
        id: object.id, object_key: object.key, visibility: object.visibility,
        content_type: object.contentType, byte_size: object.size, sha256: object.sha256,
        owner_id: null, order_id: orders.has(object.orderId) ? object.orderId : null,
        original_url: object.sourceUrl
    }));
}
for (const settings of sms) statements.push(insert('private_settings', {
    name: settings.name, encrypted_value: settings.encryptedValue
}));
statements.push(insert('migration_runs', {
    export_sha256: sha256, source_exported_at: source.exported_at, transaction_count: source.transaction_count
}));

// Rehearse a full target-schema restore before writing an import file.
schema.exec('BEGIN');
try {
    for (const statement of statements) schema.exec(statement);
    schema.exec('COMMIT');
} catch (error) {
    schema.exec('ROLLBACK');
    throw new Error(`Migration restore rehearsal failed: ${error.message}`);
}
assert.equal(schema.prepare('SELECT count(*) AS n FROM transactions').get().n, source.transaction_count);
const restored = schema.prepare('SELECT id,amount,date,details FROM transactions ORDER BY id').all();
const expected = new Map(transformed.map(row => [row.id, row]));
for (const row of restored) {
    const original = expected.get(row.id);
    assert.equal(row.amount, original.amount);
    assert.equal(row.date, original.date);
    assert.deepEqual(JSON.parse(row.details), JSON.parse(original.details));
}
assert.deepEqual(schema.prepare('PRAGMA foreign_key_check').all(), []);
const output = resolve(args.output);
const summary = {
    sourceSha256: sha256, sourceExportedAt: source.exported_at, transactions: transformed.length,
    orders: orders.size, customers: source.customers.length, referrers: source.referrers.length,
    media: media.length, alreadyMissingMedia: missingMedia.length, archivedIdentities: source.auth_identity_mapping.length,
    restoreRehearsalPassed: true, statements: statements.length
};
if (args['validate-only'] !== 'true') {
    writeFileSync(output, `-- Private migration data. Never commit this file.\n${statements.join('\n')}\n`, { flag: 'wx' });
    writeFileSync(`${output}.summary.json`, JSON.stringify(summary, null, 2));
}
schema.close();
console.log(JSON.stringify({ prepared: true, transactions: transformed.length, orders: orders.size, media: media.length, alreadyMissingMedia: missingMedia.length, restoreRehearsalPassed: true }));
