# Cloudflare migration and staging

Production remains on Vercel and Supabase until the cutover below is completed.
The integrated React app, business APIs and print workflow run in isolated,
owner-protected staging. Its imported source snapshot is read-only by default.
Do not redirect live traffic or retire the source database merely because staging
has deployed successfully.

## Prerequisites

Use Node.js 22.19 or newer and `npm ci`. Cloudflare credentials remain in the
authenticated Wrangler profile or your secret manager; never commit tokens,
`.dev.vars`, `.env`, exported customer data, or SMS credentials.

`wrangler.staging.jsonc` targets only `sportstech-staging`. The D1 binding is a
separate database, not a link to any existing app's database. There is deliberately
no production Worker config, route, custom domain, or preview URL enabled here.

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
to confirm Free-tier suitability.

The September 18 staging follow-up reduced the imported catalog projection from
312 to 166 rows without changing its 51 products or 94 stock keys. Three isolated
cold catalog samples used 9, 5 and 5 ms CPU. This does not clear the overall Free
plan gate: optimized, correlated cold reseller saves used 13 ms for two lines,
32 ms for 27 lines and 74-97 ms for 150 lines, above the 10 ms Free allowance.
All six saves had correct atomic results, but correctness is not a CPU pass.
The reseller path reuses unchanged pricing builds and indexed item lookups;
further CPU reduction or a separately approved architecture/plan decision is
required before live cutover. Keep staging read-only and production unchanged;
do not split atomic saves, silently cap orders or upgrade to hide this limit.

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

`scripts/prepare-migration.mjs` validates the source export, exact decimals, all
source columns and verified file mappings against the complete D1 schema before
writing an import file. Run it only with restricted files outside the repository:

```powershell
node scripts\prepare-migration.mjs --source=C:\private\baseline.json --media=C:\private\media-manifest.json --sms=C:\private\sms-settings-encrypted.json --output=C:\private\import.sql
```

An optional `--missing-media=C:\private\missing-media.json` file may describe
references individually verified as already missing from the source. Those
references remain explicit 404s; they must not be reported as successfully copied.
The original records remain in `migration_archive`. Use `--validate-only=true`
to repeat the local restore rehearsal without writing another import.

Before cutover, use separate production D1/R2 bindings, a production Access
application for protected UI paths (not the public storefront), and fresh,
appropriately protected Worker secrets. The Worker also verifies signed Access
cookies on private APIs; hidden navigation is not an authorization boundary.
Re-encrypt imported SMS settings with the target environment's settings key.
Do not reuse staging guest-signing secrets in production or copy encrypted
settings while changing their key without a verified re-encryption step.
Preserve existing owner/reseller/staff attribution in archives and review legacy
login grants rather than promoting every historical account to owner.

Freeze source writes at the database, take and reconcile a final consistent
export, copy new files, validate production privately, and then switch web routing.
Only one backend may accept live financial writes. Preserve Hostinger registration
and all applicable DNS/mail records. Do not change nameservers until the confirmed
Cloudflare zone contains verified records. Keep the old database and a rollback
procedure: after the new backend accepts writes, reverting requires another
freeze and reconciliation, not merely changing DNS.

Do not cancel paid source services, delete projects, or destroy backups without
explicit approval after a verified cutover. The initial staging snapshot is not
the final write-frozen production export.
