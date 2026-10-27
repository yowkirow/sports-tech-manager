import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BATCH_JOBS as WORKER_MAX_BATCH_JOBS } from '../../worker/production-api.ts';
import { MAX_BATCH_JOBS, acceptAllPayload, acceptAllQueue, orderDateLabel, packageItems, packageStatus, packageSummary, printJobMatches, printPackages, visiblePrintPackages, payoutSteps, productionBatchLines, productionCandidates, productionCustomerOf, productionGroupMatches, productionLineKey, productionOrderDateOf, productionOrderGroups, productionQuantity, productionError, walletPeso } from '../../src/lib/production.js';

test('production UI sends only normalized shirt source references and server snapshot tokens', () => {
    const transactions = [
        { id: 'source', type: 'sale', category: 'Shirts', amount: 500, details: {
            customerName: 'PRIVATE', contactNumber: 'PRIVATE', items: [
                { name: 'Shirt', quantity: 2, size: 'M' },
                { name: 'Ball', category: 'Balls', quantity: 1 }
            ]
        } },
        { id: 'removed', type: 'sale', category: 'Shirts', details: { removedFromOrder: true, size: 'M' } }
    ];
    const source = { sourceId: 'source', itemIndex: 0, orderId: 'ST-SAFE', designName: 'Shirt', brand: 'Sypik',
        color: 'Black', size: 'M', required: 2, sourceToken: 'server-hash', customerName: 'PRIVATE' };
    const candidates = productionCandidates(transactions, [source,
        { ...source, itemIndex: 1 }, { ...source, sourceId: 'removed', itemIndex: null }], []);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sourceToken, 'server-hash');
    assert.ok(!JSON.stringify(candidates).includes('PRIVATE'));
    assert.equal(productionCandidates(transactions, [source], [{ sourceId: 'source', itemIndex: 0 }]).length, 0);
    assert.equal(productionLineKey({ sourceId: 'flat', itemIndex: null }), 'flat:-1');
});

test('production UI whole quantities never round decimals, negatives, overflow or empty strings', () => {
    for (const value of ['', '-1', '1.2', '1e1', ' 2 ', '100000000000000000000000', 'abc', 11]) {
        assert.equal(productionQuantity(value, 10), null, String(value));
    }
    assert.equal(productionQuantity('0', 10), null);
    assert.equal(productionQuantity('0', 10, true), 0);
    assert.equal(productionQuantity('3', 10), 3);
    assert.match(productionError({ status: 409 }), /input is still here/);
    assert.match(productionError({ status: 403 }), /assignment changed/);
});

test('wallet money formats exact integer centavos and offers only whole pay steps up to the balance', () => {
    assert.equal(walletPeso(0), '₱0');
    assert.equal(walletPeso(100000), '₱1,000');
    assert.equal(walletPeso(1234500), '₱12,345');
    assert.equal(walletPeso(100050), '₱1,000.50');
    assert.equal(walletPeso(-200000), '−₱2,000');
    assert.equal(walletPeso(1000.5), '₱—');
    assert.equal(walletPeso('100000'), '₱—');
    assert.deepEqual(payoutSteps(300000, 100000), [300000, 200000, 100000]);
    assert.deepEqual(payoutSteps(99999, 100000), []);
    assert.deepEqual(payoutSteps(0, 100000), []);
    assert.deepEqual(payoutSteps(-100000, 100000), []);
    assert.deepEqual(payoutSteps(100000, 0), []);
});

