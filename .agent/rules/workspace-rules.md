# Workspace Rules - Git Operations

All git operations in this workspace (staging, committing, and pushing changes) MUST follow the logic and conventions defined in the `@git-pushing` skill.

## Required Workflow
1. Use the `@git-pushing` skill for any request related to saving, committing, or pushing code.
2. Follow the conventional commit format specified in the skill.
3. Use the smart commit script located at `.agent/skills/skills/git-pushing/scripts/smart_commit.sh` whenever possible (or its direct Git command equivalent if shell access is limited).

## Supabase Operations
For advanced database management, complex queries, or schema inspection beyond standard hooks, use the `@supabase-automation` skill.
1. ALWAYS use the tool sequence defined in `@supabase-automation` (Search → List → Schema → Query).
2. Prefer the high-level toolkit abstractions over raw SQL when possible.
3. Handle API keys and sensitive project references with extreme care as per the skill's security guidelines.

Failure to use the `@git-pushing` or `@supabase-automation` workflows for their respective tasks is prohibited for this workspace.

## Automatic Deployment

After each completed code change set, run the relevant checks and production build, commit the changes, push, and deploy it as described below. Deploy completed change sets, not intermediate edits.

Verify the deployment for the exact pushed commit and report its URL/version and environment. A successful Git push alone does not confirm a successful deployment.

## Production on Cloudflare (since October 7, 2026)

`www.sportstechph.store` and the bare domain are served by the `sportstech-production`
Worker (`wrangler.production.jsonc`): D1 `sportstech-production`, R2
`sportstech-production-media`, Access app **SportsTech production** on `/admin` and
`/print`. A production release is: tests + `npm run check:worker` + `npm run build`,
commit, push, apply any new migration with `npm run db:production` **before** the code
that needs it, then `npm run deploy:production`, and verify `/health` reports the new
version. Release to production only when the user requests or approves it; merging to
`main` alone does not deploy the Worker.

Vercel now only redirects `sports-tech-manager.vercel.app` to `www` (from `vercel.json`
on `main`). Working branches still get Vercel previews, but they are not wired to the
APIs. The old Supabase project is frozen (browser writes revoked) and kept as the
rollback copy; do not unfreeze, cancel or delete Supabase or Vercel without explicit
approval.

## Cloudflare staging

Owner review uses `wrangler.staging.jsonc` and the isolated `sportstech-staging`
resources (read-only snapshot).

For a completed staging change set, run `npm run check:worker`, the relevant tests
and the frontend build; apply required staging migrations, commit/push the working
branch, and run `npm run deploy:staging`. Verify the exact Worker version and the
expected authentication-denial behavior.
Do not interpret a successful staging deploy as permission to deploy production or
grant employee access.

The owner approved Workers Paid on September 22, 2026. Keep the explicit
1,000 ms per-request CPU ceiling; it is not a monthly spending cap or permission
to upgrade other services.

Production runs the Worker first for every request (`run_worker_first: true`) so the
bare domain redirects to `www`. Do not build/deploy staging and production
concurrently because they share `dist`.

The cutover tools in `scripts\cutover` write only to private directories outside
the repository. `freeze`, `unfreeze` and `load-target` require explicit `--confirm`
values. `load-target` refuses a database that already holds data; never re-run it
against live production.
