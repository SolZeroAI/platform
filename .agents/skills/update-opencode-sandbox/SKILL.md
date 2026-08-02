---
name: update-opencode-sandbox
description: Update OpenCode And Sandbox
disable-model-invocation: true
---

# Update OpenCode And Sandbox
Update the OpenCode integration and Cloudflare Sandbox stack, validate the result end to end, and keep this command current if the workflow changes.

## Start Here
- Start by checking current versions and API shapes before editing anything.
- Use `nub` for all Node dependency changes.
- Keep the npm package versions and sandbox image aligned when possible.
- If `@cloudflare/containers` changes, keep the root `patchedDependencies` entry and the matching `patches/@cloudflare__containers@<version>.patch` aligned with the installed version. As of `0.3.0`, the local no-body `Response` patch is still required.

## Files To Check
- Inspect and update these files first because they were changed in the last upgrade investigation:
- `package.json`
- `apps/api/package.json`
- `patches/@cloudflare__containers@*.patch`
- `packages/sandbox/Dockerfile`
- `nub.lock`
- `packages/api/src/server/background/sandbox/providers/cloudflare-provider.ts`
- `tests/integration/opencode-config-refresh.test.ts`
- `tests/e2e/opencode-workflow.test.ts`
- If the newer OpenCode or Sandbox SDK changes client method signatures or event formats, update `packages/api/src/server/background/sandbox/providers/cloudflare-provider.ts` to match the current SDK instead of preserving old call shapes.

## Validation
- Run and report the checks used during validation. Include these if they still apply:
- `nub exec tsc --noEmit -p tsconfig.json` (from repo root; uses root `tsconfig.json`)
- If the root typecheck still fails on unrelated workspace or test issues, also run `nub run --filter @c0/background-api typecheck` and report that result separately so the upgraded surface is still verified.
- If TypeScript reports incompatible `McpServer` types from two `@modelcontextprotocol/sdk` versions, align on a single version: root `package.json` → `overrides["@modelcontextprotocol/sdk"]` matching `apps/api`, then `nub install` and re-run `tsc`.
- `nub exec vitest run tests/e2e/opencode-workflow.test.ts` (or `nub run test:e2e` from root, which sets `RUN_E2E=1`)
- The OpenCode e2e now relies on the current internal auth flow: provide `INTERNAL_CALLBACK_SECRET` so the test can generate its own internal bearer token, or pass `INTERNAL_TOKEN` explicitly. Requests also need an acting `x-user-id`; the default local seeded user is `user-session-run` unless overridden.
- Optional: `nub exec vitest run tests/integration/opencode-config-refresh.test.ts` for OpenCode config wiring without a live Worker.
- `docker build -t sandbox-check ./packages/sandbox` to confirm the image still pulls `cloudflare/sandbox:<version>-opencode` and the derived image builds successfully. OpenCode is baked into the `-opencode` base image now; this repo's Dockerfile should only add repo-specific runtime dependencies such as provider packages.
- A live local repro that creates a session, sends a prompt, and inspects `/sessions/:id/events` for both `token` and `execution_complete`. A repo-less session is enough to verify the OpenCode workflow; repo-backed sessions additionally require a linked GitHub identity for the acting user.
- If the Vitest e2e is skipped or incomplete, say that explicitly and do not treat it as sufficient validation by itself.
- When restarting local dev for validation, confirm port `1337` is free first (on macOS, `lsof -i :1337` may show the service name `menandmice-dns` for that port).

## Environment Gotchas
- Watch for environment-related failures separately from product failures. Examples from the last investigation:
- TLS / certificate issues during `curl https://opencode.ai/install`
- Stale local servers on port `1337`
- Sandbox SDK version mismatches between the npm package and the container image

## Final Response
- In the final response, include:
- Exact files changed
- Exact tests and repro steps run
- Pass / fail status for each check
- Any remaining risks, blockers, or follow-up work

## Keep This Command Updated
- If you notice this command is outdated, incomplete, or obsolete while doing the task, update `.cursor/commands/update-opencode-sandbox.md` before you finish.
