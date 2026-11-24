import React from 'react';
import { ChevronDown } from 'lucide-react';
import { COD_BULK_BALLS_NOTICE } from '../../lib/codPolicy';
import ShopInfoPage, { InfoSection } from './ShopInfoPage';
import { ShopContactLinks } from './ShopLinks';

function ReturnPolicy() {
    return (
        <ShopInfoPage title="Return policy" path="/returns">
            <p className="mt-4 text-lg text-ink-2">
                If something is wrong with your order, message us privately on <ShopContactLinks />.
                Include your order number, the item name, what went wrong and the photos described below.
            </p>

            <InfoSection id="sizing" title="When the measurements look wrong">
                <p>Check the <strong className="text-ink">Size guide</strong> on the product page for the brand and size you ordered. It measures the shirt in inches, not your body.</p>
                <ol className="list-decimal space-y-3 pl-6 marker:font-semibold marker:text-ink">
                    <li>Lay the shirt flat without stretching it. Photograph the size tag.</li>
                    <li><strong className="text-ink">Chest:</strong> run a tape measure straight across the front, from one underarm seam to the other. Measure the width once, not all the way around.</li>
                    <li><strong className="text-ink">Height:</strong> run the tape from the highest point of the shoulder beside the collar straight down to the bottom hem.</li>
                </ol>
                <p>Send a photo of each measurement. Show the zero mark at the starting edge and the reading at the other edge, with the inch markings visible. Tell us what the guide lists and what your tape shows.</p>
            </InfoSection>

            <InfoSection id="damage" title="Damage, print problems or a wrong item">
                <p><strong className="text-ink">Damage or print defect:</strong> send one photo of the whole shirt and a clear close-up of the tear, stain, loose seam or faulty print. For a tear or other measurable damage, place the tape beside it to show its size.</p>
                <p><strong className="text-ink">Wrong item, design, color or size tag:</strong> photograph what arrived, including the tag if relevant, and tell us what you ordered instead. You don’t need tape measurements to show a wrong tag or design.</p>
            </InfoSection>

            <InfoSection id="review" title="Before you send anything back">
                <p>We’ll check your photos against the order and explain the next steps, including the available remedy and return-shipping arrangements if the item needs to come back. Please wait for our instructions before mailing it.</p>
                <p>Keep your address and payment details out of the photos. This process does not limit your rights under Philippine consumer law.</p>
            </InfoSection>
            <p className="mt-8"><a href="/faq" className="font-semibold text-ink underline">Read the shop FAQ</a></p>
        </ShopInfoPage>
    );
}

function Question({ title, children }) {
    return (
        <details className="group border-b border-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-ink hover:underline [&::-webkit-details-marker]:hidden">
                {title}<ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-2 group-open:rotate-180" />
            </summary>
            <p className="pb-4 text-ink-2">{children}</p>
        </details>
    );
}

function ShopFaq() {
    return (
        <ShopInfoPage title="Frequently asked questions" path="/faq">
            <InfoSection id="fit" title="Sizing and returns">
                <div>
                    <Question title="How do I choose a shirt size?">
                        Open the shirt and select <strong>Size guide</strong> next to the size choices. Lay a shirt that fits you flat and compare its chest width and shoulder-to-hem length with that guide. The same size label can measure differently across brands.
                    </Question>
                    <Question title="What proof do I need if the size looks wrong?">
                        If the tag is not the size you ordered, send a photo of the tag. If the tag is right but the measurements seem off, send tape-measure photos of the chest and height. The <a href="/returns" className="font-semibold text-ink underline">return policy</a> shows where to place the tape.
                    </Question>
                    <Question title="My shirt arrived damaged or misprinted. What do I do?">
                        Send your order number, a full-shirt photo and a close-up in a private message on <ShopContactLinks />. Put a tape beside measurable damage for scale. Wait for our reply before shipping the shirt back.
                    </Question>
                </div>
            </InfoSection>
            <InfoSection id="orders" title="Payment, delivery and tracking">
                <div>
                    <Question title="How can I pay?">
                        Checkout offers GCash, bank transfer and cash on delivery for eligible orders. Upload your payment receipt at checkout for GCash or bank transfer. {COD_BULK_BALLS_NOTICE}
                    </Question>
                    <Question title="When do orders ship, and how much is delivery?">
                        Order by Thursday for Sunday dispatch via LBC. Checkout shows the fee for your bag and destination, including any separate ball shipping charge. LBC lists cities and municipalities; door delivery isn’t guaranteed in every barangay.
                    </Question>
                    <Question title="How do I track or change my order?">
                        Open your order link, or <a href="/track" className="font-semibold text-ink underline">track your latest order</a> with the mobile number you used at checkout. Choose <strong>Modify order</strong> while it’s pending. After it ships, look there for the courier’s tracking number.
                    </Question>
                </div>
            </InfoSection>
        </ShopInfoPage>
    );
}

export default function ShopHelp({ page }) {
    return page === 'returns' ? <ReturnPolicy /> : <ShopFaq />;
}
