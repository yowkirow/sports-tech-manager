import React, { useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';

// One-time notice for the shop's Meta Pixel. On phones it is a bar above the "View bag" bar; on
// computers a card in the bottom-left corner, with the toasts lifted clear of it on narrow screens.
// Dialogs cover it.
export default function PixelNotice({ onDismiss, onTurnOff, lastInStack }) {
    const notice = useRef(null);
    useLayoutEffect(() => {
        const root = document.documentElement;
        const update = () => root.style.setProperty('--pixel-notice-lift', `${notice.current.offsetHeight + 12}px`);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(notice.current);
        return () => {
            observer.disconnect();
            root.style.removeProperty('--pixel-notice-lift');
        };
    }, []);
    return (
        <section ref={notice} aria-labelledby="pixel-notice-text"
            className={clsx('pointer-events-auto border-t border-line bg-raised px-4 pt-3.5 shadow-sheet',
                'sm:mb-6 sm:ml-6 sm:w-[min(25rem,calc(100vw-3rem))] sm:rounded-xl sm:border sm:p-4 sm:shadow-lift',
                lastInStack ? 'pb-[max(0.875rem,env(safe-area-inset-bottom))]' : 'pb-3.5')}>
            <p id="pixel-notice-text" className="text-sm leading-normal text-ink-2">
                We use Meta cookies to measure our Facebook and Instagram ads and to show you our designs there.
                We never send Meta your name, number or address.{' '}
                {/* The overlay gives the inline link a 44px target that stops short of the buttons. */}
                <a href="/privacy"
                    className="relative font-semibold whitespace-nowrap text-ink underline after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-[''] hover:text-white">
                    Privacy &amp; cookies
                </a>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
                <button type="button" onClick={onDismiss} className="btn-light">Got it</button>
                <button type="button" onClick={onTurnOff} className="btn-secondary">Turn off</button>
            </div>
        </section>
    );
}
