# Cloudflare production and staging

**Production moved to Cloudflare on October 7, 2026.** `www.sportstechph.store` and the
bare domain are served by the `sportstech-production` Worker with its own D1 database
and R2 bucket. The old Vercel/Supabase app is frozen and kept as the rollback copy;
Vercel only redirects `sports-tech-manager.vercel.app` to `www`. Owner-protected,
read-only staging remains available for reviewing changes before release.

## Prerequisites

Use Node.js 22.19 or newer and `npm ci`. Cloudflare credentials remain in the
authenticated Wrangler profile or your secret manager; never commit tokens,
`.dev.vars`, `.env`, exported customer data, or SMS credentials.

`wrangler.staging.jsonc` targets only `sportstech-staging`. The D1 binding is a
separate database, not a link to any existing app's database.
`wrangler.production.jsonc` is the live production Worker: routes for
`www.sportstechph.store/*` and `sportstechph.store/*`, writes enabled, printing not
yet enabled, no `workers.dev` endpoint or preview URLs, and the production Access
audience. It runs the Worker first for every request (`run_worker_first: true`) so
the bare domain always redirects to `www`; with path-limited Worker-first routing,
static pages on the bare domain would bypass the redirect and their API calls would
fail. **`npm run deploy:production` changes the live store.**

```powershell
npm run check:worker
npm test
npm run build:staging
npm run db:staging
npm run deploy:staging
```

Database migrations must be applied before enabling authenticated endpoints.
Changing the frontend build or pushing a Vercel branch does not deploy this Worker;
use the explicit staging command and verify the returned Worker version ID.
`deploy:staging` builds fresh staging assets with the print UI enabled; it never
uploads an arbitrary older `dist`. Production builds enable printing by default
(`vite.config.js`), matching `PRINT_QUEUE_ENABLED` in `wrangler.production.jsonc`;
a test fails if the two disagree.

Apply migrations in order. `0002_transaction_date_pattern.sql` corrects a D1
50-byte GLOB-pattern limit in the original schema while preserving all data and
indexes. Do not edit or replay an already-applied migration to repair a database.

## Workers Paid and CPU limits

The owner upgraded to Workers Paid and authorized continuing on September 22,
2026. This supersedes the earlier Free-only Worker CPU gate; it does not authorize
upgrading the zone, Access or any other subscription. Both Worker configs set
`limits.cpu_ms` to **1000 ms**, rather than the Paid default of 30 seconds.
The latest pre-upgrade correlated cold reseller samples peaked at 97 ms for
150 lines. With the explicit Paid ceiling, two subsequent cold 150-line saves
used 71 and 80 ms and preserved the exact expected atomic results. These isolated
probes excluded Access JWT verification and their temporary Worker/database were
removed afterward. Keep measuring authenticated requests and larger input shapes;
the configured ceiling is not a guarantee that every future workload fits.

