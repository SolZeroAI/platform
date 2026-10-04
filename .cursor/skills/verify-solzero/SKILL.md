---
name: verify-solzero
description: Verify SolZero user flows with tester-army/e2e against the isolated local Alchemy stack. Use for sign-in, Agents, Workflows, Bots, Settings, API contracts, and integration regression checks.
---

# Verify SolZero

Read `.agents/skills/e2e/SKILL.md` and `docs/e2e.md` before running or extending verification. Automated tests use tester-army/e2e exclusively and live under `tests/**/*.e2e.ts`. The runner starts the real Alchemy development stack with isolated `s0-e2e` configuration, D1, Durable Objects, KV, R2, and disposable account credentials.

## Run

Use Node 24.15 and Nub 0.4.11. Docker must be running. Ports 3000 and 3100 are exclusive; the launcher refuses an existing stack. Coordinate with other projects before starting the suite.

```sh
nub install --frozen-lockfile
nub run test:e2e:install
E2E_ENV_FILE=/path/to/private.env nub run test
nub run test:e2e:live tests/auth.e2e.ts
nub run test:e2e:cache-strict
nub run test:e2e:list
```

The environment loader reads the selected private file, then `config/.env` and `config/.dev.vars`; existing environment values win. Supply the documented Cloudflare account, application, and Clef gateway credentials. Never print their values. The launcher creates a missing `.dev.vars` with mode 0600 and generates the isolated administrator password in an ignored file. Use the suite's registered secret handles for browser credential input.

`nub run test` runs core flows. `nub run test:e2e:all` includes external integrations and container harnesses; `nub run test:e2e:external` selects them. Read the fixture inventory in `docs/e2e.md` first. Missing integration credentials or linked identities are blockers, and collection alone does not establish coverage.

## Prove behavior

Drive the public UI and HTTP endpoints through the configured e2e browser and live fetch helpers. Cloudflare Clef (`@cf/cloudflare/clef`) through AI Gateway supplies semantic actions and visual assertions. Follow each action with an exact deterministic assertion. Use `expect` for waiting; this executor supports `act` and `assert` only.

Verify credential sign-in by reaching the authenticated UI; a healthy port is insufficient. A missing sign-in provider or `Sign-in is not configured for this deployment.` remains a product failure. Verify mutations through reload or a second user-facing view, including saved settings, bot/workflow records, session history, and authorization boundaries. Exercise real Cloudflare services and providers without interception, module mocks, or separate browser/test runners.

Read `.e2e/report.json`, `.e2e/summary.md`, failure evidence, and the ignored stack log. Distinguish live execution from strict replay and identify any unverified external flows. Raw network/browser traces are disabled because dynamically minted credentials cannot be registered for redaction by the published SDK. Retain sanitized screenshots and reports, keep secrets out of model observations, and leave credential displays before failure capture.

## Scope and cleanup

Use only the isolated e2e profile and disposable fixtures. Do not run `infra:deploy:*` or `db:copy-d1-to-planetscale` during verification. Preserve pinned Alchemy, Effect, Wrangler, and provider versions unless the requested fix requires a change. The e2e launcher owns process cleanup; stop only its recorded processes and preserve unrelated development stacks. Delete temporary integration fixtures and revoke minted tokens in `finally` blocks.

The previous `control-solzero` Chrome driver and its recipes were removed. Keep new regression cases in the shared e2e suite rather than rebuilding that driver.
