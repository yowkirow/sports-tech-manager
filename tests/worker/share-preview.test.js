import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../../worker/index.ts';
import { injectPreview, isSharePage } from '../../worker/share-preview.ts';
import {
    findProductBySlug, parseProductPath, productPageTitle, productPreview, productSlugs, sitePreview, slugify
} from '../../src/lib/productLinks.js';

const ORIGIN = 'https://www.sportstechph.store';
const migrationDirectory = new URL('../../worker/migrations/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'));
const uid = value => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const PHOTO = uid(90);

// The real catalog SQL against SQLite, as in public-api.test.js.
class LocalD1 {
    constructor(t) {
        this.sqlite = new DatabaseSync(':memory:');
        migrations.forEach(sql => this.sqlite.exec(sql));
        this.fail = false;
        t.after(() => this.sqlite.close());
    }
    prepare(sql) {
        const db = this;
        return {
            sql, values: [],
            bind(...values) { this.values = values; return this; },
            async all() { return db.execute(this); },
            async first(column) {
                const row = db.execute(this).results[0];
                return column ? row?.[column] ?? null : row ?? null;
            }
        };
    }
    execute(statement) {
        if (this.fail) throw new Error('D1_ERROR: synthetic outage');
        return { success: true, results: this.sqlite.prepare(statement.sql).all(...statement.values), meta: {} };
    }
    async batch(statements) { return statements.map(statement => this.execute(statement)); }
}

const INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="description" content="Shirts and pickleball gear from SportsTech PH." />
  <title>SportsTech PH</title>
  <script type="module" crossorigin src="/assets/index.js"></script>
</head>
<body><div id="root"></div></body>
</html>`;

function fixture(t) {
    const DB = new LocalD1(t);
    const define = (n, details) => DB.sqlite.prepare(`INSERT INTO transactions(id,type,category,amount,date,description,details)
        VALUES (?,'define_product',?,'0',?,'synthetic',?)`).run(uid(n), details.category || 'shirts', `2026-09-0${n}T00:00:00.000Z`, JSON.stringify(details));
    define(1, { name: '12. White Sypik Philippines', price: 500, linkedColor: 'White', category: 'shirts', imageUrl: `/api/media/objects/${PHOTO}`, cost: 'PRIVATE COST' });
    define(2, { name: '25. Sypik Shirt with Vietnam Flag', price: 550, linkedColor: 'Black', category: 'shirts' });
    define(3, { name: '26. Sypik Shirt with Vietnam Flag', price: 550, linkedColor: 'White', category: 'shirts' });
    define(4, { name: 'Nelson CZ-40 Pickleball', price: 100, linkedColor: 'Black', category: 'accessories' });
    define(5, { name: 'Club "Crest" Tee & <Cap>', price: 600, linkedColor: 'Black', category: 'shirts', imageUrl: 'javascript:alert(1)' });
    DB.sqlite.prepare(`INSERT INTO media_objects(id,object_key,visibility,content_type,byte_size,sha256) VALUES (?,?,?,?,?,?)`)
        .run(PHOTO, `products/${PHOTO}`, 'public', 'image/jpeg', 3, 'hash');
    const assetRequests = [];
    const ASSETS = {
        async fetch(request) {
            assetRequests.push(request);
            return new Response(request.method === 'HEAD' ? null : INDEX, { headers: {
                'Content-Type': 'text/html; charset=utf-8', ETag: '"index-etag"', 'Last-Modified': 'Wed, 04 Nov 2026 00:00:00 GMT',
                'Cache-Control': 'public, max-age=0, must-revalidate'
            } });
        }
    };
    const MEDIA = {
        async get(key) { return key === `products/${PHOTO}` ? { body: new Uint8Array([1, 2, 3]) } : null; },
        async head(key) { return key === `products/${PHOTO}` ? { key } : null; }
    };
    const env = {
        ENVIRONMENT: 'production', CANONICAL_HOST: 'www.sportstechph.store', REDIRECT_HOSTS: 'sportstechph.store',
        ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'a'.repeat(64), MUTATIONS_ENABLED: 'true',
        DB, ASSETS, MEDIA
    };
    return { env, DB, assetRequests };
}
const tag = (html, property) => new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)">`).exec(html)?.[1] ?? null;

