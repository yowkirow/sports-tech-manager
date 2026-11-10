import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { checkSvg, handleDtfRequest } from '../../worker/dtf-api.ts';
import { handleMediaRequest } from '../../worker/media-api.ts';
import { HttpError } from '../../worker/errors.ts';

const directory = new URL('../../worker/migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
const migrations = names.map(name => readFileSync(new URL(name, directory), 'utf8'));
const members = {
    owner: { id: 'owner', email: 'owner@example.invalid', role: 'owner' },
    reseller: { id: 'reseller', email: 'reseller@example.invalid', role: 'reseller' },
    printer: { id: 'printer', email: 'printer@example.invalid', role: 'print_operator' }
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 210" width="350" height="210">'
    + '<defs><linearGradient id="d1-g"><stop offset="0" stop-color="#1d4ed8"/></linearGradient></defs>'
    + '<g style="fill:url(#d1-g)"><rect width="350" height="210" rx="20"/><use href="#d1-g"/></g></svg>';
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        for (const migration of migrations) this.sqlite.exec(migration);
        for (const member of Object.values(members)) {
            this.sqlite.prepare('INSERT INTO members(id,email,role) VALUES (?,?,?)').run(member.id, member.email, member.role);
        }
        this.beforeBatch = null;
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { this.values = values; return this; },
            async all() { return { success: true, results: db.sqlite.prepare(sql).all(...this.values) }; },
            async first() { return db.sqlite.prepare(sql).get(...this.values) ?? null; },
            async run() { db.sqlite.prepare(sql).run(...this.values); return { success: true }; }
        };
    }
    async batch(statements) {
        if (this.beforeBatch) {
            const hook = this.beforeBatch;
            this.beforeBatch = null;
            await hook();
        }
        this.sqlite.exec('BEGIN');
        try {
            const results = statements.map(statement => ({ success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values) }));
            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw new Error(`D1_ERROR: ${error.message}`, { cause: error });
        }
    }
}

function bucket() {
    const objects = new Map();
    return {
        objects,
        async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), options }); },
        async get(key) { const item = objects.get(key); return item ? { body: item.bytes, size: item.bytes.length } : null; },
        async head(key) { return objects.has(key) ? { size: objects.get(key).bytes.length } : null; },
        async delete(key) { objects.delete(key); }
    };
}

function fixture(t) {
    const db = new LocalD1(t);
    const media = bucket();
    return { db, media, env: { DB: db, MEDIA: media, ENVIRONMENT: 'production' } };
}

const ids = ['a1111111-1111-4111-8111-11111111111a', 'b2222222-2222-4222-8222-22222222222b', 'c3333333-3333-4333-8333-33333333333c'];
const upload = (overrides = {}) => ({ id: ids[0], name: 'Court Crest', widthIn: 3.5, heightIn: 2.1, svg: SVG, ...overrides });

async function call(f, path, method = 'GET', body, member = members.owner) {
    const response = await handleDtfRequest(new Request(`https://www.example.test${path}`, {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }), f.env, member);
    assert.ok(response, `${method} ${path} was not handled`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { status: response.status, body: await response.json() };
}
const failure = (status, code) => error => {
    assert.ok(error instanceof HttpError, error.stack);
    assert.equal(error.status, status, error.message);
    if (code) assert.equal(error.code, code);
    return true;
};
const rows = f => f.db.sqlite.prepare('SELECT id,name,width_mils,height_mils,archived_at FROM dtf_designs ORDER BY id').all().map(row => ({ ...row }));

test('the owner uploads a design: a private SVG file plus a gallery entry with its print size', async t => {
    const f = fixture(t);
    const created = await call(f, '/api/dtf/designs', 'POST', upload());
    assert.equal(created.status, 201);
    const { design } = created.body;
    assert.deepEqual({ ...design, svgUrl: undefined, createdAt: undefined, updatedAt: undefined },
        { id: ids[0], name: 'Court Crest', widthIn: 3.5, heightIn: 2.1, svgUrl: undefined, createdAt: undefined, updatedAt: undefined });
    const mediaId = /^\/api\/media\/objects\/([0-9a-f-]{36})$/.exec(design.svgUrl)?.[1];
    assert.ok(mediaId, design.svgUrl);
    const media = { ...f.db.sqlite.prepare('SELECT object_key,visibility,content_type,byte_size,owner_id FROM media_objects WHERE id=?').get(mediaId) };
    assert.deepEqual(media, { object_key: `dtf-designs/${mediaId}`, visibility: 'private', content_type: 'image/svg+xml',
        byte_size: new TextEncoder().encode(SVG).length, owner_id: 'owner' });
    const object = f.media.objects.get(`dtf-designs/${mediaId}`);
    assert.equal(new TextDecoder().decode(object.bytes), SVG);
    assert.deepEqual(object.options.httpMetadata, { contentType: 'image/svg+xml', cacheControl: 'private, no-store' });
    assert.deepEqual(rows(f), [{ id: ids[0], name: 'Court Crest', width_mils: 3500, height_mils: 2100, archived_at: null }]);

    await call(f, '/api/dtf/designs', 'POST', upload({ id: ids[1], name: '  big   back print ', widthIn: 11.25, heightIn: 13.0004 }));
    const { body } = await call(f, '/api/dtf/designs');
    assert.deepEqual(body.designs.map(item => [item.name, item.widthIn, item.heightIn]), [['big back print', 11.25, 13], ['Court Crest', 3.5, 2.1]]);
});

test('only an active owner can use the gallery', async t => {
    const f = fixture(t);
    for (const member of [members.reseller, members.printer]) {
        await assert.rejects(call(f, '/api/dtf/designs', 'GET', undefined, member), failure(403, 'access_denied'));
        await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload(), member), failure(403, 'access_denied'));
    }
    f.db.sqlite.prepare("UPDATE members SET active=0 WHERE id='owner'").run();
    await assert.rejects(call(f, '/api/dtf/designs'), failure(403, 'access_denied'));
    assert.equal(f.media.objects.size, 0);
});

