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
