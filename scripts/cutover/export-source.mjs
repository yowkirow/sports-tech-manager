import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, privatePath, REPOSITORY, sourceQuery } from './common.mjs';
import { STATUS_SQL } from './source-freeze.mjs';

const DEFAULT_TEMPLATE = 'Hi {customerName}, your SportsTech order is on its way! Track here: {trackingLink}';

// Mirrors the staging rehearsal: one setting per legacy profile, plus the shared
// gateway when every profile uses the same credentials.
export function smsSettings(profiles) {
    const normalized = profiles.map(profile => ({
        name: `legacy-sms:${profile.source_user_id}`,
        settings: {
            ...profile.settings, apiKey: String(profile.settings.apiKey || '').trim(),
            deviceId: String(profile.settings.deviceId || '').trim(),
            trackingSmsTemplate: profile.settings.trackingSmsTemplate || DEFAULT_TEMPLATE
        }
    }));
    const gateways = new Set(normalized.map(({ settings }) => JSON.stringify([settings.apiKey, settings.deviceId])));
    if (profiles.length && gateways.size === 1) {
        normalized.push({ name: 'sms', settings: {
            apiKey: normalized[0].settings.apiKey, deviceId: normalized[0].settings.deviceId,
            enableSmsNotifications: profiles.some(profile => profile.settings.enableSmsNotifications),
            enableTrackingSms: profiles.some(profile => profile.settings.enableTrackingSms),
            trackingSmsTemplate: profiles.find(profile => profile.settings.enableTrackingSms)?.settings.trackingSmsTemplate
                || profiles[0].settings.trackingSmsTemplate || DEFAULT_TEMPLATE
        } });
    }
    return { settings: normalized, uniqueGateways: gateways.size };
}

export function validateExport(data) {
    assert.equal(data?.format, 'sportstech-migration-baseline-v1');
    assert.equal(data.transactions.length, Number(data.transaction_count));
    assert.equal(new Set(data.transactions.map(row => row.id)).size, data.transactions.length);
    for (const row of data.transactions) {
        assert.match(row.amount, /^-?\d+(?:\.\d+)?$/);
        if (row.details !== null) JSON.parse(row.details);
    }
    for (const key of ['customers', 'admin_directory', 'referrers', 'auth_identity_mapping', 'storage_inventory']) {
        assert.ok(Array.isArray(data[key]), `Export is missing ${key}.`);
    }
}

function frozenStatus(work) {
    const file = join(work, 'export-freeze-status.sql');
    writeFileSync(file, STATUS_SQL);
    const status = sourceQuery(file, work).rows[0].status;
    return { ...status, frozen: status.writable_relations === 0 && status.executable_write_routines === 0 };
}

async function main() {
    const args = parseArgs(process.argv.slice(2), ['out-dir', 'work-dir', 'settings-secret-file', 'require-frozen'],
        ['out-dir', 'work-dir', 'settings-secret-file', 'require-frozen']);
    assert.ok(['true', 'false'].includes(args['require-frozen']));
    const out = privatePath(args['out-dir'], { create: true });
    const work = privatePath(args['work-dir'], { create: true });
    const secret = JSON.parse(readFileSync(privatePath(args['settings-secret-file']), 'utf8')).GUEST_TOKEN_SECRET;
    assert.ok(typeof secret === 'string' && secret.length >= 32, 'The target settings key is missing.');
    const before = frozenStatus(work);
    if (args['require-frozen'] === 'true') assert.ok(before.frozen, 'The source still accepts browser writes; freeze it before the final export.');

    const exported = sourceQuery(join(REPOSITORY, 'scripts', 'cutover', 'export-source.sql'), work).rows[0].export;
    validateExport(exported);
    const exportFile = join(out, 'source-export.json');
    writeFileSync(exportFile, JSON.stringify(exported), { flag: 'wx' });
    const bytes = readFileSync(exportFile);

    // Plaintext gateway credentials stay in memory and are encrypted for the target key.
    const profiles = sourceQuery(join(REPOSITORY, 'scripts', 'cutover', 'export-sms.sql'), work).rows[0].profiles;
    assert.ok(Array.isArray(profiles), 'SMS configuration export was incomplete.');
    const { encryptSettings } = await import(pathToFileURL(join(REPOSITORY, 'worker', 'media-api.ts')));
    const prepared = smsSettings(profiles);
    const encrypted = [];
    for (const { name, settings } of prepared.settings) encrypted.push({ name, encryptedValue: await encryptSettings(settings, secret) });
    writeFileSync(join(out, 'sms-settings-encrypted.json'), JSON.stringify(encrypted, null, 2), { flag: 'wx' });

    const after = frozenStatus(work);
    if (args['require-frozen'] === 'true') assert.ok(after.frozen, 'The source was unfrozen during export; discard this export.');
    const summary = {
        exportedAt: exported.exported_at, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength,
        counts: Object.fromEntries(['transactions', 'customers', 'admin_directory', 'referrers', 'auth_identity_mapping', 'storage_inventory']
            .map(key => [key, exported[key].length])),
        transactionTotal: exported.transaction_total,
        smsProfiles: profiles.length, smsUniqueGateways: prepared.uniqueGateways, smsSettingsWritten: encrypted.length,
        sourceFrozenBefore: before.frozen, sourceFrozenAfter: after.frozen,
        finalExport: args['require-frozen'] === 'true' && before.frozen && after.frozen,
        credentialsExportedInPlaintext: false
    };
    writeFileSync(join(out, 'source-export.summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
