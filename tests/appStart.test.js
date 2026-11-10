import assert from 'node:assert/strict';
import test from 'node:test';
import { isInstalledApp, startTab } from '../src/lib/appStart.js';

const windowWith = ({ standaloneMedia = false, iosStandalone, matchMedia = true } = {}) => ({
    matchMedia: matchMedia ? query => ({ matches: query === '(display-mode: standalone)' && standaloneMedia }) : undefined,
    navigator: iosStandalone === undefined ? {} : { standalone: iosStandalone }
});

test('the installed app opens on Orders; a browser tab opens on the Point of Sale', () => {
    assert.equal(startTab(windowWith({ standaloneMedia: true })), 'orders', 'installed on Android or a computer');
    assert.equal(startTab(windowWith({ iosStandalone: true })), 'orders', 'added to an iPhone home screen');
    assert.equal(startTab(windowWith()), 'pos');
    assert.equal(startTab(windowWith({ iosStandalone: false })), 'pos');
});

test('a browser without display-mode queries counts as a browser tab', () => {
    assert.equal(isInstalledApp(windowWith({ matchMedia: false })), false);
    assert.equal(isInstalledApp(windowWith({ matchMedia: false, iosStandalone: true })), true);
});