test('a stored SVG is served only to the owner, and only as a download that never runs as a page', async t => {
    const f = fixture(t);
    const { body } = await call(f, '/api/dtf/designs', 'POST', upload());
    const request = () => new Request(`https://www.example.test${body.design.svgUrl}`);
    const response = await handleMediaRequest(request(), f.env, members.owner);
    assert.equal(await response.text(), SVG);
    assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    for (const member of [members.reseller, members.printer]) {
        await assert.rejects(handleMediaRequest(request(), f.env, member), failure(403, 'access_denied'));
    }
});

test('the server refuses an SVG that skipped the app\'s cleaning, and keeps nothing', async t => {
    const f = fixture(t);
    const inside = markup => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${markup}</svg>`;
    const unsafe = [
        inside('<script>alert(1)</script>'), inside('<SCRIPT >alert(1)</SCRIPT>'), inside('<rect onload="alert(1)"/>'),
        inside('<rect\nonclick = "x()"/>'), inside('<foreignObject><div/></foreignObject>'), inside('<style>.a{fill:red}</style>'),
        inside('<svg:style>x</svg:style>'), inside('<image href="https://example.invalid/a.png"/>'),
        inside('<image xlink:href="//example.invalid/a.png"/>'), inside('<use href="other.svg#a"/>'),
        inside('<a href="javascript:alert(1)"><rect/></a>'), inside('<rect style="fill:url(https://example.invalid/p)"/>'),
        inside('<rect style="fill:url(&quot;https://example.invalid/p&quot;)"/>'), inside('<rect style="fill:url(\'//example.invalid/p\')"/>'),
        inside('<image href="data:image/svg+xml;base64,PHN2Zz4="/>'), inside('<image href="data:text/html,hi"/>'),
        inside('<iframe/>'), inside('<g style="@import url(#a)"/>'),
        `<!DOCTYPE svg [<!ENTITY x "y">]>${inside('<rect/>')}`
    ];
    for (const svg of unsafe) {
        await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload({ svg })), failure(422, 'unsafe_svg'), svg);
    }
    for (const svg of ['<html><svg></svg></html>', 'not an svg', '<svg', `${inside('<rect/>')}<rect/>`, 'x\u0000<svg></svg>', 42, null]) {
        await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload({ svg })), failure(415, 'invalid_svg'), String(svg));
    }
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload({ svg: inside(`<desc>${'x'.repeat(5 * 1024 * 1024)}</desc>`) })),
        failure(413, 'payload_too_large'));
    assert.equal(f.media.objects.size, 0);
    assert.deepEqual(rows(f), []);

    // What the app's cleaning keeps: links inside the file and embedded raster photos.
    assert.ok(checkSvg(inside(`<g fill="url(#a)"><use href="#b"/><use xlink:href="#c"/><image href="${PHOTO}"/></g>`)));
    // A link the app couldn't rename stays as the browser wrote it, url("#a"), which arrives as url(&quot;#a&quot;).
    assert.ok(checkSvg(inside('<g style="fill:url(&quot;#a&quot;) rgb(225, 29, 72);clip-path:url( \'#b\' )"><rect fill="url(&apos;#c&apos;)"/></g>')));
    assert.ok(checkSvg(`<?xml version="1.0"?>\n<!-- art -->\n${inside('<animateMotion/>')}\n`), 'only the listed elements are refused');
});

test('names, sizes and fields are checked', async t => {
    const f = fixture(t);
    const bad = [
        [{ name: '' }, 'Use a name'], [{ name: '   ' }, 'Use a name'], [{ name: 'x'.repeat(121) }, 'Use a name'],
        [{ name: 'Tab\tname' }, null], [{ name: 'Bell\u0007' }, 'Use a name'], [{ name: 7 }, 'Give the design a name'],
        [{ widthIn: 0.05 }, 'between 0.1 and 60'], [{ widthIn: 60.5 }, 'between 0.1 and 60'], [{ heightIn: 121 }, 'between 0.1 and 120'],
        [{ widthIn: '3.5' }, 'in inches'], [{ widthIn: null }, 'in inches'], [{ id: 'ST-1' }, 'valid ID'],
        [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase() }, 'valid ID'], [{ extra: true }, 'does not accept']
    ];
    for (const [change, message] of bad) {
        const attempt = call(f, '/api/dtf/designs', 'POST', upload(change));
        if (message === null) { assert.equal((await attempt).body.design.name, 'Tab name'); continue; }
        await assert.rejects(attempt, error => failure(400, 'invalid_design')(error) && error.message.includes(message), JSON.stringify(change));
    }
    const missing = upload();
    delete missing.heightIn;
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', missing), failure(400, 'invalid_design'));
    await assert.rejects(handleDtfRequest(new Request('https://www.example.test/api/dtf/designs', { method: 'POST', body: SVG }), f.env, members.owner),
        failure(415, 'unsupported_content_type'));
});

test('a retried upload returns the saved design; the same ID with another file is refused', async t => {
    const f = fixture(t);
    const first = await call(f, '/api/dtf/designs', 'POST', upload());
    const again = await call(f, '/api/dtf/designs', 'POST', upload());
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first.body);
    assert.equal(f.media.objects.size, 1);
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload({ svg: SVG.replace('#1d4ed8', '#dc2626') })), failure(409, 'design_conflict'));
    await call(f, `/api/dtf/designs/${ids[0]}`, 'DELETE');
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload()), failure(409, 'design_conflict'), 'an archived ID stays used');
});

test('a save that fails removes its file, and two identical saves at once keep one design', async t => {
    const f = fixture(t);
    f.db.beforeBatch = () => { f.db.sqlite.prepare("UPDATE members SET active=0 WHERE id='owner'").run(); };
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload()), /D1_ERROR/);
    assert.equal(f.media.objects.size, 0);
    assert.deepEqual(rows(f), []);
    f.db.sqlite.prepare("UPDATE members SET active=1 WHERE id='owner'").run();

    // Another request saves the same design between this one's check and its write.
    f.db.beforeBatch = async () => {
        f.db.beforeBatch = null;
        await call(f, '/api/dtf/designs', 'POST', upload());
    };
    const raced = await call(f, '/api/dtf/designs', 'POST', upload());
    assert.equal(raced.status, 200);
    assert.equal(rows(f).length, 1);
    assert.equal(f.media.objects.size, 1, 'the losing request removed its copy of the file');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM media_objects').get().n, 1);
});

test('a save D1 reports as failed but that went through keeps its file; when D1 can\'t say, the file stays', async t => {
    const f = fixture(t);
    const log = t.mock.method(console, 'error', () => {});
    const batch = f.db.batch.bind(f.db);
    // The batch commits, then the connection drops before D1 answers.
    f.db.batch = async statements => {
        f.db.batch = batch;
        await batch(statements);
        throw new Error('D1_ERROR: Network connection lost.');
    };
    const saved = await call(f, '/api/dtf/designs', 'POST', upload());
    assert.equal(saved.status, 201);
    assert.equal(rows(f).length, 1);
    assert.equal(f.media.objects.size, 1, 'the saved design keeps its file');
    const file = await handleMediaRequest(new Request(`https://www.example.test${saved.body.design.svgUrl}`), f.env, members.owner);
    assert.equal(await file.text(), SVG);

    // The batch fails and the follow-up lookup fails too: the file can't be shown to be unused, so it stays.
    const prepare = f.db.prepare.bind(f.db);
    f.db.batch = async () => {
        f.db.batch = batch;
        f.db.prepare = () => {
            f.db.prepare = prepare;
            return { bind() { return this; }, async first() { throw new Error('D1_ERROR: unavailable'); } };
        };
        throw new Error('D1_ERROR: Network connection lost.');
    };
    await assert.rejects(call(f, '/api/dtf/designs', 'POST', upload({ id: ids[1] })), /Network connection lost/);
    assert.equal(f.media.objects.size, 2);
    assert.equal(rows(f).length, 1);
    assert.equal(log.mock.callCount(), 1);
    assert.equal(JSON.parse(log.mock.calls[0].arguments[0]).code, 'unconfirmed_dtf_design_upload');
});

