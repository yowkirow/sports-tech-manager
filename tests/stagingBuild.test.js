import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import viteConfig from '../vite.config.js';

test('staging configuration parses and explicitly enables the gated print UI', () => {
    const config = viteConfig({ mode: 'staging', command: 'build' });
    assert.equal(config.define['import.meta.env.VITE_PRINT_QUEUE_ENABLED'], '"true"');
    const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
    assert.match(scripts['build:staging'], /vite build --mode staging/);
    assert.match(scripts['deploy:staging'], /npm run build:staging.*wrangler deploy/);
});

test('the production print UI flag matches the production Worker flag', () => {
    const previous = process.env.VITE_PRINT_QUEUE_ENABLED;
    delete process.env.VITE_PRINT_QUEUE_ENABLED;
    try {
        const config = viteConfig({ mode: 'production', command: 'build' });
        const worker = readFileSync(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8');
        const flag = /"PRINT_QUEUE_ENABLED":\s*"(true|false)"/.exec(worker)?.[1];
        assert.ok(flag);
        assert.equal(config.define['import.meta.env.VITE_PRINT_QUEUE_ENABLED'], JSON.stringify(flag));
    } finally {
        if (previous !== undefined) process.env.VITE_PRINT_QUEUE_ENABLED = previous;
    }
});
