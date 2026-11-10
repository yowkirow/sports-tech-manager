// Preparing an uploaded SVG for the DTF design gallery (owner request 2026-11-09). Runs in the browser.
//
// The file is cleaned so it can't run or load anything. Its CSS is written onto its elements and its ids
// get the design's own prefix, so two designs on one sheet never restyle each other. Its empty margins are
// trimmed, so print sizes and gaps are measured from the artwork itself. The server checks the result again
// (worker/dtf-api.ts).

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
const TRIM_RASTER = 1024;
const INCHES_PER = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4, q: 1 / 101.6, pt: 1 / 72, pc: 1 / 6, px: 1 / 96, '': 1 / 96 };
const PHOTO = /^data:image\/(?:png|jpeg|gif|webp)[;,]/i;
const REMOVED = new Set(['script', 'foreignObject', 'style', 'title', 'desc', 'metadata',
    'animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'discard', 'mpath']);
// Root attributes that describe the file's own viewport; everything else styles the artwork.
const ROOT_ONLY = new Set(['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'baseProfile',
    'zoomAndPan', 'enable-background', 'id', 'class', 'style']);

export const WARNINGS = {
    text: 'Has live text. Convert text to outlines in your design app, or it may print in another font.',
    photo: 'Contains a photo. Check that it is sharp enough at this print size.',
    link: 'A linked image or file was left out. Embed it in the SVG and upload again.',
    animation: 'Animation was removed; the sheet uses the still design.',
    fonts: 'Uses its own fonts, which can\'t be carried over. Convert text to outlines.',
    styles: 'Some of its styles couldn\'t be read, so colors may differ. Check the preview.',
    untrimmed: 'Its empty margins couldn\'t be trimmed, so the size includes them.'
};

/** "12.5mm" → { number: 12.5, unit: 'mm' }. Percentages and font-relative units aren't lengths here. */
export function parseLength(text) {
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(in|cm|mm|q|pt|pc|px)?\s*$/i.exec(String(text ?? ''));
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) ? { number, unit: (match[2] || '').toLowerCase() } : null;
}

export function lengthInInches(text) {
    const length = parseLength(text);
    return length && length.number > 0 ? length.number * INCHES_PER[length.unit] : null;
}

export function parseViewBox(text) {
    const parts = String(text ?? '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) return null;
    return parts;
}

const tidy = number => Number(number.toPrecision(10));

/**
 * The viewBox cut down to the visible pixels. bounds are in raster pixels (right and bottom exclusive),
 * padded by one pixel so anti-aliased edges are never clipped, and kept inside the original box.
 */
export function trimViewBox(viewBox, bounds, raster) {
    const [x, y, width, height] = viewBox;
    const left = Math.max(0, bounds.left - 1);
    const top = Math.max(0, bounds.top - 1);
    const right = Math.min(raster.width, bounds.right + 1);
    const bottom = Math.min(raster.height, bounds.bottom + 1);
    return [tidy(x + (left / raster.width) * width), tidy(y + (top / raster.height) * height),
        tidy(((right - left) / raster.width) * width), tidy(((bottom - top) / raster.height) * height)];
}

/** The smallest box around the pixels with any opacity, or null when there are none. */
export function visibleBounds(pixels, width, height) {
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
            if (pixels[(row * width + column) * 4 + 3] === 0) continue;
            if (column < left) left = column;
            if (column >= right) right = column + 1;
            if (row < top) top = row;
            bottom = row + 1;
        }
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** Print height in inches for a print width, following the design's shape. */
export function heightFor(widthIn, viewBox) {
    return Math.round((widthIn * viewBox[3]) / viewBox[2] * 1000) / 1000;
}

/** "front-logo_v2.svg" → "front logo v2". */
export function designNameFromFile(fileName) {
    const name = String(fileName ?? '').replace(/\.svgz?$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return (name || 'Design').slice(0, 120).trim();
}

/** Splits a selector list on its top-level commas. */
export function splitSelectors(text) {
    const selectors = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (const character of String(text)) {
        if (quote) { if (character === quote) quote = null; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === '(' || character === '[') depth += 1;
        else if (character === ')' || character === ']') depth -= 1;
        else if (character === ',' && depth === 0) { selectors.push(current.trim()); current = ''; continue; }
        current += character;
    }
    if (current.trim()) selectors.push(current.trim());
    return selectors.filter(Boolean);
}

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements], close enough to rank a design's rules. */
export function specificity(selector) {
    const text = String(selector).replace(/"[^"]*"|'[^']*'/g, '');
    const pseudoClass = /(?<!:):(?!:)[\w-]+(?:\([^)]*\))?/g;
    const ids = (text.match(/#[\w-]+/g) || []).length;
    const classes = (text.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length + (text.match(pseudoClass) || []).length;
    const rest = text.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]/g, ' ').replace(pseudoClass, ' ');
    const types = (rest.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) || []).length;
    return [ids, classes, types];
}

const bySpecificity = (left, right) => left.specificity[0] - right.specificity[0] || left.specificity[1] - right.specificity[1]
    || left.specificity[2] - right.specificity[2] || left.order - right.order;

/** Points every internal link (url(#id), href="#id") at the renamed id. */
export function renameReferences(value, rename) {
    return String(value).replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (whole, quote, id) => (rename.has(id) ? `url(#${rename.get(id)})` : whole));
}