test('a design is renamed and resized; a size change sends both width and height', async t => {
    const f = fixture(t);
    await call(f, '/api/dtf/designs', 'POST', upload());
    const renamed = await call(f, `/api/dtf/designs/${ids[0]}`, 'PATCH', { name: 'Left chest crest' });
    assert.deepEqual([renamed.body.design.name, renamed.body.design.widthIn, renamed.body.design.heightIn], ['Left chest crest', 3.5, 2.1]);
    const resized = await call(f, `/api/dtf/designs/${ids[0].toUpperCase()}`, 'PATCH', { widthIn: 4, heightIn: 2.4 });
    assert.deepEqual([resized.body.design.name, resized.body.design.widthIn, resized.body.design.heightIn], ['Left chest crest', 4, 2.4]);
    for (const body of [{}, { widthIn: 5 }, { heightIn: 3 }, { name: '' }, { widthIn: 0, heightIn: 1 }, { svg: SVG }]) {
        await assert.rejects(call(f, `/api/dtf/designs/${ids[0]}`, 'PATCH', body), failure(400, 'invalid_design'), JSON.stringify(body));
    }
    await assert.rejects(call(f, `/api/dtf/designs/${ids[1]}`, 'PATCH', { name: 'Nobody' }), failure(404, 'not_found'));
    assert.deepEqual(rows(f), [{ id: ids[0], name: 'Left chest crest', width_mils: 4000, height_mils: 2400, archived_at: null }]);
});