test('product slugs leave out the display number, add the color only where two products would share one, and resolve old forms', () => {
    assert.equal(slugify('Piña & Café — Tee!'), 'pina-and-cafe-tee');
    assert.equal(slugify('  '), '');
    const long = slugify('38. Six Zero Black Performance Sport Shirt - Go Next Level Series (Full Chest Logo) Extra Words Here');
    assert.ok(long.length <= 80 && !long.endsWith('-'), long);
    const products = [
        { name: '12. White Sypik Philippines', linkedColor: 'White' },
        { name: '25. Sypik Shirt with Vietnam Flag', linkedColor: 'Black' },
        { name: '26. Sypik Shirt with Vietnam Flag', linkedColor: 'White' },
        { name: '27 Teal Logo on Black Shirt', linkedColor: 'Black' },
        { name: 'Tee!', linkedColor: '' },
        { name: 'Tee?', linkedColor: '' }
    ];
    const slugs = productSlugs(products);
    assert.deepEqual([...slugs.values()], [
        'white-sypik-philippines', 'sypik-shirt-with-vietnam-flag-black', 'sypik-shirt-with-vietnam-flag-white',
        'teal-logo-on-black-shirt', 'tee-2', 'tee-3'
    ]);
    assert.equal(new Set(slugs.values()).size, products.length, 'every product has its own link');
    const find = slug => findProductBySlug(products, slug)?.name ?? null;
    assert.equal(find('white-sypik-philippines'), '12. White Sypik Philippines');
    assert.equal(find('12-white-sypik-philippines'), '12. White Sypik Philippines', 'a link with the display number still opens it');
    assert.equal(find('White-Sypik-Philippines'), '12. White Sypik Philippines');
    assert.equal(find('white%20sypik%20philippines'), '12. White Sypik Philippines');
    assert.equal(find('sypik-shirt-with-vietnam-flag-white'), '26. Sypik Shirt with Vietnam Flag');
    assert.equal(find('26-sypik-shirt-with-vietnam-flag'), '26. Sypik Shirt with Vietnam Flag');
    assert.equal(find('sypik-shirt-with-vietnam-flag'), '25. Sypik Shirt with Vietnam Flag', 'a shared base opens the first in shop order');
    assert.equal(find('tee-3'), 'Tee?');
    for (const missing of ['', 'gone-design', '%E0%A4%A']) assert.equal(find(missing), null);
    // Without the White product, the Black one's old color link keeps working.
    assert.equal(findProductBySlug(products.filter(product => !product.name.startsWith('26')), 'sypik-shirt-with-vietnam-flag-black')?.name,
        '25. Sypik Shirt with Vietnam Flag');
    assert.equal(parseProductPath('/p/white-sypik-philippines'), 'white-sypik-philippines');
    assert.equal(parseProductPath('/p/white-sypik-philippines/'), 'white-sypik-philippines');
    for (const path of ['/', '/p/', '/p/a/b', '/track/ST-1', '/admin']) assert.equal(parseProductPath(path), null, path);
    assert.equal(isSharePage('/'), true);
    assert.equal(isSharePage('/p/x'), true);
    assert.equal(isSharePage('/track/ST-1'), false);
});