// A url() that leads out of the file. The optional quote sits inside the lookahead, so url("#a"), which is how
// the browser writes back every link it read from a stylesheet, stays a link inside the file.
export const externalUrl = value => /url\((?!\s*['"]?\s*#)/i.test(value);

/** Declarations from a CSSStyleDeclaration as [property, value, important] entries. */
function declarations(style) {
    const entries = [];
    for (let index = 0; index < style.length; index++) {
        const property = style[index];
        entries.push([property, style.getPropertyValue(property), style.getPropertyPriority(property) === 'important']);
    }
    return entries;
}

function readStyle(text) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`x{${String(text).replace(/[{}]/g, '')}}`);
    return sheet.cssRules[0] ? declarations(sheet.cssRules[0].style) : [];
}

/** Writes the file's stylesheet onto its elements, following the CSS cascade, then removes it. */
function inlineStylesheets(doc, warnings) {
    const styles = [...doc.getElementsByTagNameNS(SVG_NS, 'style')];
    if (!styles.length) return;
    const matched = new Map();
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(styles.map(style => style.textContent).join('\n').replace(/@import[^;]*;?/gi, ''));
        let order = 0;
        for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) { warnings.add(WARNINGS.fonts); continue; }
            if (!(rule instanceof CSSStyleRule)) continue;
            const entries = declarations(rule.style);
            for (const selector of splitSelectors(rule.selectorText)) {
                let elements;
                try { elements = doc.querySelectorAll(selector); }
                catch { continue; }
                const entry = { specificity: specificity(selector), order: order++, entries };
                for (const element of elements) {
                    if (!matched.has(element)) matched.set(element, []);
                    matched.get(element).push(entry);
                }
            }
        }
    } catch {
        warnings.add(WARNINGS.styles);
    }
    for (const [element, rules] of matched) {
        rules.sort(bySpecificity);
        const inline = element.hasAttribute('style') ? readStyle(element.getAttribute('style')) : [];
        const final = new Map();
        const apply = (entries, important) => {
            for (const [property, value, isImportant] of entries) if (isImportant === important) final.set(property, [value, important]);
        };
        for (const rule of rules) apply(rule.entries, false);
        apply(inline, false);
        for (const rule of rules) apply(rule.entries, true);
        apply(inline, true);
        element.setAttribute('style', [...final].map(([property, [value, important]]) => `${property}:${value}${important ? ' !important' : ''}`).join(';'));
    }
    for (const style of styles) style.remove();
    for (const element of doc.querySelectorAll('[class]')) element.removeAttribute('class');
}

