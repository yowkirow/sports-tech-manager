import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SOURCE_PROJECT = 'dmmydgioujpablalezsn';
export const SOURCE_STORAGE_PREFIX = `https://${SOURCE_PROJECT}.supabase.co/storage/v1/object/public/product-images/`;
const SUPABASE_CLI = 'supabase@2.116.0';
const WRANGLER = join(REPOSITORY, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export function parseArgs(argv, allowed, required = []) {
    const args = Object.fromEntries(argv.map(argument => {
        const separator = argument.indexOf('=');
        assert.ok(argument.startsWith('--') && separator > 2, 'Use --name=value arguments.');
        return [argument.slice(2, separator), argument.slice(separator + 1)];
    }));
    const unknown = Object.keys(args).filter(name => !allowed.includes(name));
    assert.deepEqual(unknown, [], `Unknown argument(s): ${unknown.join(', ')}`);
    for (const name of required) assert.ok(args[name], `--${name} is required.`);
    return args;
}

// Customer data, file bytes and keys must never be written inside the Git worktree.
export function privatePath(path, { create = false } = {}) {
    const absolute = resolve(path);
    const fromRepository = relative(REPOSITORY, absolute);
    assert.ok(fromRepository.startsWith('..') || isAbsolute(fromRepository),
        'Private migration files must be stored outside the repository.');
    if (create) mkdirSync(absolute, { recursive: true });
    return absolute;
}

const quote = value => /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;

export function sourceQuery(sqlFile, workDirectory, { allowFailure = false } = {}) {
    // Running from a private directory keeps the CLI's linked-project state out of Git.
    const cwd = privatePath(workDirectory, { create: true });
    const args = ['--no-install', '--prefix', REPOSITORY, SUPABASE_CLI, 'db', 'query', '--linked',
        '--project-ref', SOURCE_PROJECT, '--file', resolve(sqlFile), '--output', 'json'];
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args.map(quote), {
        cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000, shell: true
    });
    if (result.status !== 0) {
        if (allowFailure) return { ok: false, output: `${result.stdout}\n${result.stderr}` };
        throw new Error(`Source query ${sqlFile} failed (exit ${result.status}); raw output withheld.`);
    }
    const start = result.stdout.indexOf('{');
    assert.ok(start >= 0, 'Source query returned no JSON.');
    return { ok: true, rows: JSON.parse(result.stdout.slice(start)).rows };
}

export function wrangler(args, { input, allowFailure = false } = {}) {
    const result = spawnSync(process.execPath, [WRANGLER, ...args], {
        cwd: REPOSITORY, input: input ?? '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000,
        env: { ...process.env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
            WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' }
    });
    if (result.status !== 0 && !allowFailure) {
        const codes = [...`${result.stdout}\n${result.stderr}`.matchAll(/\[code:\s*(\d+)\]/g)].map(match => match[1]);
        throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed (exit ${result.status}, API codes ${codes.join(',') || 'none'}); raw output withheld.`);
    }
    return result;
}

// Accepts a committed JSON-only config or a private generated config for rehearsals.
export function readWranglerConfig(path) {
    const file = resolve(REPOSITORY, path);
    assert.ok(existsSync(file), `Wrangler config ${path} not found.`);
    const config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const [database] = config.d1_databases || [];
    assert.ok(database?.database_name && database?.database_id, 'The config must bind exactly one D1 database.');
    assert.equal(config.d1_databases.length, 1);
    return { file, config, database };
}

export function ensureParent(file) {
    mkdirSync(dirname(file), { recursive: true });
    return file;
}