test('a product preview names the product with its price, uses its own photo, and states only shop facts', () => {
    const shirt = productPreview({ name: '12. White Sypik Philippines', price: 500, brand: 'Sypik', category: 'shirts',
        imageUrl: `/api/media/objects/${PHOTO}` }, ORIGIN, 'white-sypik-philippines');
    assert.deepEqual(shirt, {
        type: 'product', pageTitle: '12. White Sypik Philippines | SportsTech PH', title: '12. White Sypik Philippines · ₱500',
        description: 'Sypik shirt, sizes XS to 2XL. Order by Thursday, ships Sunday via LBC. Pay by GCash, bank transfer or cash on delivery.',
        url: `${ORIGIN}/p/white-sypik-philippines`, image: `${ORIGIN}/api/media/objects/${PHOTO}`, imageAlt: '12. White Sypik Philippines',
        price: '500', currency: 'PHP'
    });
    const ball = productPreview({ name: 'Nelson CZ-40 Pickleball', price: 100, category: 'accessories' }, ORIGIN, 'nelson-cz-40-pickleball');
    assert.equal(ball.title, 'Nelson CZ-40 Pickleball · ₱100 per piece');
    assert.match(ball.description, /^Pickleball balls: ₱90 each from 21 pieces, ₱80 from 50, ₱70 from 100\./);
    assert.equal(ball.image, `${ORIGIN}/og-image.jpg`, 'no photo falls back to the shop card');
    assert.deepEqual([ball.imageWidth, ball.imageHeight], [1200, 630]);
    assert.equal(productPreview({ name: 'Nelson Balls (50-99) (Php 80 per piece)', price: 80, category: 'accessories' }, ORIGIN, 'x').title,
        'Nelson Balls (50-99) (Php 80 per piece)', 'a name that already has the price is left alone');
    const item = productPreview({ name: 'Grip tape', price: 1250, brand: 'Gearbox', category: 'accessories', images: ['https://cdn.example/grip.jpg'] }, ORIGIN, 'grip-tape');
    assert.equal(item.title, 'Grip tape · ₱1,250');
    assert.match(item.description, /^Gearbox, from SportsTech PH\./);
    assert.equal(item.image, 'https://cdn.example/grip.jpg');
    assert.equal(productPreview({ name: 'No price', category: 'shirts', imageUrl: 'data:image/png;base64,AAAA' }, ORIGIN, 'no-price').image,
        `${ORIGIN}/og-image.jpg`);
    assert.equal(productPageTitle({ name: 'Tee' }), 'Tee | SportsTech PH');
    assert.deepEqual(sitePreview(ORIGIN), {
        title: 'SportsTech PH · Shirts & pickleball gear', pageTitle: 'SportsTech PH · Shirts & pickleball gear',
        description: 'Shirts and pickleball gear from SportsTech PH. Order online, pay by GCash, bank transfer or cash on delivery, and track your order.',
        image: `${ORIGIN}/og-image.jpg`, imageAlt: 'SportsTech PH: shirts and pickleball gear', imageWidth: 1200, imageHeight: 630,
        type: 'website', url: `${ORIGIN}/`
    });
});

test('the preview is written into the page head, escaped, once', () => {
    const preview = productPreview({ name: 'Club "Crest" Tee & <Cap>', price: 600, category: 'shirts' }, ORIGIN, 'club-crest-tee-and-cap');
    const html = injectPreview(INDEX, preview);
    assert.match(html, /<title>Club &quot;Crest&quot; Tee &amp; &lt;Cap&gt; \| SportsTech PH<\/title>/);
    assert.equal(tag(html, 'og:title'), 'Club &quot;Crest&quot; Tee &amp; &lt;Cap&gt; · ₱600');
    assert.equal(tag(html, 'description'), preview.description);
    assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.ok(html.indexOf('og:title') < html.indexOf('</head>'));
    assert.ok(!html.includes('<Cap>'));
    assert.equal(tag(html, 'product:price:amount'), '600');
    assert.equal(tag(html, 'twitter:card'), 'summary_large_image');
    assert.equal(injectPreview('<p>no head</p>', preview), '<p>no head</p>');
});