test('owner picker groups shirt lines by the customer who ordered, keeps order numbers, and sends no names', () => {
    const sale = (id, orderId, customerName, date, details = {}) => ({ id, type: 'sale', category: 'Shirts', amount: 500, date,
        details: { orderId, customerName, itemName: 'Shirt', size: 'M', quantity: 1, ...details } });
    const transactions = [
        sale('t1', 'ST-B2', 'zoe Cruz', '2026-10-02T00:00:00Z'),
        sale('t2', 'ST-A1', 'Ana Reyes', '2026-10-05T00:00:00Z', { items: [{ name: 'Club', size: 'M', quantity: 2 }, { name: 'Team', size: 'L', quantity: 1 }] }),
        { id: 't3', type: 'sale', category: 'Shirts', amount: 500, date: '2026-10-01T00:00:00Z', details: { customer: 'Ana Reyes', orderId: 'ST-A0', size: 'S' } }
    ];
    const source = (sourceId, orderId, itemIndex, required, designName) => ({ sourceId, itemIndex, orderId, designName, brand: 'Sypik',
        color: 'White', size: 'M', required, sourceToken: `${sourceId}:${itemIndex}`, designImageUrl: '/api/media/objects/x' });
    const candidates = productionCandidates(transactions, [
        source('t1', 'ST-B2', null, 1, 'Shirt'), source('t2', 'ST-A1', 0, 2, 'Club'), source('t2', 'ST-A1', 1, 1, 'Team'), source('t3', 'ST-A0', null, 1, 'Shirt')
    ], []);
    assert.equal(candidates[0].designImageUrl, '/api/media/objects/x');
    const groups = productionOrderGroups(candidates, transactions);
    assert.deepEqual(groups.map(group => [group.customerName, group.orderId, group.shirts, group.lines.length]), [
        ['Ana Reyes', 'ST-A0', 1, 1], ['zoe Cruz', 'ST-B2', 1, 1], ['Ana Reyes', 'ST-A1', 3, 2]
    ], 'first in, first out: oldest order date first');
    assert.equal(productionGroupMatches(groups[1], 'ZOE'), true);
    assert.equal(productionGroupMatches(groups[1], 'st-b2'), true);
    assert.equal(productionGroupMatches(groups[2], 'team'), true);
    assert.equal(productionGroupMatches(groups[0], 'zoe'), false);
    const payload = productionBatchLines(groups.flatMap(group => group.lines));
    assert.deepEqual(Object.keys(payload[0]).sort(), ['expectedSourceToken', 'itemIndex', 'sourceId']);
    assert.ok(!JSON.stringify(payload).includes('Ana') && !JSON.stringify(payload).includes('zoe'));
    assert.equal(productionCustomerOf(transactions)({ sourceId: 't2' }), 'Ana Reyes');
    assert.equal(productionCustomerOf(transactions)({ sourceId: 'missing' }), '');
    assert.equal(MAX_BATCH_JOBS, 100);
    assert.equal(MAX_BATCH_JOBS, WORKER_MAX_BATCH_JOBS, 'The owner picker and the Worker must agree on the per-save ceiling.');
});

test('picker puts orders without a date last and labels older orders with their year', () => {
    const transactions = [
        { id: 'dated', type: 'sale', category: 'Shirts', date: '2025-12-28T02:00:00Z', details: { orderId: 'ST-OLD', customerName: 'Old', size: 'M' } },
        { id: 'undated', type: 'sale', category: 'Shirts', details: { orderId: 'ST-NODATE', customerName: 'Aaron', size: 'M' } }
    ];
    const source = (sourceId, orderId) => ({ sourceId, itemIndex: null, orderId, designName: 'Shirt', brand: 'Sypik', color: '', size: 'M', required: 1, sourceToken: sourceId });
    const groups = productionOrderGroups(productionCandidates(transactions, [source('undated', 'ST-NODATE'), source('dated', 'ST-OLD')], []), transactions);
    assert.deepEqual(groups.map(group => group.orderId), ['ST-OLD', 'ST-NODATE']);
    const now = new Date('2026-10-13T05:00:00Z');
    assert.equal(orderDateLabel('2026-10-05T02:00:00Z', now), 'Oct 5');
    assert.equal(orderDateLabel('2025-12-28T02:00:00Z', now), 'Dec 28, 2025');
    assert.equal(orderDateLabel('2025-12-31T17:00:00Z', now), 'Jan 1', 'Philippine time decides the day and year');
    assert.equal(orderDateLabel('', now), '');
    assert.equal(orderDateLabel('not a date', now), '');
    assert.equal(productionOrderDateOf(transactions)({ sourceId: 'dated' }), '2025-12-28T02:00:00Z');
    assert.equal(productionOrderDateOf(transactions)({ sourceId: 'undated' }), null);
});

test('accept all QA picks only released, current jobs with shirts awaiting QA, oldest first, with exact counts', () => {
    const job = (id, patch) => ({ id, version: 3, awaitingQA: 2, sourceChanged: false, releasedAt: '2026-10-21T00:00:00Z', status: 'awaiting_qa', ...patch });
    const jobs = [
        job('old'), job('none', { awaitingQA: 0 }), job('changed', { sourceChanged: true }), job('draft', { status: 'draft', releasedAt: null }),
        job('held', { status: 'held', awaitingQA: 1 }), job('done', { status: 'completed' }), job('retired', { status: 'superseded' }), job('new', { awaitingQA: 5, version: 7 })
    ];
    assert.deepEqual(acceptAllQueue(jobs).map(item => item.id), ['old', 'held', 'new']);
    assert.deepEqual(acceptAllPayload(acceptAllQueue(jobs)), [
        { id: 'old', expectedVersion: 3, accepted: 2 }, { id: 'held', expectedVersion: 3, accepted: 1 }, { id: 'new', expectedVersion: 7, accepted: 5 }
    ]);
    assert.deepEqual(acceptAllQueue([]), []);
});

