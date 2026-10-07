import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Tailwind inlines @import'ed package CSS without rebasing its relative url()s, so a
// font imported from index.css ships as "./files/*.woff2" and silently 404s to the
// SPA fallback. Vite rewrites and bundles fonts imported from JavaScript.
test('brand fonts are imported through Vite, not inlined by Tailwind', () => {
    assert.doesNotMatch(read('src/index.css'), /@import\s+["']@fontsource\//);
    const main = read('src/main.jsx');
    for (const weight of ['latin-600', 'latin-700', 'latin-800', 'latin-800-italic']) {
        assert.match(main, new RegExp(`import '@fontsource/barlow-condensed/${weight}\\.css'`));
    }
});