Workers Standard currently includes 10 million requests and 30 million CPU
milliseconds per month for a minimum $5/account/month. Usage above the included
amounts is metered, and usage across other Workers in the account also counts.
The per-request CPU ceiling is **not a monthly spending cap**. D1 and R2 usage
must be monitored separately; do not promise a fixed total bill or enable other
paid services. See the official [pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [limits](https://developers.cloudflare.com/workers/platform/limits/).

The print queue was enabled in production on October 13, 2026. Keep the frontend
`VITE_PRINT_QUEUE_ENABLED` build flag consistent with the Worker's `PRINT_QUEUE_ENABLED` flag.

```powershell
npm run db:production
npm run deploy:production
```

Production provisioning and schema application do not constitute a migration.
Before adding the full routes, configure a distinct production Access audience and
the approved individual memberships, install a production-only guest/settings
secret, disable the bucket's public development URL, reconcile the final
write-frozen data/file copy and complete the cutover checklist below.
Never copy the staging Access audience or its secrets into production.

## Access configuration

Attach the approved **SportsTech owner** reusable Access policy to a self-hosted
application protecting exactly:

```text
sportstech-staging.jerrosyap05.workers.dev
```

Do not protect all Workers in the account or the public production storefront.
Confirm the application contains only the intended exact-email allow rule and no
bypass/everyone policy. The Access organization is
`jolly-fog-e8df.cloudflareaccess.com`.

The staging application is `61e152cf-3fc1-47c2-9151-a92fa5653f8d`, with the saved
owner policy attached and a six-hour application session duration. Its verified
audience (AUD) is configured in `ACCESS_AUDIENCE` in `wrangler.staging.jsonc`.
The audience is an application identifier, not a credential. If the application
is ever replaced, verify its exact policy/hostname and update the audience before
redeploying; do not infer it from another application's token or bypass policy.
Missing configuration still produces an explicit 503 instead of accepting unsigned
email headers or defaulting to admin.

Under Cloudflare One's **Integrations > Identity providers**, explicitly enable
**One-time PIN** for email-code sign-in. Do not rely on the dashboard's default-PIN
hint when its provider list is empty: the staging login returned "no login methods
available" until this provider was added. Keep the exact-email Access policy;
adding a login method must not broaden who can access the app.

Provision the explicitly approved owner in `members` through a controlled D1
administration step using a stable internal ID and exact normalized email. Never
make the first visitor owner. Do not place personal seed data in migrations.
`access_subject` starts null; only a verified JWT whose email matches an already
active membership may bind its first subject. A later different subject requires
owner review; removed/re-added Access identities must not silently take over.

The Worker verifies RSA signatures against the team's official key set, issuer,
audience, expiry, required identity claims and human token type. Application roles
come from D1, not browser storage, editable user metadata or Access headers alone.
Inactive/unrecognized members are denied. Key-service/database failures produce
explicit service errors, not successful anonymous fallbacks.

### Daily PIN (owner request, October 7, 2026)

Access (an emailed code) identifies the member for the Access application session;
a 4–6 digit PIN then opens the app on that device. The PIN is enforced by the Worker
(`worker/pin.ts`, migration `0008_member_pins.sql`), not only hidden in the UI: every
private API except `/api/session` and `/api/pin/*`, plus private media and owner receipt
downloads, returns `428 pin_setup_required` or `423 pin_required` until the device holds
a current unlock. `/api/session` returns the PIN state and withholds the profile while
locked.

- PINs are stored as PBKDF2-SHA256 hashes (100,000 iterations, per-member salt);
  repeated or sequential PINs such as `1111` or `1234` are rejected.
- An unlock is an HttpOnly, Secure, `SameSite=Strict` cookie (`st_pin`), HMAC-signed with
  a key derived from `GUEST_TOKEN_SECRET`, valid 12 hours and bound to the member, the
  Access subject and the PIN version. Changing or resetting the PIN invalidates every
  other device's unlock.
- Five wrong PINs lock unlocking for 15 minutes; each later miss re-locks it, and ten
  misses lock it for 24 hours. The correct PIN does not bypass an active lock.
- A forgotten PIN is reset only within 10 minutes after Access issues a new token
  (sign out, then sign in with a new emailed code). Access can renew a token from its
  global session without a new code, so this is a convenience check, not a second
  factor; keep Access as the identity boundary.
- PIN endpoints stay available during read-only maintenance; they store no business data.
- The old app's shared PIN login (a short PIN tried as a password for each admin) is
  not restored.

The **SportsTech production** Access application's session duration is 30 days
(set October 13, 2026), so the emailed code is roughly a monthly step per device.

### Team and invitations

The owner manages people in **Settings > Team** (`/api/team`, owner only, atomic,
idempotent and audited in `business_events`): invite an individual email as Owner,
Reseller or Print staff, change Owner/Reseller roles, remove or restore access, and
reset someone's PIN. Removing access takes effect on that person's next request;
removing print staff holds their unfinished jobs (`production_operator_revoke`).
Print staff cannot switch roles, so pay credits and job history stay attributed.
Nobody can change their own access; another owner must. The app sends no email; the
owner copies the sign-in steps (open `/admin`, enter the email, type the emailed
code, create a PIN). Signed-in emails that are not active team members see the app's
"no access" screen instead of a raw error.

Cloudflare Access also decides who can request a sign-in code for the production
application. **Applied October 13, 2026:** the production application (and only it)
has the reusable policy **SportsTech production team**
(`32c1e3b8-39f0-44f4-818a-030a9097a01c`): include everyone, require the One-time PIN
login method. Anyone can prove they own an email, but the Worker admits only active
Team members to private pages and APIs, so the Team list is the single place that
grants access and inviting needs no dashboard step. The **SportsTech owner** policy is
still attached first. The staging application keeps only the owner policy.

The production application's session duration is **720h (30 days)**, so the emailed
code is roughly a monthly step per device while the PIN opens the app each day.

Resellers can edit only their own unpaid, pending orders. The server rebuilds
quantity/removal pricing using the existing reseller policy, verifies complete
source snapshots and ownership inside the write batch, and rechecks membership
on retries. Payment, fulfillment, LBC booking and tracking numbers, product replacement, discounts and
arbitrary price adjustments are not reseller permissions. Metadata-only edits
retain exact historical amounts. Ambiguous duplicate legacy-item removals and
quantity changes inside wrapped legacy items explicitly require owner review.
Implementing this capability does not grant any legacy account access; the
owner still approves which identities to enable.

## Application and API boundaries

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Non-sensitive service/version check; subject to the hostname's Access policy |
| `GET /api/session` | Verified Access identity and active D1 membership required |
| `/`, `/track/:id` | Storefront and contact-verified tracking; public in the eventual production deployment |
| `/p/:product` | Shareable product link: the storefront with that product open, served with its link preview |
| `/privacy` | Privacy and cookies notice, with the switch for the shop's Meta Pixel |
| `/admin` | Authenticated owner/reseller workspace; print operators redirect to `/print` before management data loads |
| `/print` | Assigned, owner-released production jobs only; requires the print feature flag |
| `/api/public/*` | Sanitized catalog, server-priced checkout, voucher checks and order-scoped guest tracking/edit capabilities |
| `/api/transactions`, `/api/orders/save` | Role-checked business reads and atomic, versioned mutations |
| `/api/production/*` | Scoped partial print progress, owner release, QA, holds and reviewed job replacement |
| `/api/media/*` | Validated uploads and public product/private receipt access |
| `/api/dtf/designs` | Owner-only gallery of print-ready SVG designs for DTF sheets (see "DTF sheets") |
| `/api/settings/sms`, `/api/sms` | Owner-only encrypted gateway settings; actual SMS delivery disabled in staging |
| `/api/notifications/test` | Owner-only sample customer email to the signed-in owner, at most once a minute; nothing is sent where the `EMAIL` binding is missing (staging) |

`MUTATIONS_ENABLED` must explicitly be `true` before any HTTP mutation is accepted.
Staging deliberately keeps it `false` while the imported financial snapshot is
reviewed. Synthetic mutation tests use separate temporary resources, not live
customer orders. `PRINT_QUEUE_ENABLED` gates both production APIs and employee
account preparation; `VITE_PRINT_QUEUE_ENABLED` gates the corresponding UI.

Voucher codes are never listed to the public. The catalog leaves them out, and the
shop sends the one code a customer typed to `POST /api/public/vouchers/check`. That
endpoint allows 10 checks per address every 10 minutes and returns only the code's
discount, never its usage, limit or referrer. Checkout validates the code again.
Like tracking and PIN unlocks, voucher checks stay available during read-only
maintenance.

Responses use `Cache-Control: no-store`. No private data or permissive CORS headers
are returned to anonymous requests. Unexpected `/api` paths never fall back to a
successful SPA document. The staging database must contain only deliberate
account setup and either synthetic fixtures or a protected, reconciled source
snapshot. Production traffic and staging must never write to the same database.

Access protects the entire staging hostname. Unauthenticated requests should
redirect to the configured team's sign-in page before reaching the Worker,
including `/health`; do not weaken the policy just to make a health probe public.
After sign-in, `/api/session` confirms the app-level member and `/health` reports
the deployed Worker version. Dashboard sign-in alone does not prove that this
separate application login works.

## Shop shipping and ball rates

Owner request (November 10, 2026). Every shop order pays LBC's flat fee for its area:
₱100 Metro Manila or ₱200 provincial. LBC charges more to ship pickleball balls than that
covers, so the owner can set ball shipping in Settings › Ball shipping. Tiers go by ball
count, each with a Metro Manila and a provincial fee in whole pesos. A tier covers its
count and up, until the next tier starts. `src/lib/shippingRates.js` holds the rules, and
the shop, checkout and order editing all use it.

- **Charging**: with tiers set, balls pay the tier their count reaches, added to the flat
  fee for everything else in the order. An order of only balls pays only ball shipping.
  With no tiers set, balls ride the flat fee as before.
- **Storage**: the rates are `shipping_rates` transactions with `details.balls` holding
  `{ from, mm, provincial }`. The newest record is in force, and saving an empty list
  turns ball rates off. Only the owner can write one: resellers may only submit sales,
  and print staff can't write transactions.
- **Checks**: `POST /api/transactions` refuses a record unless every tier reads back
  whole: the first from 1 ball, no two starting at the same count, at most 12 tiers,
  whole-peso fees up to ₱100,000, and no amount. Anything malformed that reaches the
  table anyway reads as "no rates", so it can't break checkout.
- **Catalog**: `/api/public/catalog` includes `shippingRates.balls`, read in the same
  batch as the catalog revision. The shop shows the tiers on the ball product sheet,
  prices each area's card at checkout, and splits Shipping and Ball shipping in the
  summary. Checkout prices from the same rates on the server.
- **Orders**: an order that pays ball shipping saves its area's plan in
  `pricing.ballShipping` (`flatFee` and `ballTiers`). When a customer or the owner
  changes its quantities or items, its shipping is worked out again from that saved plan,
  not from today's rates. Name, address and status edits keep the stored amounts.
  Reseller and POS orders don't pay shipping, so this doesn't apply to them.

## Subscriptions (recurring expenses)

Owner request (November 11, 2026): "add a recurring expense for subscriptions". Under
Expenses › Subscriptions the owner adds what they pay every month or year (software, rent),
and each charge goes into Expenses on its day without being entered by hand.
`src/lib/recurringExpenses.js` holds the rules; the app and the Worker both use it.

- **Storage**: a subscription is a `recurring_expense` transaction with no amount of its own
  and `details` `{ name, amount, subCategory, frequency: monthly | yearly, startsOn, club }`.
  Only the owner can write one. `POST /api/transactions` refuses it unless it is complete
  (amount ₱0.01 to ₱1,000,000 to the centavo, a real first-charge day within a year of today,
  the category, and SportsTech or Downtown Dinks). Its schedule (`startsOn`, `frequency`)
  can't change; `PATCH` may change the name, amount, category and assignment, which apply
  from the next charge. Stopping a subscription deletes the record; its charges stay.
- **Charges**: a charge is an ordinary General expense (Marketing/Ads charges are `ads`) dated
  9:00 AM in Manila on its day: the first charge day each month or year, or the month's last
  day when shorter (31 Jan → 28 Feb; 29 Feb → 28 Feb). `details.recurringId` and
  `recurringDate` name its subscription and day, and its ID is derived from them, so it is
  recorded once and a charge the owner deletes stays deleted (tombstone). It counts in
  Expenses, the Dashboard and Reports like any expense, and can be edited, reimbursed or
  deleted. Only the Worker records charges: a new expense or edit that sets or moves
  `recurringId` / `recurringDate` is refused (400).
- **When**: production's cron (`triggers.crons` `5 16 * * *`, 00:05 in Manila) records every
  charge due by that day, so a missed night catches up the next. Staging has no cron and is
  read-only. After adding a subscription whose first charge is today or earlier, the app
  calls `POST /api/recurring-expenses/charge` (owner only, body `{}`, returns
  `{ inserted }`) so those charges appear at once; it is safe to repeat.

## Blank shirt count

Owner request (November 11, 2026): "Add a dashboard for the actual number of blank shirts (I'll
input it), also the print staff can see it." Under Stock › Blank shirts the owner enters the
blank shirts on the shelf by color and size (XS to 2XL), and the print staff see the same board,
read only, under Blanks on `/print`. `src/lib/blankCounts.js` holds the rules; the app and the
Worker both use it.

- **Storage**: each save is a `blank_count` transaction holding the whole board:
  `details.rows` lists `{ color, hex, sizes: { XS, S, M, L, XL, 2XL } }`, with an optional
  `details.note`. The newest count is the board. Only the owner can write one, and
  `POST /api/transactions` refuses it unless it reads back whole: 1 to 60 colors, each once,
  a whole number from 0 to 100,000 for every size, a note of up to 200 characters, and no
  amount. A count is never edited (`PATCH` is refused); deleting the newest brings back the
  one before it.
- **Print staff**: `GET /api/production/blanks` (the owner or an active print operator, with the
  print queue on) returns `{ blanks: { rows, note, countedAt } | null }`: only the board, its
  note and when it was saved, never who saved it.
- **Separate from Inventory**: Inventory still works blank shirts out from what was bought and
  sold. A count changes neither Inventory nor the shop's stock nor any money total. No
  migration.

## DTF sheets (migration 0020)

Owner request (November 9, 2026): the owner orders DTF prints by the meter, and the
supplier's meter is a 22 x 39 in sheet. Admin > Stock > DTF sheets keeps the owner's SVG
designs in a gallery, places the ones picked on the sheet, and downloads print files.

- **Gallery**: upload SVGs once (several at a time, or dropped on the gallery), each with a
  name and a print size in inches. Type the width or the height and the other follows the
  design's shape (`src/lib/dtfSize.js` keeps both sides within the gallery's limits, 0.1 to
  60 in wide and 0.1 to 120 in tall). Later, Add puts a design on the sheet, where each pick
  can be resized the same way. Edit renames or resizes one; Delete archives it
  (`archived_at`), so it can be restored in D1.