test('print staff jobs group into packages, one per order, in queue order with whole-package totals', () => {
    const job = (id, packageKey, patch) => ({ id, packageKey, jobCode: `PJ-${id.toUpperCase()}`, designName: 'Club Crest Tee', brand: 'Sypik',
        color: 'Black', size: 'M', required: 2, remainingToPrint: 2, awaitingQA: 0, accepted: 0, status: 'released',
        customerName: 'Ana Reyes', bookingNumber: null, ...patch });
    const jobs = [
        job('a1', 'k-ana', { bookingNumber: '1224 8001 5678' }),
        job('z1', 'k-zoe', { customerName: 'Zoë Peña', designName: 'Paddle Club Tee', size: 'XL', required: 1, remainingToPrint: 0, awaitingQA: 1, status: 'awaiting_qa' }),
        job('a2', 'k-ana', { designName: 'Team Dink Tee', size: 'L', required: 3, remainingToPrint: 1, awaitingQA: 1, accepted: 1, status: 'printing' }),
        job('b1', 'k-ana2', { required: 1, remainingToPrint: 0, accepted: 1, status: 'completed' }),
        job('o1', undefined, { orderId: 'ST-OWNER', customerName: 'Owner View' }),
        job('x1', undefined, { customerName: '' })
    ];
    const packages = printPackages(jobs);
    assert.deepEqual(packages.map(pkg => [pkg.key, pkg.jobs.map(item => item.id)]),
        [['k-ana', ['a1', 'a2']], ['k-zoe', ['z1']], ['k-ana2', ['b1']], ['ST-OWNER', ['o1']], ['x1', ['x1']]]);
    const [ana, zoe, ana2, ownerView, nameless] = packages;
    assert.deepEqual([ana.required, ana.toPrint, ana.awaitingQA, ana.accepted, ana.bookingNumber], [5, 3, 1, 1, '1224 8001 5678']);
    assert.deepEqual(packages.map(pkg => pkg.state), ['to_print', 'awaiting_qa', 'ready_to_pack', 'to_print', 'to_print']);
    assert.deepEqual(packages.map(pkg => pkg.sharedName), [true, false, true, false, false], 'two packages for "Ana Reyes" stay separate');
    assert.equal(packageSummary(ana), '5 shirts · 3 to print · 1 awaiting QA · 1 accepted');
    assert.equal(packageSummary(zoe), '1 shirt · 1 awaiting QA');
    assert.equal(packageSummary(ana2), '1 shirt · all accepted');
    assert.equal(packageItems(ana), 'Club Crest Tee · M ×2, Team Dink Tee · L ×3');
    assert.equal(packageStatus[zoe.state], 'Awaiting owner QA');
    assert.equal(ownerView.customerName, 'Owner View');
    assert.equal(nameless.customerName, '');
});

test('print staff search matches name, booking number, design, size and job code across every word', () => {
    const job = (id, key, patch) => ({ id, packageKey: key, jobCode: `PJ-${id.toUpperCase()}`, designName: 'Club Crest Tee', brand: 'Sypik',
        color: 'Black', size: 'M', required: 1, remainingToPrint: 1, awaitingQA: 0, accepted: 0, status: 'released',
        customerName: 'Ana Reyes', bookingNumber: '1224 8001 5678', ...patch });
    const packages = printPackages([
        job('a1', 'k-ana'), job('a2', 'k-ana', { designName: 'Team Dink Tee', size: 'XL', color: 'White' }),
        job('z1', 'k-zoe', { customerName: 'Zoë Peña', bookingNumber: null, status: 'completed', remainingToPrint: 0, accepted: 1 })
    ]);
    const visible = (filter, query) => visiblePrintPackages(packages, filter, query).map(pkg => [pkg.key, pkg.visibleJobs.map(item => item.id)]);
    assert.deepEqual(visible('active', ''), [['k-ana', ['a1', 'a2']]], 'In progress hides accepted jobs');
    assert.deepEqual(visible('completed', ''), [['k-zoe', ['z1']]]);
    assert.deepEqual(visible('all', 'ana'), [['k-ana', ['a1', 'a2']]], 'a name match shows the whole package');
    assert.deepEqual(visible('all', 'ANA team'), [['k-ana', ['a2']]], 'every word must match');
    assert.deepEqual(visible('all', 'xl'), [['k-ana', ['a2']]]);
    assert.deepEqual(visible('all', '122480015678'), [['k-ana', ['a1', 'a2']]], 'booking number without spaces');
    assert.deepEqual(visible('all', '1224-8001'), [['k-ana', ['a1', 'a2']]], 'booking number with a dash');
    assert.deepEqual(visible('all', 'pj-a2'), [['k-ana', ['a2']]], 'job code');
    assert.deepEqual(visible('all', 'pena'), [['k-zoe', ['z1']]], 'accents are ignored');
    assert.deepEqual(visible('all', 'nobody'), []);
    assert.deepEqual(visible('all', '   '), visible('all', ''));
    assert.equal(printJobMatches(packages[0], packages[0].jobs[0], 'white'), false);
});
