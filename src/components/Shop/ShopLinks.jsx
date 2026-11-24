import React from 'react';

export function ShopContactLinks() {
    return (
        <>
            <a href="https://facebook.com/sportstech.fb" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Facebook</a> or{' '}
            <a href="https://instagram.com/sportstech.ig" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Instagram</a>
        </>
    );
}

export function ShopInfoLinks() {
    return (
        <nav aria-label="Shop information" className="flex flex-wrap items-center gap-x-5">
            {[['/returns', 'Return policy'], ['/faq', 'FAQ'], ['/privacy', 'Privacy & cookies']].map(([href, label]) => (
                <a key={href} href={href} className="inline-flex min-h-11 items-center text-sm text-ink-2 underline hover:text-ink">{label}</a>
            ))}
        </nav>
    );
}
