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

After each completed code change set, run the relevant checks and production build, commit the changes, and push the working branch so the connected Vercel integration deploys them. Deploy completed change sets, not intermediate edits.

Verify the deployment status for the exact pushed commit and report its URL and environment. A successful Git push alone does not confirm a successful deployment.

Working branches use Vercel preview deployments. Production remains tied to `main`; do not merge or push to `main` solely to deploy unless the user explicitly requests a production release. Report deployment failures or missing Vercel integration instead of claiming the changes are live.

## Cloudflare Migration Staging

Until the separately verified production cutover, Vercel and Supabase remain the
live application. Worker changes use `wrangler.staging.jsonc` and the isolated
`sportstech-staging` resources only.

For a completed staging change set, run `npm run check:worker`, the relevant tests
and the frontend build; apply required staging migrations, commit/push the working
branch, and run `npm run deploy:staging`. Verify the exact Worker version and the
expected authentication-denial behavior as well as the branch's Vercel preview.
Do not interpret a successful staging deploy as permission to change Hostinger
nameservers, redirect the live domain, grant employee access, or retire Supabase.
