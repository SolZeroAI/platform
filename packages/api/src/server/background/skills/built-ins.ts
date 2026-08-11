export const S0_CREATE_PR_SKILL_ID = "skill_s0_create_pr"

export const S0_CREATE_PR_SKILL_MD = `---
name: s0-create-pr
description: Create a GitHub pull request from a SolZero-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.
---

# Create a pull request

1. Verify that the current workspace is a Git repository and that \`s0-create-pr\` is available.
2. Inspect the current branch, status, and diff. Never push directly to the repository's default branch.
3. Run the relevant validation and commit the requested changes if they are not already committed.
4. Run \`s0-create-pr "PR title" "PR body"\`. The helper pushes the current SolZero-managed branch and opens the pull request against the configured base branch.
5. Report the pull request URL. If the helper is unavailable or fails, report the exact actionable error instead of attempting an alternate credential flow.
`
