import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Logo from '../ui/Logo';
import { pixelBrowserOptOut, pixelChoice, pixelChoiceIsExplicit, pixelConfigured, setPixelChoice } from '../../lib/metaPixel';
import { setShareUrl } from '../../lib/shareHead';

// The privacy notice Meta's Business Tools terms require wherever the Pixel runs (owner request,
// 2026-11-05). Every statement describes what the app does today; update it when that changes.
const UPDATED = 'November 5, 2026';

function Link({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-ink underline hover:text-white">{children}</a>;
}

function Section({ id, title, children }) {
    return (
        <section aria-labelledby={id} className="mt-12 border-t border-line pt-8">
            <h2 id={id} className="section-title">{title}</h2>
            <div className="mt-4 space-y-4 text-ink-2">{children}</div>
        </section>
    );
}

export default function PrivacyNotice() {
    const configured = pixelConfigured();
    const [choice, setChoice] = useState(pixelChoice);
    useEffect(() => {
        document.title = 'Privacy & cookies | SportsTech PH';
        setShareUrl(`${window.location.origin}/privacy`);
    }, []);
    const change = next => { setPixelChoice(next); setChoice(next); };

    return (
        <div className="min-h-dvh bg-ground text-ink">
            <header className="border-b border-line">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                    <a href="/" aria-label="SportsTech home"><Logo className="h-9 sm:h-10" /></a>
                    <a href="/" className="btn-ghost"><ArrowLeft size={16} aria-hidden="true" /> <span>Back to shop</span></a>
                </div>
            </header>
            <main className="mx-auto w-full max-w-[34rem] px-4 py-12 sm:py-16">
                <h1 className="display text-5xl sm:text-6xl">Privacy &amp; cookies</h1>
                <p className="mt-4 text-lg text-ink-2">How SportsTech PH uses your information. <span className="whitespace-nowrap">Updated {UPDATED}.</span></p>

                <Section id="cookies" title="Meta cookies and ads">
                    <p>
                        This shop uses the Meta Pixel, a tool from Meta, the company behind Facebook and Instagram. While you
                        browse the shop, it tells Meta which products you open, what you add to your bag, when you start checkout
                        and your order’s total. It also sends the page address, Meta’s cookies and the details every browser
                        shares, such as your IP address and device type.
                    </p>
                    <p>
                        Meta and other third parties may use cookies and similar technologies to collect information from this
                        website and elsewhere on the internet, and use it to measure ads and to show you ads, including ours. Meta
                        uses this information as its <Link href="https://www.facebook.com/privacy/policy/">Privacy Policy</Link> describes.
                    </p>
                    <p className="text-ink">
                        We never send Meta your name, mobile number, address, email or order number. The Pixel doesn’t run on
                        your order page.
                    </p>
                    <div className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <div aria-live="polite">
                            {!configured ? (
                                <p className="font-semibold text-ink">Meta cookies aren’t used on this copy of the shop.</p>
                            ) : choice === 'on' ? (
                                <p className="font-semibold text-ink">Meta cookies are on in this browser.</p>
                            ) : (
                                <>
                                    <p className="font-semibold text-ink">Meta cookies are off in this browser.</p>
                                    {pixelBrowserOptOut() && !pixelChoiceIsExplicit() && (
                                        <p className="mt-1 text-sm">Your browser’s Global Privacy Control setting turned them off.</p>
                                    )}
                                </>
                            )}
                        </div>
                        {configured && (
                            <button type="button" className="btn-secondary shrink-0" onClick={() => change(choice === 'on' ? 'off' : 'on')}>
                                {choice === 'on' ? 'Turn off' : 'Turn on'}
                            </button>
                        )}
                    </div>
                    <p>
                        To choose which ads you see on Facebook and Instagram, use your <Link href="https://www.facebook.com/adpreferences/">Facebook
                        ad preferences</Link>. To opt out of interest-based ads from many companies, visit{' '}
                        <Link href="https://www.aboutads.info/choices/">aboutads.info/choices</Link>, or{' '}
                        <Link href="https://www.youronlinechoices.eu/">youronlinechoices.eu</Link> in Europe. You can also block
                        cookies in your browser’s settings.
                    </p>
                </Section>

                <Section id="orders" title="Your orders">
                    <p>
                        When you order, we collect your name, mobile number and delivery address, and your email if you give one.
                        For GCash or bank transfer, we also keep the payment receipt you upload.
                    </p>
                    <p>
                        We use these to make and deliver your order, to send you order updates by text and, if you gave an email,
                        by email, and to let you track your order with your mobile number.
                    </p>
                    <p>
                        Our team sees your order. LBC gets your name, number and address to deliver it. Our texts go out
                        through textbee.dev, which gets your number and the message. Our print staff see only your name and
                        the LBC booking number, for the package label. Only the owner sees payment receipts.
                    </p>
                    <p>This website runs on Cloudflare, which also sends our emails. We keep order records as part of our business records.</p>
                </Section>

                <Section id="device" title="On your device">
                    <p>
                        This site saves your Meta cookie choice in your browser. It keeps your bag in this tab until you order
                        or close the tab. If an order attempt gets no reply, this tab keeps that attempt’s reference, so
                        trying the same order again can’t place it twice. When you track an order, it keeps that order’s
                        access key until you close the tab.
                    </p>
                </Section>

                <Section id="rights" title="Your rights">
                    <p>
                        Under the Data Privacy Act of 2012, you can ask what personal data we hold about you, have it corrected,
                        or ask us to delete or block it, and you can object to how we use it. Message us on{' '}
                        <Link href="https://facebook.com/sportstech.fb">Facebook</Link> or{' '}
                        <Link href="https://instagram.com/sportstech.ig">Instagram</Link>. You can also contact the National
                        Privacy Commission at <Link href="https://privacy.gov.ph/">privacy.gov.ph</Link>.
                    </p>
                </Section>

                <a href="/" className="btn-light mt-12 h-12"><ArrowLeft size={18} aria-hidden="true" /> Back to the shop</a>
            </main>
        </div>
    );
}
