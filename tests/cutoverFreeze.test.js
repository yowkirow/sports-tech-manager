import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAclItem, planFreeze, privilegeBlock, rehearsalResult, routineName, sameAcl } from '../scripts/cutover/source-freeze.mjs';

const full = role => `${role}=arwdDxtm/postgres`;
const snapshot = {
    relations: [
        { name: 'transactions', kind: 'r', acl: ['postgres=arwdDxtm/postgres', full('anon'), full('authenticated'), full('service_role')] },
        { name: 'monthly_leaderboard', kind: 'v', acl: ['postgres=arwdDxtm/postgres', 'anon=r/postgres'] }
    ],
    functions: [
        { signature: 'save_order_changes(jsonb,boolean)', security_definer: false, volatility: 'v',
            acl: ['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres'] },
        { signature: 'public.read_totals(text)', security_definer: false, volatility: 's', acl: ['=X/postgres', 'anon=X/postgres'] },
        { signature: 'admin_write()', security_definer: true, volatility: 's', acl: ['=X/postgres'] }
    ]
};

test('ACL entries keep grantee, privileges, grant options and grantor', () => {
    const entry = parseAclItem('authenticated=ar*w/postgres');
    assert.equal(entry.grantee, 'authenticated');
    assert.deepEqual([...entry.privileges], ['a', 'r', 'w']);
    assert.deepEqual([...entry.grantOptions], ['r']);
    assert.equal(entry.grantor, 'postgres');
    assert.equal(parseAclItem('=X/postgres').grantee, '');
});

test('freeze removes only browser write paths and restores exactly those grants', () => {
    const plan = planFreeze(snapshot);
    assert.deepEqual(plan.revoke, [
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.transactions FROM anon',
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.transactions FROM authenticated',
        'REVOKE EXECUTE ON ROUTINE public.save_order_changes(jsonb,boolean) FROM anon',
        'REVOKE EXECUTE ON ROUTINE public.save_order_changes(jsonb,boolean) FROM authenticated',
        'REVOKE EXECUTE ON ROUTINE public.admin_write() FROM PUBLIC'
    ]);
    assert.deepEqual(plan.restore, plan.revoke.map(statement => statement.replace('REVOKE', 'GRANT').replace(' FROM ', ' TO ')));
    assert.ok(plan.revoke.every(statement => !/SELECT|service_role|postgres$/.test(statement)));
    assert.ok(!plan.revoke.some(statement => statement.includes('read_totals')), 'Invoker read routines remain usable.');
});

test('freeze refuses grants it cannot faithfully revoke or restore', () => {
    assert.throws(() => planFreeze({ relations: [{ name: 'transactions', acl: ['anon=a/supabase_admin'] }], functions: [] }), /review it manually/);
    assert.throws(() => planFreeze({ relations: [{ name: 'transactions', acl: ['anon=a*/postgres'] }], functions: [] }), /delegable/);
    assert.throws(() => planFreeze({ relations: [{ name: 'bad;name', acl: [] }], functions: [] }), /Unsupported relation/);
    assert.throws(() => routineName('evil(); DROP TABLE x;--()'), /Unsupported routine/);
});

test('privilege blocks are atomic and the rehearsal always raises to roll back', () => {
    const plan = planFreeze(snapshot);
    const rehearsal = privilegeBlock(plan.revoke, 'rehearse');
    assert.match(rehearsal, /^DO \$sportstech\$/);
    assert.match(rehearsal, /RAISE EXCEPTION 'SPORTSTECH_FREEZE_REHEARSAL %', result;/);
    assert.match(rehearsal, /set_config\('lock_timeout', '3000', true\)/);
    assert.match(privilegeBlock(plan.revoke, 'freeze'), /SPORTSTECH_FREEZE_INCOMPLETE/);
    assert.match(privilegeBlock(plan.restore, 'unfreeze'), /GRANT INSERT/);
    assert.throws(() => privilegeBlock(plan.restore, 'freeze'), /Unexpected privilege statement/);
    assert.throws(() => privilegeBlock(["REVOKE INSERT ON TABLE public.x FROM anon; DROP TABLE y"], 'freeze'), /Unexpected/);
});

test('rehearsal output parsing tolerates escaped CLI errors and missing markers', () => {
    const text = 'ERROR: P0001: SPORTSTECH_FREEZE_REHEARSAL {\\"checked_at\\": \\"now\\", \\"writable_relations\\": 0}\nCONTEXT';
    assert.deepEqual(rehearsalResult(text), { checked_at: 'now', writable_relations: 0 });
    assert.equal(rehearsalResult('ERROR: lock timeout'), null);
});

test('ACL comparison ignores entry order but not privilege changes', () => {
    const reordered = structuredClone(snapshot);
    reordered.relations[0].acl.reverse();
    assert.ok(sameAcl(snapshot, reordered));
    const changed = structuredClone(snapshot);
    changed.relations[0].acl[1] = 'anon=r/postgres';
    assert.ok(!sameAcl(snapshot, changed));
});
