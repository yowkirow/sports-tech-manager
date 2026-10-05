import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, privatePath, readWranglerConfig, REPOSITORY, SOURCE_STORAGE_PREFIX } from './common.mjs';

const WRANGLER = join(REPOSITORY, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export function sourcePath(value) {
    if (typeof value !== 'string' || !value.startsWith(SOURCE_STORAGE_PREFIX)) return null;
    return decodeURIComponent(new URL(value).pathname.slice(new URL(SOURCE_STORAGE_PREFIX).pathname.length));
}
function walk(value, visit, key = '') {
    if (typeof value === 'string') visit(value, key);
    else if (Array.isArray(value)) value.forEach(item => walk(item, visit, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => walk(item, visit, name));
}

// Product images are public; receipts/proofs and anything unclassified stay private.
export function classifyMedia(exported) {
    const productPaths = new Set();
    const receiptPaths = new Map();
    const referenced = new Set();
    for (const row of exported.transactions) {
        const details = row.details ? JSON.parse(row.details) : {};
        walk(details, (value, key) => {
            const path = sourcePath(value);
            if (!path) return;
            referenced.add(path);
            if (row.type === 'define_product' && ['imageUrl', 'images'].includes(key)) productPaths.add(path);
            if (row.type === 'sale' && /proof|receipt/i.test(key)) receiptPaths.set(path, details.orderId || row.id);
        });
    }
    const objects = exported.storage_inventory.map(object => {
        assert.equal(object.bucket_id, 'product-images');
        assert.match(object.id, /^[0-9a-f-]{36}$/i);
        const privateReceipt = receiptPaths.has(object.name);
        return {
            id: object.id, name: object.name, key: `migrated/${object.id}`,
            sourceUrl: `${SOURCE_STORAGE_PREFIX}${object.name.split('/').map(encodeURIComponent).join('/')}`,
            url: `/api/media/objects/${object.id}`,
            visibility: productPaths.has(object.name) && !privateReceipt ? 'public' : 'private',
            orderId: receiptPaths.get(object.name) || null,
            contentType: object.metadata?.mimetype || 'application/octet-stream',
            size: Number(object.metadata?.size), eTag: object.metadata?.eTag || null
        };
    });
    const stored = new Set(objects.map(object => object.name));
    return { objects, missingReferences: [...referenced].filter(path => !stored.has(path)).sort() };
}

export function cachedCopyValid(bytes, object) {
    if (bytes.length !== object.size) return false;
    const md5 = /^"?([0-9a-f]{32})"?$/.exec(object.eTag || '')?.[1];
    return !md5 || createHash('md5').update(bytes).digest('hex') === md5;
}

function wranglerAsync(args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, [WRANGLER, ...args], {
            cwd: REPOSITORY, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' }
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`wrangler ${args[0]} ${args[1]} ${args[2]} failed (exit ${code}); raw output withheld.`)));
    });
}

async function pool(items, limit, worker) {
    let index = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
        while (index < items.length) await worker(items[index++]);
    }));
}

async function main() {
    const args = parseArgs(process.argv.slice(2), ['export', 'cache-dir', 'config', 'manifest', 'missing', 'verify-all'],
        ['export', 'cache-dir', 'config', 'manifest', 'missing']);
    const exported = JSON.parse(readFileSync(privatePath(args.export), 'utf8'));
    const cache = privatePath(args['cache-dir'], { create: true });
    const manifestFile = privatePath(args.manifest);
    const { config, file: configFile } = readWranglerConfig(args.config);
    const bucket = config.r2_buckets?.[0]?.bucket_name;
    assert.ok(bucket && config.r2_buckets.length === 1, 'The config must bind exactly one media bucket.');
    const previous = new Map(existsSync(manifestFile)
        ? JSON.parse(readFileSync(manifestFile, 'utf8')).map(item => [item.id, item]) : []);
    const { objects, missingReferences } = classifyMedia(exported);

    // A referenced file absent from storage is recorded only after the source confirms it is missing.
    const missing = [];
    for (const path of missingReferences) {
        const url = `${SOURCE_STORAGE_PREFIX}${path.split('/').map(encodeURIComponent).join('/')}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const body = await response.json().catch(() => ({}));
        assert.ok(!response.ok && body.message === 'Object not found', `Referenced source file ${path} is neither inventoried nor confirmed missing.`);
        missing.push({ path, url, status: response.status, error: body.error, message: body.message, confirmedMissing: true });
    }

    let downloaded = 0, uploaded = 0, verified = 0;
    const manifest = new Map();
    await pool(objects, 4, async object => {
        const file = join(cache, `${object.id}.bin`);
        let bytes = existsSync(file) ? readFileSync(file) : null;
        if (!bytes || !cachedCopyValid(bytes, object)) {
            const response = await fetch(object.sourceUrl, { signal: AbortSignal.timeout(120000) });
            assert.ok(response.ok, `Source file ${object.id} download returned HTTP ${response.status}.`);
            bytes = Buffer.from(await response.arrayBuffer());
            assert.ok(cachedCopyValid(bytes, object), `Source file ${object.id} failed size/checksum validation.`);
            writeFileSync(`${file}.partial`, bytes);
            renameSync(`${file}.partial`, file);
            downloaded++;
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const prior = previous.get(object.id);
        const current = prior?.uploaded === true && prior.bucket === bucket && prior.sha256 === sha256;
        if (!current) {
            await wranglerAsync(['r2', 'object', 'put', `${bucket}/${object.key}`, '--remote', '--file', file,
                '--content-type', object.contentType, '--force', '--config', configFile]);
            uploaded++;
        }
        if (!current || args['verify-all'] === 'true') {
            const check = join(cache, `${object.id}.verify`);
            await wranglerAsync(['r2', 'object', 'get', `${bucket}/${object.key}`, '--remote', '--file', check, '--config', configFile]);
            const roundTrip = readFileSync(check);
            unlinkSync(check);
            assert.equal(createHash('sha256').update(roundTrip).digest('hex'), sha256, `R2 content mismatch for ${object.id}.`);
            verified++;
        }
        const { eTag, ...item } = object;
        manifest.set(object.id, { ...item, size: bytes.length, sha256, bucket, uploaded: true });
        if (manifest.size % 25 === 0) console.log(`Synchronized ${manifest.size}/${objects.length} files`);
    });
    const result = objects.map(object => manifest.get(object.id));
    writeFileSync(`${manifestFile}.partial`, JSON.stringify(result, null, 2));
    renameSync(`${manifestFile}.partial`, manifestFile);
    writeFileSync(privatePath(args.missing), JSON.stringify(missing, null, 2));
    console.log(JSON.stringify({
        bucket, objects: result.length, bytes: result.reduce((sum, item) => sum + item.size, 0),
        publicImages: result.filter(item => item.visibility === 'public').length,
        privateObjects: result.filter(item => item.visibility === 'private').length,
        downloaded, uploaded, roundTripVerified: verified, confirmedMissingReferences: missing.length
    }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
