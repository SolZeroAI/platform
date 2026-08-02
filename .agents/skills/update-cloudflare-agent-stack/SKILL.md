---
name: update-cloudflare-agent-stack
description: "Review and upgrade c0's Cloudflare agent stack packages: agents, @cloudflare/think, @cloudflare/codemode, and @cloudflare/shell. Use when asked to update, audit, modernize, or plan upgrades for the Agents SDK, Think, Code Mode, Shell, agent runtime, @callable usage, Agent Skills, MCP agent support, or related Cloudflare agent libraries in this repo."
---

# Update Cloudflare Agent Stack

Review version and API changes before editing. Start with an executive summary and recommended update path, then implement only after the user asks to proceed.

## Scope

Primary packages:

- `agents`
- `@cloudflare/think`
- `@cloudflare/codemode`
- `@cloudflare/shell`

Also inspect dependent or peer packages when the upgrade requires it:

- `ai`
- `chat`
- `@modelcontextprotocol/sdk`
- `@cloudflare/sandbox`
- `@cloudflare/dynamic-workflows`
- `@cloudflare/containers`

## Start With Evidence

1. Read the current package usage in:
   - `apps/api/package.json`
   - `packages/api/package.json`
   - `packages/sandbox/Dockerfile`
   - `nub.lock`
   - `packages/api/src/server/background/isolate/agent.ts`
   - `packages/api/src/server/background/isolate/runtime.ts`
   - `packages/api/src/server/background/isolate/mcp.ts`
   - `packages/api/src/server/mcp/**/*.ts`
2. Query installed and latest versions with `nub`, `npm view`, and lockfile inspection.
3. Fetch current upstream docs and release notes before making claims:
   - Cloudflare Agents docs: `https://developers.cloudflare.com/agents/`
   - Cloudflare Agents changelog: `https://developers.cloudflare.com/changelog/product/agents/`
   - GitHub source/release notes for `cloudflare/agents`
   - npm metadata for each package
4. Inspect the installed and latest package tarballs when release notes are incomplete:
   - `npm pack agents@<version>`
   - `npm pack @cloudflare/think@<version>`
   - `npm pack @cloudflare/codemode@<version>`
   - `npm pack @cloudflare/shell@<version>`
5. Compare exported types and runtime entrypoints before deciding whether code changes are benign or require refactors.

## Report Before Updating

Before editing package versions, respond with:

- Current versions and latest versions.
- Relevant release-note highlights between those versions.
- Breaking or risky API differences found by source/tarball inspection.
- Repo surfaces affected.
- Recommended path, choosing one:
  - **Conservative bump**: minimal package updates and compatibility fixes.
  - **Targeted refactor**: remove or simplify c0 custom code that the newer library replaces.
  - **Larger modernization**: adopt new library features such as Agent Skills, newer MCP helpers, scheduling, resumable streaming, or changed Think runtime patterns.
- Validation plan and known risks.

Do not treat release-note summaries as sufficient when c0 uses internals or experimental APIs. Read source/types for those surfaces.

## Implementation Rules

- Work on a separate branch for this upgrade, normally `codex/update-cloudflare-agent-stack`, unless the user requests a different branch name.
- Use `nub` for dependency changes.
- Keep package versions aligned where peer ranges imply a stack upgrade.
- Prefer deleting obsolete c0 glue code over preserving compatibility shims when the new library has an idiomatic replacement.
- Reassess `@callable()` and `agents/vite` usage. `@callable()` is for external Agent RPC; same-worker Durable Object RPC should not need the decorators or Agents Vite plugin.
- If `agents/vite` is still required, confirm whether it returns a single plugin or a plugin array in the target version, and wire it without nested plugin arrays.
- If package upgrades change MCP server/client APIs, update c0's MCP handlers and isolate MCP manager integration against current types.
- If `@cloudflare/shell` or sandbox-facing packages change workspace, git, filesystem, or process APIs, update the runtime provider code rather than adapting with broad casts.
- If `@cloudflare/codemode` changes agent/tool interfaces, update Code Mode integration and tests around the new contracts.

## Validation

Run the repo's required checks before handoff:

- `nub run typecheck`
- `nub run lint`
- `nub run format`

Run focused checks based on changed surfaces:

- `nub run --filter @c0/background-api typecheck`
- `nub run --filter @c0/api typecheck`
- `nub run test:alchemy`
- Relevant MCP, isolate, workflow, sandbox, or e2e tests if touched.

If a validation command fails because of an unrelated pre-existing issue, run the narrowest check that still validates the upgraded surface and report both results.

## Final Response

Include:

- Packages updated and exact version movement.
- Release-note/API changes that mattered.
- Files changed.
- Tests run with pass/fail status.
- Remaining risks or follow-up refactors.

Keep the final concise, but include enough evidence that the user can judge whether the upgrade was conservative or modernization-oriented.