- **Upload cleaning** (`src/lib/svgDesign.js`, in the browser): scripts, embedded HTML,
  event handlers, animation, links, external files and other programs' private data
  (Illustrator, Inkscape) are removed. CSS is written onto the elements and every id gets
  the design's prefix, so two designs on one sheet never restyle each other; links inside
  the file (gradients, clip paths, masks, filters) follow the renamed ids. Empty margins
  are trimmed, so sizes and gaps are measured from the artwork. A size saved in real units
  (in, mm, cm, pt) prefills the width. The owner is warned about live text (convert it to
  outlines), embedded photos and anything removed.
- **Storage**: `dtf_designs` (name, `width_mils` and `height_mils` in thousandths of an inch,
  `media_id`, `archived_at`). The SVG is a private `media_objects` row at
  `dtf-designs/{id}` in R2. `/api/media/objects/{id}` serves it only to the owner and only
  as a download (`application/octet-stream`, `Content-Disposition: attachment`, `nosniff`,
  `private, no-store`), so a stored SVG can never open as a page on the shop's domain. The
  app fetches it and shows it in an img element from a blob URL, where an SVG can't run
  scripts or load anything. The product photo uploader still refuses SVG. A save that
  fails removes its file unless the design was saved after all; when D1 can't be checked,
  the file stays and `unconfirmed_dtf_design_upload` is logged (`orphaned_dtf_design_upload`
  when R2 refused the delete). Such a file is harmless and can be deleted from R2 once no
  `media_objects` row points at it.
- **API** (`worker/dtf-api.ts`; active owner, Access and the daily PIN; refused while
  read-only): `GET /api/dtf/designs`; `POST /api/dtf/designs` with `{ id, name, widthIn,
  heightIn, svg }` (the app picks the id, so a retried upload returns the saved design and
  the same id with another file is refused); `PATCH /api/dtf/designs/{id}` with a name and/or
  both sizes; `DELETE /api/dtf/designs/{id}` archives. The server checks each SVG again (at
  most 5 MB, an `<svg>` root, none of the removed content) and refuses one that skipped the
  app's cleaning.
- **Layout** (`src/lib/dtfLayout.js`): designs stay upright, copies of a design together,
  tallest first, in straight rows at least the minimum gap apart (default 0.5 in) inside the
  edge margin (default 0.25 in). When they don't fit, another sheet is added and the rows
  are balanced across the sheets. Then the spare film is shared out: every gap in a row, and
  between rows, is the same, the space to the sheet's edge included, so the designs spread
  over the whole sheet and every cut is a straight line (across the sheet between rows, then
  between the designs in a row). A design too big for the sheet is reported on its row. The
  sheet size, margin and gap are editable and remembered on the device, with what's on the
  sheet.
- **Preview**: the sheet to scale with inch rulers, dashed cut guides and zoom; the film
  needed in meters (39 in = 1 m); a pager with "Download all" when there are several
  sheets; and the size and position of a selected print.
- **Print files** (`src/lib/dtfExport.js`, `src/lib/pngStream.js`): one PNG per sheet,
  `dtf-YYYY-MM-DD-sheet-N-of-M-22x39in.png`, 6600 x 11700 px at 300 DPI (recorded in the
  file), transparent background, no cut guides or rulers. The sheet is drawn in 512-row
  strips from the vector designs and compressed as it goes (the browser's
  `CompressionStream`), so memory stays small enough for a phone.

## Product links and link previews

Owner request (November 5, 2026): every product has a link that can be shared in
Messenger, Facebook or anywhere else, and the link shows a preview.

- **The link** is `https://www.sportstechph.store/p/<slug>`. A product's slug first comes
  from its name, because the catalog keys a product by its name and the product's id
  changes on every edit. The owner's display number ("12. ", "27 ") is left out, so
  renumbering a design keeps its link. The color is added only when two products would
  otherwise share a link (the Black and White "Sypik Shirt with Vietnam Flag"). Older
  forms keep working: a slug with the number, with or without the color, opens the same
  product. The rule lives in `src/lib/productLinks.js`, shared by the storefront and the
  Worker.
