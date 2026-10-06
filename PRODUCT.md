# Product

<!-- impeccable:product-schema 1 -->

> Interview status: the init probe (2026-10-05) went unanswered. Facts below come from the owner's
> brief relayed by the parent session and from repository evidence. Items marked *(inferred)* have
> not been confirmed by the owner and should be checked at review.

## Platform

web

## Users

- **Customers** buying from the public storefront at www.sportstechph.store, mostly on phones. They
  browse shirts and pickleball gear, pick sizes or ball quantities, check out with a Philippine
  address, and later return to `/track/:id` to see where their order is.
- **The owner**: full admin. Runs point of sale, orders, sales, expenses, inventory, supplier orders,
  vouchers, ad reporting, the Downtown Dinks club ledger, production releases and settings, on phone
  and desktop.
- **Resellers**: sell at fixed ₱400 pricing; may edit only their own unpaid pending orders.
- **One print employee**: uses `/print` on a phone and must see only owner-released print jobs, with no
  customer or financial data, plus their own shirt counter and pay wallet (₱1,000 per complete 30
  owner-accepted shirts; the owner records payouts).

## Product Purpose

SportsTech PH is an owner-run Philippine sportswear and print business. The app is both the shop
window (storefront, checkout, order tracking) and the back office that runs the business
(orders, POS, stock, money, production). Success: a phone shopper can find an item, pay, and
track it without messaging the owner; the owner can run the day from one place; the printer sees
exactly what to print and nothing else.

## Positioning

*(inferred)* SportsTech is rooted in the Metro Manila pickleball scene: it sells pickleball balls and
accessories, prints club and team shirts (including the Sypik line), runs the Downtown Dinks club
program (open plays and tournaments), and has promoted covering tournament registration fees and
free shirts for selected athletes (`public/STEvent.jpg`). It is a community sports shop that also
prints, not an anonymous merch store.

## Operating Context

- Storefront checkout is server-priced. Shipping: ₱100 Metro Manila, ₱200 provincial (LBC standard;
  other couriers at buyer's cost). Rush: ₱100 per shirt. Vouchers (fixed or percent). Payment:
  Cash on Delivery, GCash, or bank transfer; GCash/bank need a payment-proof upload against the QR
  in `public/payment-qr.jpeg` ("verify 'Sports Tech' name before paying").
- Shipping schedule: cutoff every Thursday, shipping every Sunday.
- Order tracking is contact-verified: the customer's mobile number unlocks `/track/:id`; pending
  orders can be modified by the customer.
- Ball pricing is tiered by quantity (1, 5, 10, 20, 50, 100 pieces).
- Shirt sizes XS–2XL with brand-specific size guides.
- Staff sign-in is email-code via Cloudflare Access; staging is a read-only snapshot with a visible
  banner, and production can enter a read-only maintenance state.
- The print queue is used on a phone at the press.

## Capabilities and Constraints

- React 19 + Vite 7 + Tailwind 4 SPA served by a Cloudflare Worker API; lazy-loaded routes; PWA.
  Initial bundle should stay lean (~113 kB gzip index at the time of writing); the xlsx export chunk
  must stay lazy.
- Pricing, inventory, permissions and order-save payloads are owned by the Worker and must not
  change from UI work.
- Routes: `/` storefront, `/track/:id` tracking, `/admin` staff workspace, `/print` print queue.
- Currency is Philippine peso (₱) throughout.
- Undecided: product photography standards (catalog images are whatever the owner uploads).

## Brand Commitments

- Name **SportsTech** (also written "Sports Tech" on the payment QR and promo art) with the existing
  logo mark: a white-and-red swoosh "S" over the SPORTSTECH wordmark (`public/logo.png`
  transparent, `public/logo.jpg` on navy).
- Red brand accent; manifest/theme colour `#ef4444`.
- Philippine peso pricing and all factual copy (fees, schedule, payment instructions) stay as written.
- Visual direction (owner's choice, 2026-10-05): **the category standard**, dark athletic e-commerce
  done impeccably, over the rolled alternatives. Convention is the commitment: no quirks or
  concept motifs. Craft bar: Nike.com, adidas and JOOLA. *(The owner didn't answer the reference
  question; the agent picked this set.)*

## Evidence on Hand

- Logo files: `public/logo.png`, `public/logo.jpg`.
- Promo poster: `public/STEvent.jpg` (red/blue pickleball court, condensed italic display type).
- Payment QR: `public/payment-qr.jpeg`.
- Product photos come from the live catalog API (owner uploads); none are bundled.
- No customer testimonials, reviews, ratings, press, or sales figures exist for public use. Do not
  fabricate any.

## Product Principles

1. The phone shopper comes first: every storefront step must work one-handed on a 390px screen.
2. Money is never ambiguous: totals, fees and discounts are shown exactly as the server will
   charge them.
3. Each role sees only what it needs; the print screen never shows customer or financial data.
4. The back office is a daily tool: speed and scanability beat decoration.
5. Read-only and maintenance states are always visible, never hidden.

## Accessibility & Inclusion

Respect reduced motion, full keyboard access, WCAG AA contrast, and 44px touch targets; customers
and staff are frequently on phones outdoors or at a print press.
