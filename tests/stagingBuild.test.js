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
