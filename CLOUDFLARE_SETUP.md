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
uploads an arbitrary older `dist`. Production builds keep printing off unless
`VITE_PRINT_QUEUE_ENABLED=true` is explicitly set for the corresponding rollout.

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

The preparation commands below build production assets with printing off.
Do not set frontend `VITE_PRINT_QUEUE_ENABLED=true` until the later employee
rollout, and keep it consistent with the Worker's `PRINT_QUEUE_ENABLED` flag.

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

Resellers can edit only their own unpaid, pending orders. The server rebuilds
quantity/removal pricing using the existing reseller policy, verifies complete
source snapshots and ownership inside the write batch, and rechecks membership
on retries. Payment, fulfillment, tracking, product replacement, discounts and
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
| `/admin` | Authenticated owner/reseller workspace; print operators redirect to `/print` before management data loads |
| `/print` | Assigned, owner-released production jobs only; requires the print feature flag |
| `/api/public/*` | Sanitized catalog, server-priced checkout and order-scoped guest tracking/edit capabilities |
| `/api/transactions`, `/api/orders/save` | Role-checked business reads and atomic, versioned mutations |
| `/api/production/*` | Scoped partial print progress, owner release, QA, holds and reviewed job replacement |
| `/api/media/*` | Validated uploads and public product/private receipt access |
| `/api/settings/sms`, `/api/sms` | Owner-only encrypted gateway settings; actual SMS delivery disabled in staging |

`MUTATIONS_ENABLED` must explicitly be `true` before any HTTP mutation is accepted.
Staging deliberately keeps it `false` while the imported financial snapshot is
reviewed. Synthetic mutation tests use separate temporary resources, not live
customer orders. `PRINT_QUEUE_ENABLED` gates both production APIs and employee
account preparation; `VITE_PRINT_QUEUE_ENABLED` gates the corresponding UI.

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
variants, required quantities and progress are allowlisted; customer contacts,
addresses, receipts, pricing, stock costs and management comments are not returned.
The employee records whole partial quantities as Printing, Printed or Problem.
Printed quantities await owner QA. Accepted and rejected quantities are recorded
atomically with immutable events; rejected shirts return to the rework count.

Physical order-line changes hold related jobs, retaining their original counts
and immutable source fingerprints. The owner can explicitly prepare a reviewed
replacement draft or retire a held job. A replacement starts with zero production
counts; it never transfers old accepted work to a changed design or shifted legacy
item index. Payment/comment changes and returned tags do not restock inventory or
consume blanks again.

Entering Ready or Shipped requires complete current shirt-job QA and an explicit
owner packing confirmation when printing is enabled. Historical already-ready
orders are not given retroactive jobs for a payment-only change. Employees cannot
release work, approve QA, change quantities on orders, mark payments or ship orders.

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

### 4. Employee printing (after a stable cutover)

Add the employee's exact email as a second policy on the same Access application,
prepare their account under Production > Employee accounts, then set `PRINT_QUEUE_ENABLED` to
`"true"` and build with `VITE_PRINT_QUEUE_ENABLED=true` in the same release. Start
with a practice job before releasing real work.
