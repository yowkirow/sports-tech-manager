import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, privatePath, readWranglerConfig, REPOSITORY, wrangler } from './common.mjs';

// Every table that would hold imported or live business state must start empty.
export const MUST_BE_EMPTY = [
    'transactions', 'orders', 'customers', 'referrers', 'media_objects', 'private_settings', 'migration_archive',
    'migration_runs', 'mutation_receipts', 'activity_events', 'business_events', 'activity_logs', 'member_profiles',
    'transaction_tombstones', 'guest_checkout_receipts', 'guest_receipts', 'guest_order_grants', 'guest_order_receipts',
    'guest_order_events', 'production_jobs', 'production_events', 'production_request_receipts', 'sms_requests'
];
export const RECONCILED = ['transactions', 'orders', 'customers', 'referrers', 'media_objects', 'migration_archive', 'private_settings', 'migration_runs'];

export const preflightSql = () => `SELECT ${MUST_BE_EMPTY.map(table => `(SELECT count(*) FROM ${table}) AS ${table}`).join(', ')},
    (SELECT count(*) FROM members) AS members,
    (SELECT count(*) FROM members WHERE role = 'owner' AND active = 1) AS active_owners,
    (SELECT group_concat(email) FROM members) AS member_emails,
    (SELECT count(*) FROM d1_migrations) AS applied_migrations`;

export function checkPreflight(row, ownerEmail, migrationCount) {
    const occupied = MUST_BE_EMPTY.filter(table => row[table] !== 0);
    assert.deepEqual(occupied, [], `Target already contains data in: ${occupied.join(', ')}. Refusing to import twice.`);
    assert.equal(row.applied_migrations, migrationCount, 'Target schema is not at the repository migration level.');
    assert.equal(row.members, 1, 'Target must contain only the approved owner before import.');
    assert.equal(row.active_owners, 1);
    assert.equal(row.member_emails, ownerEmail.toLowerCase(), 'Target owner differs from the approved owner.');
}

const migrationFiles = () => readdirSync(join(REPOSITORY, 'worker', 'migrations')).filter(name => name.endsWith('.sql')).sort();

// Compares the remote export with a local restore of the same import, column by column.
export function reconcile(importSql, exportedSql, ownerEmail) {
    const expected = new DatabaseSync(':memory:');
    const actual = new DatabaseSync(':memory:');
    try {
        for (const name of migrationFiles()) expected.exec(readFileSync(join(REPOSITORY, 'worker', 'migrations', name), 'utf8'));
        expected.exec(importSql);
        actual.exec(exportedSql);
        const tables = {};
        for (const table of RECONCILED) {
            const columns = expected.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)
                .filter(name => !['updated_at', 'completed_at'].includes(name) && !(table === 'media_objects' && name === 'created_at'));
            const order = table === 'migration_archive' ? 'source,source_id' : table === 'private_settings' ? 'name'
                : table === 'migration_runs' ? 'export_sha256' : 'id';
            const left = expected.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${order}`).all();
            const right = actual.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${order}`).all();
            assert.equal(JSON.stringify(right), JSON.stringify(left), `Exact restore mismatch in ${table}; row contents withheld.`);
            tables[table] = left.length;
        }
        assert.deepEqual(actual.prepare('PRAGMA foreign_key_check').all(), []);
        const members = actual.prepare('SELECT email, role, active FROM members').all();
        assert.deepEqual(members.map(member => ({ ...member })), [{ email: ownerEmail.toLowerCase(), role: 'owner', active: 1 }]);
        const total = actual.prepare('SELECT count(*) AS n FROM transactions').get().n;
        return { exactRestoreMatched: true, tables, members: members.length, transactions: total };
    } finally {
        expected.close();
        actual.close();
    }
}

function remoteJson(configFile, databaseName, sql) {
    const result = wrangler(['d1', 'execute', databaseName, '--remote', '--json', '--command', sql, '--config', configFile]);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))[0].results[0];
}

async function main() {
    const args = parseArgs(process.argv.slice(2), ['config', 'import', 'work-dir', 'owner-email', 'confirm'],
        ['config', 'import', 'work-dir', 'owner-email', 'confirm']);
    const { file: configFile, database } = readWranglerConfig(args.config);
    assert.notEqual(database.database_name, 'sportstech-staging', 'Staging is not a cutover target.');
    assert.equal(args.confirm, `load-${database.database_name}`, `Pass --confirm=load-${database.database_name}.`);
    const work = privatePath(args['work-dir'], { create: true });
    const importFile = privatePath(args.import);
    const importSql = readFileSync(importFile, 'utf8');
    assert.match(importSql, /^-- Private migration data\. Never commit this file\./);

    checkPreflight(remoteJson(configFile, database.database_name, preflightSql()), args['owner-email'], migrationFiles().length);
    wrangler(['d1', 'execute', database.database_name, '--remote', '--file', importFile, '--yes', '--config', configFile]);

    const exportFile = join(work, `${database.database_name}-after-import-${Date.now()}.sql`);
    // The export command prints a signed download URL; stdout is intentionally discarded.
    wrangler(['d1', 'export', database.database_name, '--remote', '--output', exportFile, '--config', configFile]);
    const result = { database: database.database_name, databaseId: database.database_id, checkedAt: new Date().toISOString(),
        ...reconcile(importSql, readFileSync(exportFile, 'utf8'), args['owner-email']) };
    writeFileSync(join(work, `${database.database_name}-reconciliation.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
