import assert from 'node:assert/strict';
import test from 'node:test';
import { findProductBySlug, keepProductLinks, productSlugs } from '../src/lib/productLinks.js';
import { reconstructProducts } from '../src/lib/publicCatalog.js';

const shirt = (name, extra = {}) => ({ name, price: 500, linkedColor: 'Black', brand: 'Sypik', category: 'shirts', order: 9999, ...extra });
const key = name => name.trim().toLowerCase();

// The catalog after a change, the way reconstructProducts folds it: a product saved again keeps its
// place, a deleted or renamed one leaves, and a new name joins at the end.
function applyChange(products, { removed = [], previous = [] }, { saved, pinned }) {
    const byKey = new Map(products.map(product => [key(product.name), product]));
    for (const name of [...removed, ...previous]) byKey.delete(key(name));
    for (const product of [...pinned, ...saved]) byKey.set(key(product.name), product);
    return [...byKey.values()].sort((left, right) => left.order - right.order);
}

test('a stored slug wins over the name, and a malformed one is ignored', () => {
    const products = [shirt('Sypik Neon Pro', { slug: 'sypik-neon' }), shirt('Six Zero Coral', { slug: 'Not A Slug!' })];
    const slugs = productSlugs(products);
    assert.equal(slugs.get('Sypik Neon Pro'), 'sypik-neon');
    assert.equal(slugs.get('Six Zero Coral'), 'six-zero-coral');
    assert.equal(findProductBySlug(products, 'sypik-neon').name, 'Sypik Neon Pro');
    assert.equal(findProductBySlug(products, 'sypik-neon-pro').name, 'Sypik Neon Pro');
});

test('a renamed product keeps its link, and its old and new links both open it', () => {
    const before = [shirt('12. Sypik Neon'), shirt('Six Zero Coral')];
    const result = keepProductLinks(before, { saved: [{ product: { ...before[0], name: '12. Sypik Neon Pro' }, previous: before[0] }] });
    assert.equal(result.saved[0].slug, 'sypik-neon');
    assert.deepEqual(result.pinned, []);
    const after = applyChange(before, { previous: ['12. Sypik Neon'] }, result);
    assert.equal(productSlugs(after).get('12. Sypik Neon Pro'), 'sypik-neon');
    assert.equal(findProductBySlug(after, 'sypik-neon').name, '12. Sypik Neon Pro');
    assert.equal(findProductBySlug(after, 'sypik-neon-pro').name, '12. Sypik Neon Pro');
});

test('saving a product stores the link it already has, and a new product gets its own', () => {
    const before = [shirt('Sypik Neon')];
    const edited = keepProductLinks(before, { saved: [{ product: { ...before[0], price: 550 }, previous: before[0] }] });
    assert.deepEqual(edited.saved.map(product => [product.slug, product.price]), [['sypik-neon', 550]]);
    assert.deepEqual(edited.pinned, []);
    const added = keepProductLinks(before, { saved: [{ product: shirt('Six Zero Coral'), previous: null }] });
    assert.equal(added.saved[0].slug, 'six-zero-coral');
    const overwritten = keepProductLinks(before, { saved: [{ product: shirt('sypik neon', { price: 600 }), previous: null }] });
    assert.equal(overwritten.saved[0].slug, 'sypik-neon');
});

test("a new product whose name reads the same keeps the existing product's link", () => {
    const before = [shirt('12. Sypik Neon', { linkedColor: 'Black' }), shirt('Six Zero Coral')];
    const result = keepProductLinks(before, { saved: [{ product: shirt('27. Sypik Neon', { linkedColor: 'White' }), previous: null }] });
    assert.deepEqual(result.pinned.map(product => [product.name, product.slug]), [['12. Sypik Neon', 'sypik-neon']]);
    assert.equal(result.saved[0].slug, 'sypik-neon-white');
    const slugs = productSlugs(applyChange(before, {}, result));
    assert.deepEqual(Object.fromEntries(slugs), {
        '12. Sypik Neon': 'sypik-neon', 'Six Zero Coral': 'six-zero-coral', '27. Sypik Neon': 'sypik-neon-white'
    });
});

test("deleting one of two products that share a name keeps the other's link", () => {
    const before = [shirt('12. Sypik Neon', { linkedColor: 'Black' }), shirt('27. Sypik Neon', { linkedColor: 'White' })];
    assert.equal(productSlugs(before).get('27. Sypik Neon'), 'sypik-neon-white');
    const result = keepProductLinks(before, { removed: ['12. Sypik Neon'] });
    assert.deepEqual(result.pinned.map(product => [product.name, product.slug]), [['27. Sypik Neon', 'sypik-neon-white']]);
    assert.equal(productSlugs(applyChange(before, { removed: ['12. Sypik Neon'] }, result)).get('27. Sypik Neon'), 'sypik-neon-white');
});