- **Links don't move** (owner request, November 5, 2026, for the Meta catalog ads): once
  a product is saved, its slug is stored on it (`slug` in the `define_product` details)
  and kept through every later save. Renaming a product or changing its color keeps its
  link, and its new name's link opens it too. When a save would move another product's
  link (a new product whose name reads the same, or deleting one of two that do), the
  same save stores that product's current link as well (`keepProductLinks`). The slug is
  also the product's Meta catalog item ID, so ads, shared links and the Pixel's
  `content_ids` stay matched. Products saved before this change keep the slug their name
  gives them until they are next saved. An old link to a removed product shows the shop
  with a short notice.
- **The storefront**: opening `/p/<slug>` opens that product's sheet. While a product
  is open, the address bar, tab title, canonical link and `og:url` follow it, so the
  address can be copied (Chrome on iOS shares the canonical link). Closing it returns to
  `/`. Tracking and staff pages drop the shop home's canonical link, which the offline
  app copy carried before November 5 (see "Service worker" below). Product tiles are
  real links (long-press or right-click to copy, or open in a new tab). The sheet has a
  Share button: phones open the share sheet (Messenger, Facebook…), computers copy the
  link.
- **The preview**: link-preview crawlers don't run the app, so the Worker writes Open
  Graph and Twitter tags into `index.html` for `/` and `/p/*` (`worker/share-preview.ts`).
  The tags carry the title, description, photo, canonical URL and the product price in
  PHP. A product shows its own photo with its name and price, for example
  "12. White Sypik Philippines · ₱500", plus the shop's ordering facts. The home page
  shows the share card `public/og-image.jpg` (1200x630). The page is fetched without
  validators and served with `Cache-Control: no-cache` and no ETag, because it changes
  with the catalog. A catalog failure never blocks the page: it falls back to the shop
  card. Public product photos answer `HEAD` as well as `GET`, for crawlers that check an
  image first.
- Facebook caches a link's preview. To refresh one after changing a product's photo or
  price, paste the link into Facebook's Sharing Debugger and choose Scrape Again.

## Meta Pixel and the privacy page

Owner decision (November 5, 2026): the shop runs the Meta Pixel "Sports TECH Event
Data" (`1659409512144130`, connected to the Sports TECH ad account and the "Shirt
Catalog") so Facebook and Instagram ads can be measured and shown to shop visitors. The
owner chose to load it for every visitor, with a one-time notice and a way to turn it
off, rather than asking first.

- **Where it runs**: only the public shop, `/` and `/p/*` (bag, checkout and the
  order-complete screen are part of that page), and only on `sportstechph.store` and
  `www.sportstechph.store`. Staging builds carry no Pixel ID (`vite.config.js`), and any
  other host never loads it. It never runs on `/privacy`, `/track/*`, `/admin` or
  `/print`. The code is in `src/lib/metaPixel.js`; Meta's script loads after the shop
  has drawn.
- **Events** (`src/lib/pixelEvents.js`): PageView when the shop loads and whenever its
  address changes (a product opens or closes); ViewContent when a product opens;
  AddToCart; InitiateCheckout when Checkout is pressed; Purchase once the server confirms
  the order, with the server's total. Products are named by their link slug, which is
  also their Meta catalog item ID. The ball's "… per piece" bulk-price listings aren't in
  the Meta catalog, so they report as the main ball. Values are in PHP.
- **What the shop never sends Meta**: the customer's name, mobile number, address, email,
  order number or tracking key. History changes aren't logged automatically
  (`fbq.disablePushState`; the shop sends those PageViews itself, which needs
  `fbq.allowDuplicatePageViews`), and automatic button-click and page-metadata events are off
  (`autoConfig` false), because the order-complete screen shows the order number and its
  `/track` link. `/track`, `/admin` and `/print` set a `strict-origin` referrer policy
  (a meta tag, which also covers browsers still on the old service worker), so a link from an
  order page back to the shop never hands the Pixel `/track/<order number>` as the
  referrer. In Events Manager, keep automatic advanced matching and automatic events
  off; the privacy page promises it.
- **Ad clicks**: Meta credits an ad through its `_fbc` cookie, normally set from `fbclid`
  in the address. The shop tidies the address before Meta's script loads, so it sets
  `_fbc` itself from the landing address, in Meta's format (`fb.1.<time>.<fbclid>`), on
  `sportstechph.store` for 90 days, only while the Pixel is on.
- **Turning it off**: the notice's Turn off, the switch on `/privacy`, or the browser's
  Global Privacy Control signal. Turning off stops all events, revokes consent in the
  Pixel if it already loaded, deletes the `_fbp` and `_fbc` cookies, and keeps the
  Pixel from loading on later visits. A shop page already open in another tab, or
  brought back with the Back button, applies the change too. The choice is stored in
  the browser (`sportstech:meta-cookies`): `off`, `on` (only from Turn on at `/privacy`,
  the one thing that outranks Global Privacy Control) or `seen` (the notice's Got it,
  which keeps the Pixel as it is).