/** Removes anything that could run, load a file or animate, and notes what the owner should know. */
function clean(root, warnings) {
    const walker = root.ownerDocument.createTreeWalker(root, 0xffffffff);
    const doomed = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 8 || node.nodeType === 7) { doomed.push(node); continue; }
        if (node.nodeType !== 1) continue;
        if (node.namespaceURI !== SVG_NS || REMOVED.has(node.localName)) {
            if (/^(?:animate|animateMotion|animateTransform|animateColor|set|discard)$/.test(node.localName)) warnings.add(WARNINGS.animation);
            doomed.push(node);
        }
    }
    for (const node of doomed) node.remove();
    for (const link of [...root.getElementsByTagNameNS(SVG_NS, 'a')]) link.replaceWith(...link.childNodes);

    for (const element of [root, ...root.getElementsByTagName('*')]) {
        for (const attribute of [...element.attributes]) {
            const { name, value, namespaceURI } = attribute;
            const isHref = attribute.localName === 'href' && (namespaceURI === null || namespaceURI === XLINK_NS);
            const foreign = namespaceURI !== null && namespaceURI !== XLINK_NS && namespaceURI !== XML_NS && !name.startsWith('xmlns');
            if (foreign || /^on/i.test(attribute.localName) || /javascript:/i.test(value)) { element.removeAttributeNode(attribute); continue; }
            if (isHref && !value.trim().startsWith('#') && !(element.localName === 'image' && PHOTO.test(value.trim()))) {
                element.removeAttributeNode(attribute);
                warnings.add(WARNINGS.link);
                continue;
            }
            if (name === 'style' && externalUrl(value)) {
                const kept = value.split(';').filter(declaration => !externalUrl(declaration));
                element.setAttribute('style', kept.join(';'));
                warnings.add(WARNINGS.link);
            } else if (name !== 'style' && externalUrl(value)) {
                element.removeAttributeNode(attribute);
                warnings.add(WARNINGS.link);
            }
        }
    }
    // A link-only element left without its link draws nothing useful.
    for (const element of [...root.querySelectorAll('image, use, feImage')]) {
        if (!element.hasAttribute('href') && !element.hasAttributeNS(XLINK_NS, 'href')) element.remove();
        else if (element.localName === 'image') warnings.add(WARNINGS.photo);
    }
    if (root.getElementsByTagNameNS(SVG_NS, 'text').length) warnings.add(WARNINGS.text);
}

/** Gives every id the design's prefix and repoints the links to them. */
function prefixIds(root, prefix) {
    const rename = new Map();
    for (const element of root.querySelectorAll('[id]')) {
        const id = element.getAttribute('id');
        if (!rename.has(id)) rename.set(id, `${prefix}${id}`);
        element.setAttribute('id', rename.get(id));
    }
    if (!rename.size) return;
    for (const element of [root, ...root.getElementsByTagName('*')]) {
        for (const attribute of [...element.attributes]) {
            if (attribute.localName === 'href' && attribute.value.startsWith('#')) {
                const target = attribute.value.slice(1);
                if (rename.has(target)) attribute.value = `#${rename.get(target)}`;
            } else if (attribute.value.includes('url(')) {
                attribute.value = renameReferences(attribute.value, rename);
            }
        }
    }
}

/** Moves the root's styling onto a group, so the root is only the design's own viewport. */
function wrapRoot(root) {
    const doc = root.ownerDocument;
    const group = doc.createElementNS(SVG_NS, 'g');
    for (const attribute of [...root.attributes]) {
        if (attribute.name.startsWith('xmlns') || ROOT_ONLY.has(attribute.localName)) continue;
        group.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        root.removeAttributeNode(attribute);
    }
    if (root.hasAttribute('style')) group.setAttribute('style', root.getAttribute('style'));
    for (const name of [...root.attributes].map(attribute => attribute.name)) {
        if (!['viewBox', 'xmlns', 'xmlns:xlink'].includes(name)) root.removeAttribute(name);
    }
    group.append(...root.childNodes);
    root.append(group);
}

export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The design could not be drawn.'));
        image.src = url;
    });
}

