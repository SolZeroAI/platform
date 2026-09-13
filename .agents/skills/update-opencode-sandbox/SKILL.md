---
name: update-opencode-sandbox
description: Update OpenCode And Sandbox
disable-model-invocation: true
---

# Update OpenCode And Sandbox
Update the OpenCode harness and Cloudflare Containers agent-container stack, validate the result end to end, and keep this skill current if the workflow changes.

## Start Here
- Start by checking current versions and API shapes before editing anything.
- Use `nub` for all Node dependency changes.
- Keep the npm package versions and the agent-container image aligned when possible.
- If `@cloudflare/containers` changes, keep the root `patchedDependencies` entry and the matching `patches/@cloudflare__containers@<version>.patch` aligned with the installed version. As of `0.3.7`, the local patch is still required.

## Files To Check
- Inspect and update these files first because they own the live OpenCode path:
- `package.json`
- `apps/api/package.json` (`@solzero/background-api`)
- `packages/api/package.json` (`@solzero/api`)
- `packages/agent-container/package.json` (`@solzero/agent-container`)
- `patches/@cloudflare__containers@*.patch`
- `packages/agent-container/Dockerfile`
- `packages/agent-container/src/opencode.ts`
- `packages/agent-container/src/harness-runtime.ts`
- `nub.lock`
- `packages/api/src/server/background/sandbox/providers/harness-container-provider.ts`
- `apps/api/infra/resources.ts` (`AGENT_CONTAINER_EXTERNAL_PACKAGES`, container application build)
- `tests/e2e/opencode-workflow.test.ts`
- `tests/integration/harness-container-provider.test.ts`
- `tests/integration/agent-container-entrypoints.test.ts`
- If the newer OpenCode harness or Containers SDK changes client method signatures or event formats, update `packages/api/src/server/background/sandbox/providers/harness-container-provider.ts` and `packages/agent-container/src/harness-runtime.ts` to match the current SDK instead of preserving old call shapes.

## Validation
- Run and report the checks used during validation. Include these if they still apply:
- `nub run typecheck`
- `nub run lint`
- `nub run format`
- If a repo-root check still fails on unrelated workspace or test issues, also run `nub run --filter @solzero/background-api typecheck`, `nub run --filter @solzero/api typecheck`, and `nub run --filter @solzero/agent-container typecheck` and report those results separately so the upgraded surface is still verified.
- If TypeScript reports incompatible `McpServer` types from two `@modelcontextprotocol/sdk` versions, align on a single version: root `package.json` → `overrides["@modelcontextprotocol/sdk"]` matching `packages/api` and `packages/agent-container`, then `nub install` and re-run `tsc`.
- `nub exec vitest run tests/e2e/opencode-workflow.test.ts` (or `nub run test:e2e` from root, which sets `RUN_E2E=1`)
- The OpenCode e2e uses the current API-key auth flow: set `S0_API_KEY`. Requests send `x-api-key`. The default local seeded user is `user-session-run` unless `E2E_USER_ID` is set. The API base URL defaults to `http://localhost:1337` unless `BACKGROUND_BASE_URL` is set.
- Optional: `nub exec vitest run tests/integration/harness-container-provider.test.ts tests/integration/agent-container-entrypoints.test.ts` for provider and bundle wiring without a live Worker.
- `docker build -t agent-container-check ./packages/agent-container` to confirm the image still installs `@ai-sdk/harness-opencode` and the derived image builds successfully. OpenCode is a harness package in this image, not a `cloudflare/sandbox-opencode` base.
- A live local repro that creates a session with `agentRuntime: "opencode"`, sends a prompt, and inspects `/sessions/:id/events` for both `token` and `execution_complete`. A repo-less session is enough to verify the OpenCode workflow; repo-backed sessions additionally require a linked GitHub identity for the acting user.
- If the Vitest e2e is skipped or incomplete, say that explicitly and do not treat it as sufficient validation by itself.
- When restarting local dev for validation, confirm port `1337` is free first (on macOS, `lsof -i :1337` may show the service name `menandmice-dns` for that port).

## Environment Gotchas
- Watch for environment-related failures separately from product failures. Examples from the last investigation:
- Stale local servers on port `1337`
- Harness package version mismatches between npm and the container image

## Final Response
- In the final response, include:
- Exact files changed
- Exact tests and repro steps run
- Pass / fail status for each check
- Any remaining risks, blockers, or follow-up work

## Keep This Skill Updated
- If you notice this skill is outdated, incomplete, or obsolete while doing the task, update `.agents/skills/update-opencode-sandbox/SKILL.md` before you finish.
