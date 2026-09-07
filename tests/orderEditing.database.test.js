import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const projectRef = process.env.SUPABASE_DB_TEST_PROJECT_REF;

test('PostgreSQL commits complete orders and rolls back every line on failure', {
    skip: !projectRef && 'Set SUPABASE_DB_TEST_PROJECT_REF to run rollback-only database regressions.',
    timeout: 120000
}, () => {
    assert.match(projectRef, /^[a-z]{20}$/);
    const migration = readFileSync(new URL('../supabase/migrations/20260907070000_save_order_changes.sql', import.meta.url), 'utf8');
    const cases = readFileSync(new URL('./sql/orderEditing.sql', import.meta.url), 'utf8');
    const directory = mkdtempSync(join(tmpdir(), 'sports-tech-atomic-order-'));
    const filename = join(directory, 'rollback-tests.sql');
    try {
        // Both the function definition and synthetic fixtures are rolled back, even on assertion failure.
        writeFileSync(filename, `BEGIN;\nSET LOCAL statement_timeout = '30s';\n${migration}\n${cases}\nROLLBACK;\nSELECT 'atomic_order_tests_passed' AS result;\n`);
        const args = ['--no-install', 'supabase', 'db', 'query', '--linked', '--project-ref', projectRef, '--file', filename, '--output', 'json'];
        const output = process.platform === 'win32'
            ? execSync(`npx --no-install supabase db query --linked --project-ref ${projectRef} --file "${filename}" --output json`, { encoding: 'utf8', timeout: 110000 })
            : execFileSync('npx', args, { encoding: 'utf8', timeout: 110000 });
        assert.match(output, /atomic_order_tests_passed/);
    } finally {
        rmSync(filename, { force: true });
        rmdirSync(directory);
    }
});
