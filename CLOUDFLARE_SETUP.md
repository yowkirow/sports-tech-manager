# Cloudflare staging

Production remains on Vercel and Supabase. This is an isolated backend foundation,
not a completed migration or an employee-access release. Do not change the
Hostinger nameservers, replace live DNS targets, disable Supabase, or copy real
customer records into staging as part of deploying this foundation.

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
npm run build
npm run db:staging
npm run deploy:staging
```

Database migrations must be applied before enabling authenticated endpoints.
Changing the frontend build or pushing a Vercel branch does not deploy this Worker;
use the explicit staging command and verify the returned Worker version ID.

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

## Current endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Non-sensitive service/version check; subject to the hostname's Access policy |
| `GET /api/session` | Verified Access identity and active D1 membership required |
| `GET /` | Owner-only staging status, not the storefront |
| Any write method | Rejected; no financial or production mutation API is enabled |

Responses use `Cache-Control: no-store`. No private data or permissive CORS headers
are returned to anonymous requests. Unexpected `/api` paths never fall back to a
successful SPA document. The staging database must contain only deliberate
account setup and synthetic fixtures until a separately reviewed import.

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

`worker/order-store.ts` implements the save primitive but is deliberately not
exposed as an HTTP mutation endpoint yet. It uses one snapshot read and one
13-statement atomic batch, with at most eight bindings per statement regardless
of line count. Exact decimal text and fractional timestamps survive normalization.
Known named guard failures become authorization/conflict errors; unrelated SQL
and infrastructure errors remain failures rather than being mislabeled.

The exact module was exercised through a temporary protected Worker against
remote staging D1 with 150-line orders, late-write rollback, concurrent versions
and idempotent replay. Synthetic fixtures and the temporary Worker were removed.
This does not establish Access sign-in or Free invocation CPU compliance; those
remain required gates before enabling application writes or migrating production.

Source migration exports must be protected, reconciled and kept outside Git.
Database JSON exports without stored file bytes and auth recovery information are
not full restore backups. A tested write freeze, final import, file-reference
mapping and rollback procedure are required before replacing the live backend.

This staging work does not grant employee access. The dedicated print queue,
owner-released jobs, partial progress, QA/rework and restricted APIs follow after
the migration is complete.
