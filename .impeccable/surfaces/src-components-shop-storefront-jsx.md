---
version: 1
slug: "src-components-shop-storefront-jsx"
primary_target: "src/components/Shop/Storefront.jsx"
related_targets: ["src/components/Shop/OrderTracking.jsx","src/components/Auth/Login.jsx"]
---

# Storefront, checkout and order tracking

Scope: `/` storefront with its cart and checkout, the order-complete state, `/track/:id`, and staff
Login. Visitor mode: **Persuade**. Login and tracking take the same world in a quieter register.

Audience and job: a phone shopper, usually arriving from a social link, who wants a shirt or
pickleball balls. They need to see the exact peso cost, pay by GCash, bank transfer or COD, and
later check the parcel by phone number.
Proof on hand: the real catalog (owner photos), the shipping schedule and fees, the GCash QR, and
the brand's court photo (`public/STEvent.jpg`). There are no testimonials or ratings, and none may
be invented.
Constraints: prices, fees and checkout payloads come from the server, and the copy for fees,
schedule and payment instructions stays factual.

## Direction contract

THESIS: SportsTech's shop is played straight as the category standard. That means dark athletic
e-commerce at the Nike, adidas and JOOLA craft level, where the product leads and the price is
never in doubt. It refuses the incumbent's slate glass, its blur and its glow.

OWN-WORLD: A near-black ground with flat charcoal surfaces. One red is reserved for action. White
pills carry the secondary actions. Display type is Barlow Condensed in uppercase; body type is the
system sans. Peso figures are tabular. Product images sit in square-cornered wells. There is no
glass, gradient chrome or neon.

STORY: The shopper sees what SportsTech sells and the real ship schedule. They open a product,
choose a size or quantity, add it to the bag, and check out in clear steps. Afterwards they keep a
tracking link that a phone number unlocks.

FIRST VIEWPORT: A thin announcement bar with the Thursday cutoff and Sunday LBC ship day. Below
it, a sticky black header with the logo, Track and the bag count. Then a court-photo hero, about
340px tall on phones, with the uppercase condensed "Shirts & pickleball gear" headline and a red
"Shop now" pill. A three-fact strip covers fees and payment, and on a phone the first product row
starts in view.

FORM: category standard (canon, owner's choice over roll index 7 Swing Tag); seed key 19228f6d.
Signature interaction: product sheet → size or quantity select → Add to bag, which bumps the bag
count. The bag opens as a drawer (a full sheet on phones) with two steps, Bag and Checkout, and
one sticky total.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