test('product links are served with their preview, the home page with the shop card, and other pages untouched', async t => {
    const { env, DB, assetRequests } = fixture(t);
    const get = (path, init) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env);

    const product = await get('/p/white-sypik-philippines', { headers: { 'If-None-Match': '"index-etag"' } });
    assert.equal(product.status, 200);
    assert.equal(assetRequests.at(-1).headers.get('If-None-Match'), null, 'the page is fetched whole, so it can carry the preview');
    assert.equal(product.headers.get('ETag'), null);
    assert.equal(product.headers.get('Cache-Control'), 'no-cache');
    const html = await product.text();
    assert.equal(tag(html, 'og:title'), '12. White Sypik Philippines · ₱500');
    assert.equal(tag(html, 'og:type'), 'product');
    assert.equal(tag(html, 'og:image'), `${ORIGIN}/api/media/objects/${PHOTO}`);
    assert.equal(tag(html, 'og:url'), `${ORIGIN}/p/white-sypik-philippines`);
    assert.match(html, /<title>12\. White Sypik Philippines \| SportsTech PH<\/title>/);
    assert.ok(!html.includes('PRIVATE COST'));

    const old = await (await get('/p/12-white-sypik-philippines')).text();
    assert.equal(tag(old, 'og:url'), `${ORIGIN}/p/white-sypik-philippines`, 'an older link points to the current one');
    const pair = await (await get('/p/26-sypik-shirt-with-vietnam-flag')).text();
    assert.equal(tag(pair, 'og:url'), `${ORIGIN}/p/sypik-shirt-with-vietnam-flag-white`);
    const unsafe = await (await get('/p/club-crest-tee-and-cap')).text();
    assert.equal(tag(unsafe, 'og:image'), `${ORIGIN}/og-image.jpg`, 'a non-web photo address never reaches the preview');

    for (const path of ['/', '/p/no-such-design']) {
        const page = await (await get(path)).text();
        assert.equal(tag(page, 'og:title'), 'SportsTech PH · Shirts &amp; pickleball gear', path);
        assert.equal(tag(page, 'og:image'), `${ORIGIN}/og-image.jpg`);
        assert.equal(tag(page, 'og:url'), `${ORIGIN}/`);
    }

    const head = await get('/p/white-sypik-philippines', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const tracking = await get('/track/ST-1');
    assert.equal(tracking.headers.get('ETag'), '"index-etag"', 'other pages are served as they are');
    assert.equal(tag(await tracking.text(), 'og:title'), null);

    DB.fail = true;
    const outage = await get('/p/white-sypik-philippines');
    assert.equal(outage.status, 200, 'a catalog outage never takes the shop down');
    assert.equal(tag(await outage.text(), 'og:title'), 'SportsTech PH · Shirts &amp; pickleball gear');
});

test('a shared product photo answers HEAD as well as GET, publicly', async t => {
    const { env } = fixture(t);
    const url = `${ORIGIN}/api/media/objects/${PHOTO}`;
    const head = await worker.fetch(new Request(url, { method: 'HEAD' }), env);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(head.headers.get('Cache-Control'), 'public, max-age=86400');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const get = await worker.fetch(new Request(url), env);
    assert.equal(get.status, 200);
    assert.equal((await get.arrayBuffer()).byteLength, 3);
    const missing = await worker.fetch(new Request(`${ORIGIN}/api/media/objects/${uid(91)}`, { method: 'HEAD' }), env);
    assert.equal(missing.status, 404);
});

test('long names that differ only by color or punctuation still open their own product', () => {
    const name = 'Six Zero Coral Blue Performance Sport Shirt - Go Next Level Series (Full Chest Logo) Extra Long Edition';
    const products = [
        { name: `41. ${name}`, linkedColor: 'Black' },
        { name: `42. ${name}`, linkedColor: 'White' },
        { name: `${name} !`, linkedColor: '' },
        { name: `${name} ?`, linkedColor: '' }
    ];
    const slugs = productSlugs(products);
    assert.equal(new Set(slugs.values()).size, products.length);
    for (const product of products) {
        const slug = slugs.get(product.name);
        assert.ok(slug.length > 80, `${slug} is past the cap once its suffix is added`);
        assert.equal(findProductBySlug(products, slug, slugs)?.name, product.name, slug);
    }
    // The same name typed out in full (past the cap) still opens the design.
    assert.equal(findProductBySlug([{ name, linkedColor: 'Black' }], slugify(name, Infinity))?.name, name);
});

test('a "$" in a product name, brand or photo address is written literally, never as a replacement pattern', () => {
    for (const name of ["Kids $' Tee", 'Tee $& Cap', 'Tee $` Cap', 'Tee $$ Cap', 'Tee $1 Cap']) {
        const preview = productPreview({ name, brand: 'Brand $&', price: 500, category: 'shirts', imageUrl: '/api/media/objects/$&' }, ORIGIN, 'tee');
        const html = injectPreview(INDEX, preview);
        assert.equal((html.match(/<\/head>/g) || []).length, 1, name);
        assert.equal((html.match(/<title>/g) || []).length, 1, name);
        assert.ok(html.indexOf('<script type="module"') < html.indexOf('</head>'), `${name}: the app script stays in the head`);
        const escaped = name.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
        assert.match(html, new RegExp(`<title>${escaped.replace(/[$&|`]/g, char => `\\${char}`)} \\| SportsTech PH</title>`), name);
        assert.equal(tag(html, 'og:title'), `${escaped} · ₱500`, name);
        assert.match(tag(html, 'og:description'), /^Brand \$&amp; shirt/);
    }
});