- **The privacy page** `/privacy` is the notice Meta's Business Tools terms require on
  pages that use the Pixel. It's linked from the cookie notice, the shop footer and the
  order-complete screen. Leaving the shop for it doesn't lose the bag: the bag is kept
  for the browser tab (`sessionStorage` key `sportstech:bag`, only names, sizes and
  quantities, rebuilt from the current catalog on return) and cleared when an order is
  placed. Because the bag outlives a reload, so does an unanswered order attempt: when
  "Place order" gets no reply, its request ID and a SHA-256 hash of the order (never the
  customer's details) stay in `sessionStorage` (`sportstech:checkout`) for the life of
  the tab. Retrying the same order reuses the ID at any time, so the server returns the
  original order instead of placing a second one. The payment receipt is left out of
  both the shop's hash and the server's duplicate check, so a receipt uploaded again
  after a reload still counts as the same order. A different order is held back for 30
  minutes with a message to check Track order first; if the server still reports the ID
  as used for a different order, the shop says the order was already received. Every
  statement describes what the app does today, so update it with any change to what is
  collected, who sees it (LBC, textbee.dev for texts, Cloudflare for hosting and email),
  or the Pixel's events.

## Installed app

The installed app (manifest `start_url` `/admin`) opens on the Orders tab (owner request,
November 10, 2026). In a browser tab, the admin still opens on the Point of Sale.
`src/lib/appStart.js` tells them apart by the `(display-mode: standalone)` media query, or
by `navigator.standalone` on iPhones. Installs made before this change follow it too:
nothing about the install itself changes.

## Service worker

The app installs a service worker (`vite-plugin-pwa`, `registerType: 'autoUpdate'`) that
precaches the built files, so repeat visits load scripts and images quickly. It never
answers a page load (November 5, 2026): `navigateFallback` is `null`, and `index.html` is
left out of the precache, since Workbox would otherwise still answer `/` from it as the
directory index. Every visit to `/`, `/p/*`, `/privacy` or `/track/*` gets its page from
the Worker, and so runs the current release. Before that change it served its saved
`index.html` for those pages, so a returning visitor ran the previous release for a whole
visit after each deploy (seen in the owner's Edge after the Meta Pixel release, where the
old shop could no longer apply vouchers). A browser still on that older worker picks up
the new one during its next visit; a real-browser check showed the new worker in charge
by the second visit. The client-side canonical cleanup on order and staff pages and their
referrer meta tag stay as safeguards. A shop page opened offline now shows the browser's
own offline page; the shop needs the network for its catalog anyway.

## Customer emails (migration 0017)

Owner decision (October 27, 2026): orders with a customer email get two emails through
Cloudflare Email Service, sent by the Worker itself (`worker/notifications.ts`):

- **We got your order**: right after a storefront checkout, or an owner POS sale, that has
  an email. Items, rush fee, shipping and total, payment method, ship-to address, "Order by
  Thursday, ships Sunday via LBC", and a link to the contact-verified `/track` page. Once per
  order; at most 10 a day to one address from the public checkout.
- **It's on its way**: when an owner save leaves the order Shipped with a tracking
  number (the order row's Ship, Mark as shipped, Edit, or a bulk Shipped where a number is
  already saved). Worded
  like the order page: a code shows as the LBC tracking number with a Track on LBC button; a
  saved link (another courier's) is "the courier's tracking link" with Open tracking link, and
  that email doesn't mention LBC. Once per tracking number
  and address: a corrected number or a corrected email sends again, a replayed or unrelated
  save never does, and shipping without a number sends nothing. Never the booking number.

The email field is optional: "Email (optional)" at checkout, and owner-only in POS and an
order's Edit. Resellers can't set or change it (server-enforced). It is stored as
`details.customerEmail` on each order line, trimmed and lowercased. The customer's `/track`
page, print staff and the production views never receive it.

Sender and binding: production has `"send_email": [{ "name": "EMAIL",
"allowed_sender_addresses": ["no-reply@sportstechph.store"] }]`; the code sends from
`SportsTech PH <no-reply@sportstechph.store>` with no reply-to. Staging has no binding, so it
never emails the real customers in its copied orders. Without the binding nothing is sent or
logged. Removing the binding and redeploying production turns emails off.

Requirements: Workers Paid (sending to any address; 3,000 emails a month included, then
$0.35 per 1,000), and `sportstechph.store` onboarded under Compute > Email Service > Email
Sending (the `cf-bounce` MX/SPF and `cf-bounce._domainkey` DKIM records; `_dmarc` is
`p=reject`). If the domain isn't onboarded, sends fail with `E_SENDER_DOMAIN_NOT_AVAILABLE`.

Delivery log: `customer_notifications` keeps one row per email (`received:{order}`,
`shipped:{order}:{tracking}:{email}`, `test:{owner}:{minute}`) with the recipient, status
(`sending`, `sent`, `failed`), attempts and the error code, never the message. A failed email
is retried the next time it is due (a retried checkout, or any later owner save of the
shipped order). The Orders screen shows "Tracking emailed to …" or why it wasn't sent.
Check recent sends read-only with:

```powershell
node node_modules\wrangler\bin\wrangler.js d1 execute sportstech-production --remote --config wrangler.production.jsonc --json --command "SELECT kind, status, error, attempts, updated_at FROM customer_notifications ORDER BY updated_at DESC LIMIT 20"
```

Settings > Customer Emails > Send Test Email sends a sample confirmation to the signed-in
owner. The emails load the logo (`/logo-mark.png`) and Barlow Condensed
(`/fonts/barlow-condensed-latin-800-normal.woff2`, served with `Access-Control-Allow-Origin: *`)
from the site; mail apps that block web fonts use a condensed system face.

## Validation and migration gates

The native Worker tests use locally signed JWTs and SQLite fixtures. They do not
replace an actual Access login or a remote D1 integration run. The current repo
also retains the existing storefront, pricing, inventory and Supabase regression
tests; their behavior must remain unchanged throughout migration.

Before production migration, verify the actual owner login, wrong/expired tokens,
uninvited identities, offboarding, repeat requests and database error paths through
the deployed Worker. Measure invocation CPU and row/query usage for representative
orders rather than interpreting network latency or Worker startup time as CPU.

D1 SQL batches only roll back on a real SQL error: zero affected rows are not an
error. Order-store guards must reject stale versions/snapshots and incomplete
membership inside the same batch as row changes, audit events and idempotency
receipts. Keep each entire order in one transaction; never split it into separately
committed batches to fit a query limit. Preserve exact decimal data rather than
rounding historical values during import.

`worker/order-store.ts` implements the owner order-save endpoint. It uses one snapshot read and one
13-statement atomic batch, with at most eight bindings per statement regardless
of line count. Exact decimal text and fractional timestamps survive normalization.
Known named guard failures become authorization/conflict errors; unrelated SQL
and infrastructure errors remain failures rather than being mislabeled.

The exact module was exercised through a temporary protected Worker against
remote D1 with 150-line orders, late-write rollback, concurrent versions and
idempotent replay. A separate integrated remote run covered checkout, tracking,
partial printing, quality checks, revised jobs and offboarding. Its temporary
Worker and database were removed. Actual owner Access sign-in was also verified.

Transaction history is served in pages of at most 100 rows. Clients advance by
the actual returned length and retain a stable revision across the complete
history; they do not silently truncate at the requested page size. A cheap
revision endpoint avoids repeatedly transferring unchanged history. Print-source
selection follows its `nextOffset` cursor. Public catalog reads compact historical
definition and stock events in SQL before reconstructing them with shared helpers.
Stock-only reads no longer allocate order pricing, customer or shipping objects.
The catalog query groups resolved stock descriptors, sums safe integer movements
in D1, and retains an exact JavaScript conversion path for unusual legacy
quantities. Its projection stages are explicitly materialized to avoid D1 planner
memory growth from repeated grouped JSON expressions. Cold-cache correctness is
verified independently of the in-memory revision cache; cache hits are not a
substitute for a working cold path.
Cold and warm real-data CPU measurements, not just synthetic runs, are required
to confirm the configured CPU budget.

The September 18 staging follow-up reduced the imported catalog projection from
312 to 166 rows without changing its 51 products or 94 stock keys. Three isolated
cold catalog samples used 9, 5 and 5 ms CPU. This does not clear the overall Free
plan gate: optimized, correlated cold reseller saves used 13 ms for two lines,
32 ms for 27 lines and 74-97 ms for 150 lines, above the 10 ms Free allowance.
All six saves had correct atomic results, but correctness is not a CPU pass.
The reseller path reuses unchanged pricing builds and indexed item lookups.
These measurements failed the original Free gate. The owner's subsequent
Workers Paid upgrade permits a higher, explicit CPU budget without weakening
atomicity or permissions. Keep staging read-only and production unrouted until
the remaining identity, final-data-copy and rollback gates pass.

Source migration exports must be protected, reconciled and kept outside Git.
Database JSON exports without stored file bytes and auth recovery information are
not full restore backups. A tested write freeze, final import, file-reference
mapping and rollback procedure are required before replacing the live backend.

## Printing permissions and workflow

No employee is automatically granted access. After the production migration, the
owner can prepare an individual `print_operator` membership and separately allow
that exact email in the production `/print` Access application. The employee
must not receive Cloudflare dashboard privileges or an owner role.

Only assigned, explicitly released shirt jobs are visible. Product/design names,
variants, required quantities, progress, the design photo, the customer's name and the
LBC booking code are allowlisted. The name is shown so the printer can write it on the
package (owner decision, October 13, 2026, migration `0010_production_customer_name.sql`);
it is read live from the order line, so a corrected name reaches the printer.

LBC numbers (owner decisions, October 20 and 21, 2026; migrations
`0012_production_tracking_number.sql`, then `0013_production_booking_number.sql`). LBC
gives two numbers per parcel, kept apart on the order:

- **Booking number** (`details.bookingNumber`): LBC gives it when the owner books the pickup.
  In Orders, open an order > Book with LBC (one copy button per LBC form field, or Copy
  all; the row's clipboard button copies the same block), then paste the booking number
  there or in the order row's "LBC booking no." box. Once the order is booked, that row box
  asks for the tracking number instead, with the booking number shown above it. Print staff
  see the booking number next to the customer's name under "Write on package", read live from
  the order line, on in-progress and accepted jobs alike, and write it on the package. Only a
  plain code (4-40 letters, digits, spaces or dashes) is shown; links and anything else stay
  owner-only. Saving it never changes the order status, is never texted and never holds a
  print job, so it works while printing is still in progress.
- **Tracking number** (`details.trackingNumber`): LBC gives it once the parcel ships. It is
  the customer's. The owner pastes it in the order row's "LBC tracking no." box and presses
  Enter (or Ship), or in the panel and taps Mark as shipped. Either way it is saved with
  Shipped in one save (print-queue orders still need finished QA, and the owner confirms
  packing, accessories and the package label at this step) and sends the tracking text when
  SMS is on. If the order has a customer email, the same save emails the number too (see
  Customer emails). If the field is empty, the row or the panel asks for the number, and the
  row refuses the booking number pasted there by mistake. Shipping without one (another
  courier, a pickup) is an explicit choice in the panel and texts and emails nothing. The
  customer's contact-verified `/track` page shows the number with a "Track on LBC" link once
  the order is Shipped. Print staff never receive it. Correcting it on a shipped order texts
  and emails the new number.

Orders > Fulfillment > **Booked, not shipped** (owner decision November 5, 2026) lists the
orders that have a booking number and are still Pending, In progress or Ready, with their
count: orders as the list groups them, not lines. In Multi-select, **Select all N** selects
exactly what the filters show, for a bulk update. A bulk Shipped asks the packing question
once for the whole update, when the first print-queue order needs it, and declining stops the
update there. It sends no text, and emails only orders whose tracking number was already saved.

Apply `0013` with `npm run db:staging` / `npm run db:production` right before deploying the
code that shows it. Until both are live, the print queue shows "Not booked yet". Every
production order that had a tracking number on October 21 was already shipped, so no
saved number needed moving.

Customer contacts, addresses, order numbers, customer receipts, pricing, stock costs and
management comments are not returned. Order numbers appear only on the owner's screens.

The owner prepares jobs under Production > Prepare shirt jobs: waiting shirt lines are
grouped by the customer who ordered (oldest order first, with the order number), can be ticked one by
one or a whole order at a time, and every ticked line is prepared for one employee in a
single atomic save (`POST /api/production/jobs/batch`, up to 100 lines per request; a larger
selection prepares the oldest 100 and keeps the rest ticked), optionally released at once
after the same artwork and blanks confirmations as a single release. Job lists for the
owner and print staff are first in, first out: unfinished jobs by order date, oldest first,
then accepted jobs. The order date is a sort key only; it is not returned to staff.

Print staff see their jobs as packages, one per order (owner request, October 27, 2026):
each package shows the package label (customer name and LBC booking number), its status
(To print, Awaiting owner QA, Problem reported, Ready to pack), shirt counts and design
list, and opens to the usual job cards. Packages start collapsed, open by themselves when
they match a search or are the only one shown, and can be searched by customer name, LBC
booking number (with or without spaces), design, color, size or job code. Every job in
`GET /api/production/jobs` carries `packageKey`, a keyed one-way hash of its order
(HMAC-style with `GUEST_TOKEN_SECRET`), so staff can group a parcel without ever receiving
the order number. If that secret is missing or shorter than 32 characters, jobs carry no key
at all (never an unkeyed hash) and the queue shows one package per job. Two orders under the
same name stay two packages, with a warning to keep the parcels separate.

Design photos (migration `0009_production_design_photos.sql`): each job snapshots its
order line's product photo when prepared. Only public product media is attached; the
Worker resolves the id through `media_objects.visibility = 'public'`, so private receipt
files can never reach print staff. Lines without a stored product photo show "No design
photo"; the employee then uses the artwork the owner supplied separately.
The employee records whole partial quantities as Printing, Printed or Problem.
Printed quantities await owner QA. Accepted and rejected quantities are recorded
atomically with immutable events; rejected shirts return to the rework count.
**Accept all** (owner, October 21, 2026; `POST /api/production/qa`) accepts every shirt
awaiting QA on up to 100 released, unchanged jobs (oldest first) whose packages are fully
printed, in one atomic, idempotent save. Each job gets the same update and `qa` event as a
single full acceptance, so wallet credit is identical; if any job's version or awaiting count
changed since the owner loaded the list, nothing is accepted. Rejections stay on each
job's own quality check.

**QA waits for the whole package** (owner decision, November 3, 2026): the owner checks a
customer's package at once. Shirts on a job can be accepted or sent back, singly or with
Accept all, only when every shirt line of its order has an active job, every active job is
released and unchanged, and no active job still has a shirt that was never printed. Reprints
of rejected shirts don't count, so a package in rework stays checkable. Otherwise the save
returns 409 `production_package_incomplete` with what the package waits for (for example
"2 shirts still to print" or "1 shirt line not in the print queue yet") and nothing is saved;
Accept all names up to three such orders. Production lists those orders under "Printed, not
ready for QA" with the same reasons, and their job cards say why in place of the QA form.
A shirt line that never gets a job keeps its order out of QA, so the order can't reach Ready
or Shipped. No production order was in that state on November 3, 2026. Don't queue a shirt
that needs no printing just to unblock QA: the printer would be credited for shirts they
didn't print. Add a "no print needed" option instead if it comes up.

Physical order-line changes hold related jobs, retaining their original counts
and immutable source fingerprints. A held job's card says why and offers only what can
work (owner report, November 3, 2026; none needs a typed reason, which is optional and
saved in the job's history):

- **Keep this job**, when the shirt is still the same (design, brand, color, size and
  quantity, judged by the rule that prepared the job). An edit can rewrite a line's stored
  fields without changing the shirt, for example filling in a missing color label.
  Keeping clears the hold with every count intact: a fully accepted job is complete again,
  and the order moves to Ready when every shirt on it is accepted, as QA would have done
  (`POST /api/production/jobs/{id}/keep` with `{ expectedVersion, confirmed: true, note?,
  requestId }`, owner only; it returns `{ job, orderReady }` and refuses with 409 if the
  shirt changed or left the order).
- **Prepare revised job** for the shirt now on the order. A replacement starts with zero
  production counts; it never transfers old accepted work to a changed design or shifted
  legacy item index.
- **Retire job**. A retired job no longer gates its order, so the owner can mark it Ready
  or Shipped by hand. Retiring a job with accepted shirts takes it off the printer's list.
  When no other released job is left on the order, the printer no longer sees that
  package or its label. When no other job is left at all, Shipped no longer asks for the
  packing check. The confirm says which applies, and points to Keep when the shirt is
  unchanged.

Shipping or marking Ready an order with a job held by an edit returns 409
`ORDER_CONFLICT` saying the job is on hold because the order was edited, and to keep or
retire it in Production. It no longer asks the owner to finish printing.

Deleting an order, or an order line, retires its print jobs at once (migration
`0019_retire_deleted_order_jobs.sql`): nothing on a deleted line can be printed or
replaced. Every count and event stays in the job's history, and print pay is unchanged,
because the wallet counts QA events whatever the job's status. Other rows of the same
order that were Ready or Shipped move back to In progress, with the packing confirmation
cleared, because the package changed. 0019 also retired the 8 jobs that were already held
for orders deleted on October 25, 27 and 28. Apply it with `npm run db:staging`, then
`npm run db:production`, before deploying the code.

The order editor (Orders > Edit > Save, the customer's Modify order, reseller edits)
keeps a row's stored print fields whenever their meaning is unchanged and a reseller save
can read them back (an empty name, size or color, a quoted quantity or a name taken only
from the description is still written the way the editor shows it). Older rows lack
fields the editor writes (`linkedColor`, `category`, `brand`, `itemName`), and those raw
fields are in the 0005 fingerprint. So saving an older order without changing a shirt
(for example to type an LBC booking number) no longer holds its printed jobs or reopens
it. Payment/comment changes and returned tags do not restock inventory or consume
blanks again.

Ready rule (owner decisions, October 13 and 23, 2026): only orders sent to the print queue
are gated. If an order has an active (not retired) print job, it can enter Ready or
Shipped only when every such job is completed, fully accepted in QA and still matches
its order line. **QA moves the order to Ready by itself**: the save (single QA or Accept
all) that accepts the last shirt sets every active row of the order to Ready when every
shirt line of the order has a completed, current job and no row is already Shipped,
Returned or Cancelled. An order with a shirt line that was never queued stays In progress:
under the package rule above its printed shirts can't pass QA either, so it can't reach
Ready until that line is prepared, printed and accepted. Only
`fulfillmentStatus` changes (never payment), the order version advances, and no job is held.
Migration `0014_ready_after_qa.sql` applied the same rule once to the 28 orders that were
already fully accepted on October 23. The owner confirms packing, accessories and the
package label (customer name and LBC booking number) once, on the way into Shipped; Ready
no longer asks, and a bulk Shipped asks once for all its orders. Orders without print jobs,
such as counter sales and orders placed before
the queue, keep the previous workflow with no extra prompt. Retiring a held job removes its
gate. Historical already-ready orders are not given retroactive jobs for a payment-only
change. Employees cannot release work, approve QA, change quantities on orders, mark
payments or ship orders.

### Print wallet (migrations 0007, 0018 and 0021)

The employee's `/print` dashboard shows a shirt counter and wallet; the owner sees each
print operator's counts and records payouts under Production > Employee accounts.

- **Pay rule:** PHP 1,000 for every complete 30 shirts the owner accepts in QA. Partial
  batches carry over as a count and are never paid in fractions. Self-reported
  "printed" quantities and rejected shirts never count; a reprinted shirt counts once,
  when its reprint is accepted. The rate lives in the Worker (`PRINT_RATE_SHIRTS`,
  `PRINT_RATE_CENTAVOS`) and is returned by the API.
- **Attribution:** each QA acceptance is credited to the member who certainly printed it:
  every `printed` event since the job's pending count was last zero has that actor. Mixed
  printers, or prints recorded by the owner, stay unattributed and are shown to the owner
  as a count to settle outside the app; they are never credited by assignee.
- **Money:** integer centavos only. Payouts are owner-only, whole PHP 1,000 steps,
  idempotent by request ID, capped at the balance due inside the atomic D1 batch, and
  append-only (no update or delete).
- **Expenses** (migration 0021, owner request, November 2026): staff pay counts as an
  expense. The same atomic batch that records a payout writes a General expense with the
  payout's ID, peso amount and time: "Print staff pay: {name} ({note})", with
  `details.subCategory` "Print staff pay" and `details.payoutId`. Reports counts it as a
  production cost. The expense stays matched to the payout: `PATCH` and `DELETE
  /api/transactions/{id}` refuse any change except its reimbursement status (409
  `staff_pay_locked`), and a new record or edit that sets `payoutId` is refused (400). The
  Expenses screen shows it as a Staff payout without Edit or Delete. Migration 0021 wrote
  the same expense for payouts recorded before it, skipping any ID already used.
- **History** (owner request, November 3, 2026): print staff open History on `/print` (a tab
  next to Queue, or "See my history and payouts" under My shirts). Newest first, by
  Philippine day, it lists every quantity they recorded as printed, each quality check of
  their shirts (accepted, and sent back with the owner's note) and every payout with its
  receipt. The owner sees the same for each operator under Production > Employee accounts >
  History. Entries name the job's design, size, color, job code and customer, which staff
  already see on their jobs; never order numbers, prices or contacts.
- **Receipts** (migration 0018, same request): when recording a payout the owner can attach
  a photo or screenshot of the GCash or bank transfer, or attach one later (or replace a
  wrong one) from that operator's History. Phones scale large photos down to 2000 px JPEG
  before upload. Receipts are private media under `payout-receipts/{id}` (`Cache-Control:
  private, no-store`); `/api/media/objects/{id}` serves one only to the owner and to the
  print operator who was paid (anyone else gets 403). `print_payout_receipts` links a payout
  to one current receipt and a file to one payout, so `print_payouts` stays append-only. A
  receipt chosen in the dialog but never saved stays an unlinked private file.
- **API:** `GET /api/production/wallet` returns `{ wallet }` for a print operator (own
  counts only; another `memberId` is 403) or `{ wallets, unattributed }` for the owner
  (`?memberId=` returns one `{ wallet }`). `POST /api/production/payouts` takes
  `{ operatorId, amountCentavos, note?, receiptId?, requestId }` and returns
  `{ payout, wallet }`, with `payout.receiptUrl` (null without a receipt).
  `POST /api/media/payout-receipts` (owner only, image body) returns `{ id, url }` for
  `receiptId`. `POST /api/production/payouts/{id}/receipt` takes `{ receiptId, requestId }`,
  attaches or replaces the receipt (the replaced file is deleted) and returns `{ payout }`.
  Both refuse a receipt this owner didn't upload there, or one already on a payout (409
  `production_receipt_invalid`). `GET /api/production/history` returns
  `{ memberId, name, entries, next }`, 40 entries a page; pass `next` as `?before=` for older
  entries. Staff read only their own (another `memberId` is 403); the owner must pass
  `?memberId=`. Read-only environments refuse the POSTs like every other write.

Apply `0007_print_wallet.sql` with `npm run db:staging`, then `npm run db:production`,
**before** deploying code that reads it. The cutover `load-target` preflight requires the
target's applied migration count to match this repository, so land 0007 only after cutover.
`0018_print_payout_receipts.sql` (the receipts table and two history indexes) is additive and
applies the same way, before deploying the code that reads it. `0021_staff_pay_expenses.sql`
is the exception: it only inserts the expenses of payouts recorded before this release, and the
Worker reads no new schema. Deploy the Worker first, then apply 0021, so a payout recorded in
between still gets its expense (0021 skips IDs the new Worker already wrote).

## Protected import and production cutover

Every cutover command writes customer data, keys and file bytes only to a private
directory outside the repository; the tools refuse paths inside the Git worktree.
`$P` below is that restricted directory (it must already contain
`production-worker-secrets.json`). Production resources already exist; never
recreate them or reuse the staging Access audience or secret.

| Tool | Purpose |
| --- | --- |
| `scripts\cutover\source-freeze.mjs` | Reversibly removes every browser-role write grant on the old Supabase database while leaving reads intact. `status`, forced-rollback `rehearse`, `freeze`, and exact `unfreeze` from the saved grant snapshot. |
| `scripts\cutover\export-source.mjs` | One consistent source export plus SMS settings encrypted directly with the production key (plaintext never written). `--require-frozen=true` refuses an export unless the freeze holds before and after it. |
| `scripts\cutover\sync-media.mjs` | Copies source files into the production bucket, reusing cached copies only when their size and source checksum match, verifies every upload by SHA-256 round trip, and records referenced files the source confirms are already missing. |
| `scripts\prepare-migration.mjs` | Builds the import and rehearses it against the full D1 schema locally. |
| `scripts\cutover\load-target.mjs` | Imports only into a migrated database containing just the approved owner, then exports the remote database and reconciles every migrated column exactly. Refuses a second import. |

The October 5, 2026 rehearsal used a fresh live export (1,638 transactions,
361 orders, 131 files): all 131 files are now in `sportstech-production-media`
and passed SHA-256 round trips; the temporary database reconciled exactly,
rejected a duplicate import, decrypted SMS settings only with the production key,
and produced the same 51-product/94-stock-key catalog as the full history. The
freeze was rehearsed live inside a forced-rollback transaction: browser writes
dropped to zero while all reads remained, and the original grants were unchanged
afterward. Production D1 itself still contains only the owner.

### 1. Before the cutover window (no customer-visible change)

Completed October 5, 2026:

1. **Nameservers.** Hostinger now delegates to `salvador`/`shaz.ns.cloudflare.com`;
   the zone became **Active** at 14:56 PHT (DNSSEC off, no mail records). Hostinger
   can no longer edit its old copy but still answers it, so resolvers that cached
   the old 24-hour nameserver records keep reaching Vercel directly until they
   expire (~15:00 PHT October 6). Wait for that before freezing, otherwise those
   visitors would see the frozen old store.
2. **Proxy and TLS.** The apex `A` and `www` `CNAME` still target Vercel but are
   **Proxied**; the universal edge certificate is active, encryption is
   **Full (strict)** and **Always Use HTTPS** is on. The live store is unchanged
   (same Vercel bundle; the bare domain still redirects to `www`).
3. **Production Access.** Application **SportsTech production**
   (`bbbd8f96-a2b4-4d8d-a213-b61af9670f40`) protects exactly
   `www.sportstechph.store/admin` and `/print` with the **SportsTech owner**
   policy, a 24-hour session, an HttpOnly cookie and no path-scoped cookie (so the
   signed cookie also reaches `/api/*`). Its AUD is in `wrangler.production.jsonc`.
   The dashboard form silently dropped the subdomain and paths once; always verify
   the saved destinations before relying on them. Until cutover, Access also asks
   for the owner code before the old Vercel `/admin`.
4. **Route permission probe.** The production Worker already serves only
   `www.sportstechph.store/health` and `/api/session`; everything else still reaches
   Vercel. This proves the CLI can attach routes, so the cutover needs no DNS edits.
5. **Accounts.** Production launches with only the approved owner. The four legacy
   logins (two admins, one reseller, one staff) stay archived, not enabled; none
   has signed in since June 2026. Add any of them later only by explicit decision.

Optionally re-run `sync-media.mjs` first so only new files remain for the window.

### 2. Cutover window

Confirm first that public resolvers (including OpenDNS `208.67.222.222`) return the
Cloudflare nameservers for `sportstechph.store`.

```powershell
$W = "$P\cutover-YYYYMMDD"
node scripts\cutover\source-freeze.mjs --mode=rehearse --work-dir=$W\work
node scripts\cutover\source-freeze.mjs --mode=freeze --work-dir=$W\work --confirm=freeze-sportstech-source
node scripts\cutover\export-source.mjs --out-dir=$W --work-dir=$W\work --settings-secret-file=$P\production-worker-secrets.json --require-frozen=true
node scripts\cutover\sync-media.mjs --export=$W\source-export.json --cache-dir=$P\storage-objects --config=wrangler.production.jsonc --manifest=$P\production-media-manifest.json --missing=$W\missing-media.json
node scripts\prepare-migration.mjs --source=$W\source-export.json --media=$P\production-media-manifest.json --sms=$W\sms-settings-encrypted.json --missing-media=$W\missing-media.json --output=$W\import.sql
node scripts\cutover\load-target.mjs --config=wrangler.production.jsonc --import=$W\import.sql --work-dir=$W\work --owner-email=jerrosyap05@gmail.com --confirm=load-sportstech-production
```

From the freeze onward the old site is read-only: browsing still works, but its
checkout and admin saves fail. Supabase Storage uploads and auth-profile edits are
not frozen; anything changed there after the export is not migrated.

Then route traffic to the Worker:

1. In `wrangler.production.jsonc`, set `MUTATIONS_ENABLED` to `"true"` and set the
   routes `www.sportstechph.store/*` and `sportstechph.store/*` (zone
   `sportstechph.store`). Run `npm run deploy:production`. The proxied records now
   deliver every request to the Worker; the bare domain redirects to `www`.
2. Confirm `/health` reports the deployed version, then the storefront, catalog,
   product images and order tracking. Sign in at `/admin` (the owner enters the
   emailed Access code) and confirm the owner session and order history.
3. Merge the branch to `main` only **after** the Worker serves the domain:
   `vercel.json` then permanently redirects `sports-tech-manager.vercel.app` to
   `www.sportstechph.store`. Merging earlier would serve the new frontend on Vercel
   without its APIs.

**Executed October 7, 2026.** The source was frozen at 12:48 PHT (12 revokes,
browser writes 10 → 0, reads intact; grant snapshot saved in the private cutover
directory). The frozen export (1,643 transactions, 132 files) loaded into production
and reconciled exactly: 1,643 transactions, 364 orders, 5 customers, 2 referrers,
132 media, 1,658 archive rows and 2 SMS settings, owner only. The one new file was
uploaded and SHA-256 verified. Before routing, a probe showed the bare-domain route
would bypass the redirect for static pages, so production now runs the Worker first
for every request (verified on probe paths first). Worker version
`64fc1334-ad65-45bc-b326-399751f5be34` went live with writes enabled at about
13:00 PHT, roughly 12 minutes after the freeze. Storefront, catalog (51 products,
94 stock keys), migrated images, tracking, `/admin` and `/print` Access redirects,
private-API 401s and 301 redirects were verified. `main` was fast-forwarded to
`de065c8`; Vercel production now 308-redirects `sports-tech-manager.vercel.app`
to `www`.

### 3. Rollback

- **Before production accepts writes:** redeploy with no routes (traffic returns
  to Vercel through the proxy) and reopen the old database exactly with
  `source-freeze.mjs --mode=unfreeze --snapshot=<saved snapshot> --confirm=unfreeze-sportstech-source`.
- **After production accepts writes (current state):** switch `MUTATIONS_ENABLED`
  back to `"false"` first. Orders taken on Cloudflare must be copied back into
  Supabase and reconciled before unfreezing it; changing routes or DNS alone would
  lose them. This reverse copy is manual and not automated.

Only one backend may accept live financial writes. Keep the frozen Supabase
project, the Vercel project and every private export. Do not cancel paid source
services, delete projects, or destroy backups without explicit approval after a
verified cutover.

### 4. Employee printing (enabled October 13, 2026)

`PRINT_QUEUE_ENABLED` is `"true"` in production and the production build enables the
matching UI. Invite the employee under Settings > Team as Print staff; the production
Access team policy already lets any invited email sign in. Start with a practice job
before releasing real work. To turn printing off again, set both flags to `"false"` in
one release; existing jobs, events and wallet records are kept.