test('a new product never takes the link a renamed product kept', () => {
    const before = [shirt('Sypik Neon Pro', { slug: 'sypik-neon' })];
    const result = keepProductLinks(before, { saved: [{ product: shirt('Sypik Neon', { linkedColor: 'White' }), previous: null }] });
    assert.equal(result.saved[0].slug, 'sypik-neon-white');
    const after = applyChange(before, {}, result);
    assert.equal(findProductBySlug(after, 'sypik-neon').name, 'Sypik Neon Pro');
    assert.equal(findProductBySlug(after, 'sypik-neon-white').name, 'Sypik Neon');
});

test('no product link ever moves through a long run of renames, additions, recolors and deletions', () => {
    const NAMES = ['Tee', 'Tee!', '12. Tee', '27 Tee', 'Neon', 'Neon Pro', '5. Neon', 'Court Shirt', 'Court  Shirt',
        'Six Zero', 'Six-Zero', 'Ball', 'Nelson Balls (21+) per piece', 'Sypik Shirt with Vietnam Flag', '3. Sypik Shirt with Vietnam Flag'];
    const COLORS = ['Black', 'White', 'Teal', ''];
    let pins = 0;
    for (const seed of [20261105, 7, 99991]) {
        let state = seed;
        const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
        const pick = values => values[Math.floor(random() * values.length)];
        // Products saved before links were stored, several of them sharing a simplified name.
        let products = ['Tee', '12. Tee', 'Neon', '5. Neon', 'Court Shirt', 'Court  Shirt', 'Six Zero', 'Six-Zero',
            'Sypik Shirt with Vietnam Flag', '3. Sypik Shirt with Vietnam Flag'].map((name, index) => shirt(name, { linkedColor: COLORS[index % 4] }));
        let order = 0;
        for (let step = 0; step < 300; step++) {
            const before = productSlugs(products);
            const free = NAMES.filter(name => !products.some(product => key(product.name) === key(name)));
            const target = pick(products);
            const op = products.length < 3 ? 'add' : pick(['add', 'rename', 'recolor', 'delete']);
            let change = {};
            let result;
            let origin;
            if (op === 'delete' || (op !== 'recolor' && !free.length)) {
                change = { removed: [target.name] };
                result = keepProductLinks(products, change);
            } else if (op === 'add') {
                const product = shirt(pick(free), { linkedColor: pick(COLORS), order: order++ });
                result = keepProductLinks(products, { saved: [{ product, previous: null }] });
            } else {
                const product = op === 'rename' ? { ...target, name: pick(free) } : { ...target, linkedColor: pick(COLORS) };
                if (op === 'rename') change = { previous: [target.name] };
                origin = [product.name, target.name];
                result = keepProductLinks(products, { saved: [{ product, previous: target }] });
            }
            pins += result.pinned.length;
            products = applyChange(products, change, result);
            const after = productSlugs(products);
            assert.equal(new Set(after.values()).size, products.length, `seed ${seed}, step ${step}: two products share a link`);
            for (const product of products) {
                const from = origin && product.name === origin[0] ? origin[1] : before.has(product.name) ? product.name : null;
                if (from) assert.equal(after.get(product.name), before.get(from), `seed ${seed}, step ${step} (${op}): ${product.name} moved`);
                assert.equal(findProductBySlug(products, after.get(product.name)), product);
            }
        }
    }
    assert.ok(pins >= 5, `only ${pins} untouched products needed their link kept`);
});

test('numbered links follow the product order, so reordering stores each product its current link', () => {
    const products = [shirt('Tee!', { linkedColor: '' }), shirt('Tee?', { linkedColor: '' })];
    const before = productSlugs(products);
    assert.deepEqual([...before.values()], ['tee-2', 'tee-3']);
    const reversed = [...products].reverse();
    assert.equal(productSlugs(reversed).get('Tee!'), 'tee-3');
    const saved = reversed.map((product, order) => ({ ...product, order, slug: before.get(product.name) }));
    assert.deepEqual(Object.fromEntries(productSlugs(saved)), Object.fromEntries(before));
});

test('the catalog carries a stored link, and only a text one', () => {
    const products = reconstructProducts([
        { id: 'neon', type: 'define_product', details: { name: 'Neon Pro', slug: 'neon' } },
        { id: 'court', type: 'define_product', details: { name: 'Court Shirt', slug: 42 } }
    ]);
    assert.deepEqual(products.map(product => [product.name, product.slug]), [['Court Shirt', undefined], ['Neon Pro', 'neon']]);
    assert.equal('slug' in products[0], false);
});
