import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import Logo from '../ui/Logo';
import { setShareUrl } from '../../lib/shareHead';

export function InfoSection({ id, title, children }) {
    return (
        <section aria-labelledby={id} className="mt-12 border-t border-line pt-8">
            <h2 id={id} className="section-title">{title}</h2>
            <div className="mt-4 space-y-4 text-ink-2">{children}</div>
        </section>
    );
}

export default function ShopInfoPage({ title, path, children }) {
    useEffect(() => {
        document.title = `${title} | SportsTech PH`;
        setShareUrl(`${window.location.origin}${path}`);
    }, [title, path]);

    return (
        <div className="min-h-dvh bg-ground text-ink">
            <header className="border-b border-line">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                    <a href="/" aria-label="SportsTech home"><Logo className="h-9 sm:h-10" /></a>
                    <a href="/" className="btn-ghost"><ArrowLeft size={16} aria-hidden="true" /> Back to shop</a>
                </div>
            </header>
            <main className="mx-auto w-full max-w-[34rem] px-4 py-12 sm:py-16">
                <h1 className="display text-5xl sm:text-6xl">{title}</h1>
                {children}
                <a href="/" className="btn-light mt-12 h-12"><ArrowLeft size={18} aria-hidden="true" /> Back to the shop</a>
            </main>
        </div>
    );
}
