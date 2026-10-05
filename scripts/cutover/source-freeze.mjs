import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, privatePath, sourceQuery } from './common.mjs';

// The legacy app writes with its public browser key. Removing those grants blocks
// every storefront/admin write while keeping reads (and the export role) working.
export const BROWSER_ROLES = ['anon', 'authenticated'];
const SOURCE_ADMIN = 'postgres';
const WRITE_PRIVILEGES = { a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE' };
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SIGNATURE = /^[a-z_][a-z0-9_]*\([a-z0-9_ ,."[\]]*\)$/;

export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
    'taken_at', now(),
    'current_user', current_user,
    'relations', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind,
            'acl', coalesce(c.relacl, acldefault('r', c.relowner))::text[]) ORDER BY c.relname), '[]'::jsonb)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')),
    'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text,
            'security_definer', p.prosecdef, 'volatility', p.provolatile,
            'acl', coalesce(p.proacl, acldefault('f', p.proowner))::text[]) ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p'))
) AS snapshot;`;

// Counts browser-role privileges that could still change source data.
export const STATUS_SQL = `SELECT jsonb_build_object(
    'checked_at', now(),
    'writable_relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND has_table_privilege(r.role, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')),
    'executable_write_routines', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND (p.prosecdef OR p.provolatile = 'v')
            AND has_function_privilege(r.role, p.oid, 'EXECUTE')),
    'readable_relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND has_table_privilege(r.role, c.oid, 'SELECT'))
) AS status`;

export function parseAclItem(item) {
    const match = /^("?)([^=]*)\1=([a-zA-Z*]*)\/(.+)$/.exec(item);
    assert.ok(match, `Unsupported ACL entry ${item}`);
    const privileges = new Set();
    const grantOptions = new Set();
    for (let index = 0; index < match[3].length; index++) {
        const privilege = match[3][index];
        privileges.add(privilege);
        if (match[3][index + 1] === '*') { grantOptions.add(privilege); index++; }
    }
    return { grantee: match[2], privileges, grantOptions, grantor: match[4].replaceAll('"', '') };
}

const roleSql = grantee => grantee === '' ? 'PUBLIC' : grantee;
const browserEntries = acl => acl.map(parseAclItem).filter(entry => entry.grantee === '' || BROWSER_ROLES.includes(entry.grantee));

export function routineName(signature) {
    const local = signature.startsWith('public.') ? signature.slice('public.'.length) : signature;
    assert.match(local, SIGNATURE, `Unsupported routine signature ${signature}`);
    return `public.${local}`;
}

export function planFreeze(snapshot) {
    assert.ok(Array.isArray(snapshot?.relations) && Array.isArray(snapshot?.functions), 'Invalid source privilege snapshot.');
    const revoke = [];
    const restore = [];
    const add = (entry, privileges, target) => {
        // A different grantor's privilege cannot be revoked or faithfully restored by this role.
        assert.equal(entry.grantor, SOURCE_ADMIN, `${target} has a browser grant from ${entry.grantor}; review it manually.`);
        assert.ok(privileges.every(privilege => !entry.grantOptions.has(privilege)), `${target} has a delegable browser grant; review it manually.`);
        const names = privileges.map(privilege => WRITE_PRIVILEGES[privilege] || 'EXECUTE').join(', ');
        revoke.push(`REVOKE ${names} ON ${target} FROM ${roleSql(entry.grantee)}`);
        restore.push(`GRANT ${names} ON ${target} TO ${roleSql(entry.grantee)}`);
    };
    for (const relation of snapshot.relations) {
        assert.match(relation.name, IDENTIFIER, `Unsupported relation name ${relation.name}`);
        for (const entry of browserEntries(relation.acl)) {
            const privileges = Object.keys(WRITE_PRIVILEGES).filter(privilege => entry.privileges.has(privilege));
            if (privileges.length) add(entry, privileges, `TABLE public.${relation.name}`);
        }
    }
    for (const routine of snapshot.functions) {
        // Invoker-rights read routines stay usable; invoker writes are blocked by table grants anyway.
        if (!routine.security_definer && routine.volatility !== 'v') continue;
        const target = `ROUTINE ${routineName(routine.signature)}`;
        for (const entry of browserEntries(routine.acl)) if (entry.privileges.has('X')) add(entry, ['X'], target);
    }
    return { revoke, restore };
}

const quoteLiteral = value => `'${value.replaceAll("'", "''")}'`;