export function svgUrl(svg) {
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

/** Draws the design and returns the box around its visible pixels, or 'unknown' when the browser won't say. */
async function measure(root, viewBox) {
    const scale = TRIM_RASTER / Math.max(viewBox[2], viewBox[3]);
    const width = Math.max(1, Math.round(viewBox[2] * scale));
    const height = Math.max(1, Math.round(viewBox[3] * scale));
    const copy = root.cloneNode(true);
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    // The raster's sides are whole pixels, so its shape differs slightly from the viewBox. Stretching the copy to
    // fill it keeps pixels and viewBox units in step; centred, it would leave empty columns at both ends, and the
    // trim would cut that much off the artwork.
    copy.setAttribute('preserveAspectRatio', 'none');
    const url = svgUrl(new XMLSerializer().serializeToString(copy));
    try {
        const image = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        let pixels;
        try { pixels = context.getImageData(0, 0, width, height).data; }
        catch { return 'unknown'; }
        const bounds = visibleBounds(pixels, width, height);
        return bounds ? { bounds, raster: { width, height } } : null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Cleans, trims and measures an uploaded SVG. Returns the SVG to store, its viewBox, the print width the
 * file itself suggests (inches, or null when it doesn't say) and warnings for the owner.
 */
export async function prepareSvgDesign(text, { id }) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SVG_BYTES) {
        throw new Error('This SVG is larger than 5 MB. Simplify it or export it again.');
    }
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (doc.getElementsByTagName('parsererror').length || root?.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
        throw new Error('This file isn\'t a valid SVG. Export it again as SVG.');
    }
    const width = root.getAttribute('width');
    const height = root.getAttribute('height');
    const pixels = [width, height].map(value => lengthInInches(value));
    let viewBox = parseViewBox(root.getAttribute('viewBox'));
    if (!viewBox && pixels[0] && pixels[1]) viewBox = [0, 0, tidy(pixels[0] * 96), tidy(pixels[1] * 96)];
    if (!viewBox) throw new Error('This SVG has no size. Export it again with a width and height, or a viewBox.');
    // Only real units say how big the design should print; plain pixels are a guess.
    const unit = parseLength(width)?.unit;
    const suggested = pixels[0] ? { inches: pixels[0], fromUnits: ['in', 'cm', 'mm', 'q', 'pt', 'pc'].includes(unit) } : null;

    const warnings = new Set();
    inlineStylesheets(doc, warnings);
    clean(root, warnings);
    prefixIds(root, `d${String(id).replace(/[^0-9a-f]/gi, '').slice(0, 8)}-`);
    wrapRoot(root);
    root.setAttribute('viewBox', viewBox.join(' '));

    const measured = await measure(root, viewBox);
    if (measured === null) throw new Error('This design looks empty. Check that it has visible artwork.');
    let trimmed = viewBox;
    if (measured === 'unknown') warnings.add(WARNINGS.untrimmed);
    else trimmed = trimViewBox(viewBox, measured.bounds, measured.raster);
    root.setAttribute('viewBox', trimmed.join(' '));
    root.setAttribute('width', String(trimmed[2]));
    root.setAttribute('height', String(trimmed[3]));
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const svg = new XMLSerializer().serializeToString(root);
    if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) throw new Error('This SVG is larger than 5 MB. Simplify it or export it again.');
    return {
        svg, viewBox: trimmed, warnings: [...warnings],
        suggestedWidthIn: suggested ? Math.round(suggested.inches * (trimmed[2] / viewBox[2]) * 100) / 100 : null,
        suggestionFromUnits: Boolean(suggested?.fromUnits)
    };
}

/** A stored design's viewBox and inner markup, for composing a sheet. */
export function designParts(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    const viewBox = parseViewBox(root?.getAttribute('viewBox'));
    if (doc.getElementsByTagName('parsererror').length || !viewBox) throw new Error('A design file could not be read. Upload it again.');
    const serializer = new XMLSerializer();
    return { viewBox, inner: [...root.childNodes].map(node => serializer.serializeToString(node)).join('') };
}