test('deleting a design hides it from the gallery and keeps its file', async t => {
    const f = fixture(t);
    await call(f, '/api/dtf/designs', 'POST', upload());
    await call(f, '/api/dtf/designs', 'POST', upload({ id: ids[1], name: 'Sleeve mark' }));
    assert.deepEqual((await call(f, `/api/dtf/designs/${ids[0]}`, 'DELETE')).body, { archived: true, id: ids[0] });
    assert.deepEqual((await call(f, '/api/dtf/designs')).body.designs.map(item => item.id), [ids[1]]);
    await assert.rejects(call(f, `/api/dtf/designs/${ids[0]}`, 'DELETE'), failure(404, 'not_found'));
    await assert.rejects(call(f, `/api/dtf/designs/${ids[0]}`, 'PATCH', { name: 'Back again' }), failure(404, 'not_found'));
    assert.ok(rows(f)[0].archived_at);
    assert.equal(f.media.objects.size, 2);
});

test('other paths pass through, and wrong methods or IDs are refused', async t => {
    const f = fixture(t);
    const raw = (path, method = 'GET', member = members.owner) => handleDtfRequest(new Request(`https://www.example.test${path}`, { method }), f.env, member);
    assert.equal(await raw('/api/dtf'), null);
    assert.equal(await raw('/api/dtf/designsx'), null);
    assert.equal(await raw('/api/transactions'), null);
    await assert.rejects(raw('/api/dtf/designs', 'PUT'), failure(405, 'method_not_allowed'));
    await assert.rejects(raw(`/api/dtf/designs/${ids[0]}`, 'GET'), failure(405, 'method_not_allowed'));
    await assert.rejects(raw('/api/dtf/designs/not-an-id', 'DELETE'), failure(404, 'not_found'));
    await assert.rejects(raw(`/api/dtf/designs/${ids[0]}/x`, 'DELETE'), failure(404, 'not_found'));
    await assert.rejects(raw('/api/dtf/designs/not-an-id', 'DELETE', members.reseller), failure(403, 'access_denied'), 'owner check comes first');
});

test('migration 0020 only adds the design table', () => {
    assert.ok(names.includes('0020_dtf_designs.sql'));
    const code = readFileSync(new URL('0020_dtf_designs.sql', directory), 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(code, /\bDROP\b|\bALTER\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
    assert.deepEqual(code.match(/CREATE (?:TABLE|INDEX) \w+/g), ['CREATE TABLE dtf_designs', 'CREATE INDEX dtf_designs_gallery']);
});
