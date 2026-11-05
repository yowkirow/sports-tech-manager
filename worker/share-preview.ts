import { findProductBySlug, parseProductPath, productPreview, productSlugs, sitePreview } from '../src/lib/productLinks.js';
import type { AppEnv } from './env.ts';
import { publicProducts } from './public-api.ts';

// Link previews (owner request 2026-11-05). Messenger, Facebook and other link-preview crawlers don't
// run the app, so the shop's home page and every /p/<product> page are served with Open Graph tags
// written into the HTML: the product's photo, name and price, or the shop's share card.

type Preview = {
    type: string; pageTitle: string; title: string; description: string; url: string; image: string; imageAlt: string;
    imageWidth?: number; imageHeight?: number; price?: string; currency?: string;
};

const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const meta = (key: 'property' | 'name', name: string, content: unknown) => `<meta ${key}="${name}" content="${escape(content)}">`;

/** Pages served with a link preview: the shop's home page and product links. */
export const isSharePage = (path: string) => path === '/' || parseProductPath(path) !== null;

/** The page HTML with the preview's title, description, canonical link and Open Graph tags. */
export function injectPreview(html: string, preview: Preview): string {
    if (!html.includes('</head>')) return html;
    const tags = [
        `<link rel="canonical" href="${escape(preview.url)}">`,
        meta('property', 'og:site_name', 'SportsTech PH'),
        meta('property', 'og:type', preview.type),
        meta('property', 'og:title', preview.title),
        meta('property', 'og:description', preview.description),
        meta('property', 'og:url', preview.url),
        meta('property', 'og:image', preview.image),
        meta('property', 'og:image:alt', preview.imageAlt),
        ...(preview.imageWidth ? [meta('property', 'og:image:width', preview.imageWidth), meta('property', 'og:image:height', preview.imageHeight)] : []),
        meta('property', 'og:locale', 'en_PH'),
        ...(preview.price ? [meta('property', 'product:price:amount', preview.price), meta('property', 'product:price:currency', preview.currency)] : []),
        meta('name', 'twitter:card', 'summary_large_image')
    ].join('\n  ');
    // Replacer functions, so a "$" in a product name or photo address is never read as a pattern.
    return html
        .replace(/<title>[^<]*<\/title>/, () => `<title>${escape(preview.pageTitle)}</title>`)
        .replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => meta('name', 'description', preview.description))
        .replace('</head>', () => `  ${tags}\n</head>`);
}

async function previewFor(request: Request, env: AppEnv): Promise<Preview> {
    const url = new URL(request.url);
    const site = sitePreview(url.origin);
    const slug = parseProductPath(url.pathname);
    if (slug === null) return site;
    try {
        const products = await publicProducts(env);
        const slugs = productSlugs(products);
        const product = findProductBySlug(products, slug, slugs);
        return product ? productPreview(product, url.origin, slugs.get(product.name)) : site;
    } catch (error) {
        // A preview never blocks the shop: on any catalog failure the page keeps the shop's card.
        console.error(JSON.stringify({ code: 'share_preview_failed', errorType: error instanceof Error ? error.name : 'UnknownError' }));
        return site;
    }
}

/**
 * Serves a share page: the app's index.html with the preview written in. Asked for without validators,
 * so the body is always there to rewrite; the rewritten page varies with the catalog, so it carries no
 * ETag and is revalidated every time.
 */
export async function sharePage(request: Request, env: AppEnv, assets: { fetch(request: Request): Promise<Response> }): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    const response = await assets.fetch(new Request(request.url, { method: request.method, headers }));
    if (!response.ok || !(response.headers.get('Content-Type') || '').includes('text/html')) return response;
    const out = new Headers(response.headers);
    for (const name of ['ETag', 'Last-Modified', 'Content-Length']) out.delete(name);
    out.set('Cache-Control', 'no-cache');
    if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: out });
    const html = injectPreview(await response.text(), await previewFor(request, env));
    return new Response(html, { status: response.status, headers: out });
}
