// The Meta Pixel on the public shop (/ and /p/*). Owner decision 2026-11-05: it loads for every
// visitor, a one-time notice says so, and anyone can turn it off: from the notice, on /privacy, or
// with their browser's Global Privacy Control. It never loads on /privacy, /track, /admin or /print.
const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || '';
// Only the real shop sends events: never staging, a workers.dev address or a local preview.
const SHOP_HOSTS = new Set(['sportstechph.store', 'www.sportstechph.store']);
const CHOICE_KEY = 'sportstech:meta-cookies';
const SCRIPT_URL = 'https://connect.facebook.net/en_US/fbevents.js';
// An ad click's ID, read before the shop tidies the address bar; Meta's script loads later.
const AD_CLICK_ID = (() => {
    try {
        const id = new URLSearchParams(window.location.search).get('fbclid');
        return id && /^[\w-]{1,500}$/.test(id) ? id : null;
    } catch {
        return null;
    }
})();

export const pixelConfigured = () => /^\d{6,20}$/.test(PIXEL_ID) && SHOP_HOSTS.has(window.location.hostname);

// Stored: 'on' (Turn on at /privacy), 'off' (Turn off) or 'seen' (the notice's Got it). Memory covers
// this page when storage is blocked, and a Turn off made on this page always holds here.
let memoryChoice = null;
function storedChoice() {
    if (memoryChoice === 'off') return 'off';
    try {
        const value = localStorage.getItem(CHOICE_KEY);
        return ['on', 'off', 'seen'].includes(value) ? value : memoryChoice;
    } catch {
        return memoryChoice;
    }
}
const browserOptOut = () => typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true;

/** 'on' or 'off' in this browser. Only an explicit Turn on outranks Global Privacy Control. */
export function pixelChoice() {
    const stored = storedChoice();
    if (stored === 'on' || stored === 'off') return stored;
    return browserOptOut() ? 'off' : 'on';
}
/** True when the visitor's own Turn on or Turn off decided, not the default or their browser. */
export const pixelChoiceIsExplicit = () => ['on', 'off'].includes(storedChoice());
/** True when the browser's Global Privacy Control asks sites not to share the visitor's data. */
export const pixelBrowserOptOut = browserOptOut;
/** The one-time notice shows until the visitor answers it, and never while the Pixel is off. */
export const pixelNoticeNeeded = () => pixelConfigured() && storedChoice() === null && pixelChoice() === 'on';

function clearMetaCookies() {
    const labels = window.location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < labels.length - 1; i++) domains.push(labels.slice(i).join('.'));
    for (const name of ['_fbp', '_fbc']) {
        for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
}
function remember(value) {
    memoryChoice = value;
    try { localStorage.setItem(CHOICE_KEY, value); } catch { /* memory covers this page */ }
}
// Brings an already-loaded Pixel in line with the current choice.
function applyChoice() {
    if (pixelChoice() !== 'on') clearMetaCookies();
    if (!window.fbq) return;
    window.fbq('consent', pixelChoice() === 'on' ? 'grant' : 'revoke');
}

/** The notice's "Got it": answered, and the Pixel stays as it is. Never overwrites a Turn on or off. */
export function acknowledgePixelNotice() {
    if (storedChoice() === null) remember('seen');
}
/** Calls back when the choice changes in another tab, such as /privacy. Returns the unsubscribe. */
export function onPixelChoiceChange(callback) {
    const listener = event => { if (event.key === CHOICE_KEY || event.key === null) callback(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
}
/** "Turn off" (notice or /privacy) or "Turn on" (/privacy). */
export function setPixelChoice(choice) {
    remember(choice);
    applyChoice();
}

// Meta credits an ad click through its _fbc cookie, which it normally sets from fbclid in the address.
// The shop drops fbclid from the address before Meta's script loads, so the cookie is set here, in
// Meta's documented format (fb.1.<time>.<fbclid>), on the shop's domain for 90 days.
function rememberAdClick() {
    if (!AD_CLICK_ID) return;
    const current = document.cookie.match(/(?:^|;\s*)_fbc=([^;]*)/)?.[1];
    if (current?.endsWith(`.${AD_CLICK_ID}`)) return;
    const domain = window.location.hostname.replace(/^www\./, '');
    document.cookie = `_fbc=fb.1.${Date.now()}.${AD_CLICK_ID}; Max-Age=7776000; path=/; domain=${domain}; SameSite=Lax; Secure`;
}

let started = false;
function startPixel() {
    if (!pixelConfigured() || pixelChoice() !== 'on') return false;
    if (started) return true;
    started = true;
    // A choice made in another tab, or on /privacy before Back restored this page from the browser's
    // cache, applies here. Registered before Meta's script, these run ahead of its restore PageView.
    window.addEventListener('pageshow', event => { if (event.persisted) applyChoice(); });
    window.addEventListener('storage', event => { if (event.key === CHOICE_KEY || event.key === null) applyChoice(); });
    rememberAdClick();
    // Meta's base code: calls queue until fbevents.js loads and replays them.
    const fbq = window.fbq || function () {
        // eslint-disable-next-line prefer-rest-params
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    if (!window.fbq) {
        Object.assign(fbq, { push: fbq, loaded: true, version: '2.0', queue: [] });
        window.fbq = fbq;
        if (!window._fbq) window._fbq = fbq;
    }
    // The address changes when a product opens. The Pixel must not log those changes by itself (the
    // shop reports them), or follow a future in-app link onto a /track page. Meta's script otherwise
    // drops every PageView after the first, including the shop's own.
    fbq.disablePushState = true;
    fbq.allowDuplicatePageViews = true;
    // No automatic button-click or page-metadata events: the order-complete screen shows the order
    // number and its /track link.
    fbq('set', 'autoConfig', false, PIXEL_ID);
    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
    const load = () => {
        // Turned off before the script arrived: the queued calls are never sent.
        if (pixelChoice() !== 'on') return;
        const script = document.createElement('script');
        script.async = true;
        script.src = SCRIPT_URL;
        document.head.appendChild(script);
    };
    // After the shop has drawn, so the Pixel never competes with product photos.
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 3000 });
    else window.setTimeout(load, 1500);
    return true;
}

/** Starts the Pixel for this page (one PageView) unless the visitor turned it off. */
export const startShopPixel = () => { startPixel(); };

export function trackPixel(event, params) {
    if (startPixel()) window.fbq('track', event, params);
}
