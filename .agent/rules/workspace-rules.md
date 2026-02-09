# Workspace Rules - Git Operations

All git operations in this workspace (staging, committing, and pushing changes) MUST follow the logic and conventions defined in the `@git-pushing` skill.

## Required Workflow
1. Use the `@git-pushing` skill for any request related to saving, committing, or pushing code.
2. Follow the conventional commit format specified in the skill.
3. Use the smart commit script located at `.agent/skills/skills/git-pushing/scripts/smart_commit.sh` whenever possible (or its direct Git command equivalent if shell access is limited).

Failure to use the `@git-pushing` workflow for commits and pushes is prohibited for this workspace.