// One DO statement is atomic: a failed check (or the rehearsal's deliberate
// exception) rolls back every privilege change in the block.
export function privilegeBlock(statements, mode) {
    assert.ok(['rehearse', 'freeze', 'unfreeze'].includes(mode));
    const verb = mode === 'unfreeze' ? 'GRANT' : 'REVOKE';
    const pattern = new RegExp(`^${verb} [A-Z, ]+ ON (TABLE|ROUTINE) public\\.[^;'$]+ ${mode === 'unfreeze' ? 'TO' : 'FROM'} [a-zA-Z_]+$`);
    assert.ok(statements.every(statement => pattern.test(statement)), 'Unexpected privilege statement.');
    const finish = {
        rehearse: `RAISE EXCEPTION 'SPORTSTECH_FREEZE_REHEARSAL %', result;`,
        freeze: `IF (result->>'writable_relations')::int <> 0 OR (result->>'executable_write_routines')::int <> 0 THEN
        RAISE EXCEPTION 'SPORTSTECH_FREEZE_INCOMPLETE %', result;
    END IF;`,
        unfreeze: ''
    }[mode];
    return `DO $sportstech$
DECLARE result jsonb;
BEGIN
    PERFORM set_config('lock_timeout', '3000', true);
${statements.map(statement => `    EXECUTE ${quoteLiteral(statement)};`).join('\n')}
    ${STATUS_SQL.replace(/ AS status$/, ' INTO result')};
    ${finish}
END
$sportstech$;`;
}

export function rehearsalResult(output) {
    const marker = output.indexOf('SPORTSTECH_FREEZE_REHEARSAL ');
    if (marker < 0) return null;
    const text = output.slice(marker + 'SPORTSTECH_FREEZE_REHEARSAL '.length).replaceAll('\\"', '"');
    const match = /^\{[^{}]*\}/.exec(text);
    return match ? JSON.parse(match[0]) : null;
}

export function sameAcl(left, right) {
    const key = snapshot => JSON.stringify({
        relations: snapshot.relations.map(relation => [relation.name, [...relation.acl].sort()]),
        functions: snapshot.functions.map(routine => [routine.signature, [...routine.acl].sort()])
    });
    return key(left) === key(right);
}

function run(sql, work, name, options) {
    const file = join(work, `${name}.sql`);
    writeFileSync(file, sql);
    return sourceQuery(file, work, options);
}
const snapshotNow = work => run(SNAPSHOT_SQL, work, 'privilege-snapshot').rows[0].snapshot;
const statusNow = work => run(STATUS_SQL, work, 'freeze-status').rows[0].status;

async function main() {
    const args = parseArgs(process.argv.slice(2), ['mode', 'work-dir', 'snapshot', 'confirm'], ['mode', 'work-dir']);
    const work = privatePath(args['work-dir'], { create: true });
    const before = snapshotNow(work);
    assert.equal(before.current_user, SOURCE_ADMIN);
    if (args.mode === 'status') {
        console.log(JSON.stringify(statusNow(work)));
        return;
    }
    if (args.mode === 'rehearse') {
        const plan = planFreeze(before);
        const result = run(privilegeBlock(plan.revoke, 'rehearse'), work, 'freeze-rehearsal', { allowFailure: true });
        assert.equal(result.ok, false, 'The rehearsal transaction unexpectedly committed.');
        const during = rehearsalResult(result.output);
        assert.ok(during, 'The rehearsal did not reach its verification step; output withheld.');
        const after = snapshotNow(work);
        const report = {
            rehearsedAt: new Date().toISOString(), statements: plan.revoke.length,
            duringRehearsal: during,
            frozenWhileRehearsing: during.writable_relations === 0 && during.executable_write_routines === 0,
            rolledBackExactly: sameAcl(before, after), currentStatus: statusNow(work)
        };
        assert.ok(report.frozenWhileRehearsing, 'The freeze plan does not remove every browser write path.');
        assert.ok(report.rolledBackExactly, 'Source privileges changed after the rehearsal; investigate immediately.');
        writeFileSync(join(work, `freeze-rehearsal-${Date.now()}.json`), JSON.stringify({ ...report, plan }, null, 2));
        console.log(JSON.stringify(report));
        return;
    }
    if (args.mode === 'freeze') {
        assert.equal(args.confirm, 'freeze-sportstech-source', 'Pass --confirm=freeze-sportstech-source to freeze live writes.');
        const plan = planFreeze(before);
        const snapshotFile = join(work, `source-privileges-before-freeze-${Date.now()}.json`);
        writeFileSync(snapshotFile, JSON.stringify(before, null, 2), { flag: 'wx' });
        run(privilegeBlock(plan.revoke, 'freeze'), work, 'freeze');
        const status = statusNow(work);
        assert.equal(status.writable_relations, 0);
        assert.equal(status.executable_write_routines, 0);
        console.log(JSON.stringify({ frozen: true, snapshot: snapshotFile, status }));
        return;
    }
    if (args.mode === 'unfreeze') {
        assert.equal(args.confirm, 'unfreeze-sportstech-source', 'Pass --confirm=unfreeze-sportstech-source to reopen legacy writes.');
        assert.ok(args.snapshot, '--snapshot is required to restore the exact original grants.');
        const original = JSON.parse(readFileSync(resolve(args.snapshot), 'utf8'));
        const plan = planFreeze(original);
        run(privilegeBlock(plan.restore, 'unfreeze'), work, 'unfreeze');
        const after = snapshotNow(work);
        assert.ok(sameAcl(original, after), 'Restored source privileges differ from the saved snapshot.');
        console.log(JSON.stringify({ unfrozen: true, restoredExactly: true, status: statusNow(work) }));
        return;
    }
    throw new Error('Use --mode=status, rehearse, freeze or unfreeze.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
