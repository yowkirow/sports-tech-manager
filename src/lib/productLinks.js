import { isBallProduct } from './orderPricing.js';

// Shareable product links (owner request 2026-11-05): /p/<slug> opens that product, and Messenger and
// Facebook preview it with its photo, name and price. Shared by the storefront and the Worker.
//
// The catalog keys a product by its name (its id changes on every edit), so the slug comes from the
// name. The owner's display number ("12. ", "27 ") is left out so renumbering keeps old links working,
// and the color is added only where two products would otherwise share a link (the Black and White
// "Sypik Shirt with Vietnam Flag"). Every form a product could have had still opens it.

const MAX_SLUG = 80;
const NUMBER_PREFIX = /^\s*\d+\s*[.):-]?\s+(?=\S)/;
const PRICE_IN_NAME = /(?:₱|\bphp)\s*\d/i;

export function slugify(value, max = MAX_SLUG) {
    const slug = String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug.length <= max) return slug;
    const cut = slug.slice(0, max + 1);
    const end = cut.lastIndexOf('-');
    return (end >= max / 2 ? cut.slice(0, end) : slug.slice(0, max)).replace(/-+$/, '');
}

// Most preferred first: name without the display number, then with the color, then the full name.
function slugForms(product) {
    const full = slugify(product.name) || 'product';
    const base = slugify(String(product.name ?? '').replace(NUMBER_PREFIX, '')) || full;
    const color = slugify(product.linkedColor);
    return [...new Set([base, color && `${base}-${color}`, full, color && `${full}-${color}`].filter(Boolean))];
}

/** Product name → its link slug: the first form no other product shares. */
export function productSlugs(products = []) {
    const entries = products.map(product => ({ product, forms: slugForms(product) }));
    const owners = new Map();
    for (const { forms } of entries) for (const form of forms) owners.set(form, (owners.get(form) || 0) + 1);
    const slugs = new Map();
    const used = new Set();
    for (const { product, forms } of entries) {
        let slug = forms.find(form => owners.get(form) === 1);
        // Two names that read the same once simplified ("Tee!" and "Tee?") take a counter.
        for (let n = 2; !slug || used.has(slug); n++) slug = `${forms[forms.length - 1]}-${n}`;
        used.add(slug);
        slugs.set(product.name, slug);
    }
    return slugs;
}

/** The raw slug of a /p/<slug> path, or null for any other path. */
export function parseProductPath(pathname) {
    return /^\/p\/([^/]+)\/?$/.exec(String(pathname || ''))?.[1] ?? null;
}

/** The product a link slug opens: its current slug first, then any older form of it. */
export function findProductBySlug(products = [], raw, slugs = productSlugs(products)) {
    let decoded;
    try { decoded = decodeURIComponent(String(raw ?? '')); } catch { return null; }
    // Matched at full length: a canonical slug can be longer than the cap once its color or counter
    // is added, and cutting it would drop exactly what tells two products apart.
    const wanted = slugify(decoded, Infinity);
    if (!wanted) return null;
    const capped = slugify(decoded);
    return products.find(product => slugs.get(product.name) === wanted)
        || products.find(product => slugForms(product).includes(wanted))
        || (capped !== wanted && products.find(product => slugForms(product).includes(capped)))
        || null;
}

const peso = value => `₱${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const ORDERING = 'Order by Thursday, ships Sunday via LBC.';
const PAYMENT = 'Pay by GCash, bank transfer or cash on delivery.';

export const SITE_PREVIEW = {
    title: 'SportsTech PH · Shirts & pickleball gear',
    description: 'Shirts and pickleball gear from SportsTech PH. Order online, pay by GCash, bank transfer or cash on delivery, and track your order.',
    image: '/og-image.jpg',
    imageAlt: 'SportsTech PH: shirts and pickleball gear',
    imageWidth: 1200,
    imageHeight: 630
};

function absoluteImage(value, origin) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim(), origin);
        return url.protocol === 'https:' || url.protocol === new URL(origin).protocol ? url.href : null;
    } catch {
        return null;
    }
}

/** What the shop's home page shows when its link is shared. */
export function sitePreview(origin) {
    return { ...SITE_PREVIEW, type: 'website', pageTitle: SITE_PREVIEW.title, url: `${origin}/`, image: `${origin}${SITE_PREVIEW.image}` };
}

/** The browser tab title of a product page. */
export const productPageTitle = product => `${product.name} | SportsTech PH`;

/** What a product link shows when shared: photo, name and price, and the shop's ordering facts. */
export function productPreview(product, origin, slug) {
    const ball = isBallProduct(product);
    const kind = ball ? 'ball' : product.category && product.category !== 'shirts' ? 'item' : 'shirt';
    const price = Number(product.price);
    const priced = Number.isFinite(price) && price > 0;
    const priceText = priced ? `${peso(price)}${ball ? ' per piece' : ''}` : '';
    const brand = String(product.brand || 'Sypik').trim();
    const description = kind === 'shirt' ? `${brand} shirt, sizes XS to 2XL. ${ORDERING} ${PAYMENT}`
        : kind === 'ball' ? `Pickleball balls: ₱90 each from 21 pieces, ₱80 from 50, ₱70 from 100. ${ORDERING}`
            : `${brand}, from SportsTech PH. ${ORDERING} ${PAYMENT}`;
    const image = absoluteImage(product.imageUrl || product.images?.[0], origin);
    return {
        type: 'product',
        pageTitle: productPageTitle(product),
        title: priceText && !PRICE_IN_NAME.test(product.name) ? `${product.name} · ${priceText}` : product.name,
        description,
        url: `${origin}/p/${slug}`,
        image: image || `${origin}${SITE_PREVIEW.image}`,
        imageAlt: image ? product.name : SITE_PREVIEW.imageAlt,
        ...(image ? {} : { imageWidth: SITE_PREVIEW.imageWidth, imageHeight: SITE_PREVIEW.imageHeight }),
        ...(priced ? { price: String(price), currency: 'PHP' } : {})
    };
}
