// How the admin was opened. The installed app (added to a phone's home screen or installed on a computer)
// opens on Orders (owner request 2026-11-10); in a browser tab the admin still opens on the Point of Sale.

/** True when the page runs as the installed app rather than in a browser tab (iOS reports it on navigator). */
export const isInstalledApp = (win = window) => Boolean(
    win.matchMedia?.('(display-mode: standalone)')?.matches || win.navigator?.standalone === true
);

/** The admin tab to show first. */
export const startTab = (win = window) => (isInstalledApp(win) ? 'orders' : 'pos');
