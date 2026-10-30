---
name: verify-solzero
description: Verify SolZero user flows with tester-army/e2e against the isolated local Alchemy stack. Use for sign-in, Agents, Workflows, Bots, Settings, API contracts, and integration regression checks.
---

# Verify SolZero

Read `.agents/skills/e2e/SKILL.md`, `docs/e2e.md`, and [`features/README.md`](features/README.md) before running or extending verification. The `features/` directory is the coverage map: one file per user-facing area, each linking to its canonical `tests/**/*.e2e.ts` suite(s). Automated tests use tester-army/e2e exclusively. The runner starts the real Alchemy development stack with isolated `s0-e2e` configuration, D1, Durable Objects, KV, R2, and disposable account credentials.

Use Nub for every install and verify command (`nub install`, `nub run test`, `nub run test:e2e`, `nub exec e2e ...`). This skill is a thin runbook over tester-army/e2e; do not restore a custom Chrome driver.

## Run

Use Node 24.15 and Nub 0.9.6. Docker must be running. Ports 3000 and 3100 are exclusive; the launcher refuses an existing stack. Coordinate with other projects before starting the suite.

```sh
nub install --frozen-lockfile
nub run test:e2e:install
E2E_ENV_FILE=/path/to/private.env nub run test
nub run test:e2e:live tests/auth.e2e.ts
nub run test:e2e:cache-strict
nub run test:e2e:list
```

Select the tests a change can affect before a full run. `e2e.config.ts` registers `decisionFilter` with the decision model from `scripts/e2e/models.ts` (default Cloudflare Clef) on the account's existing default AI Gateway. The filter runs only with `--changed-since`. `e2e list` prints the selection and does not boot the app. A change to the loaded config file, a file named like an e2e config, or a known lockfile keeps every test and does not call the model.

```sh
nub exec e2e list --changed-since origin/master
nub run test:e2e -- --changed-since origin/master
```

The environment loader reads the selected private file, then `config/.env` and `config/.dev.vars`; existing environment values win. Supply `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN`. The launcher boots local `alchemy dev` and does not read `CLOUDFLARE_API_TOKEN`. Never print credential values. The launcher creates its owned run’s `.dev.vars` with mode 0600 and generates the isolated administrator password in an ignored file. Use the suite's registered secret handles for browser credential input.

`nub run test` runs core flows, including Isolate, OpenCode, and Codex prompts against the mock `AiGateway` layer, which echoes the user message. `nub run test:e2e:all` adds the deferred external integrations and Claude Code; `nub run test:e2e:external` selects only those deferred cases. Focus one area with `nub run test:e2e -- tests/<file>.e2e.ts` after reading its feature file under `features/`. Read External fixture preflight in `docs/e2e.md` before deferred suites. Missing integration credentials or linked identities are blockers, and collection alone does not establish coverage.

## Prove behavior

Drive the public UI and HTTP endpoints through the configured e2e browser and live fetch helpers. The stack is local `alchemy dev` (Miniflare D1, KV, R2, and Durable Objects). `decisionExecutor` asks the decision model (default Cloudflare Clef) through the account's existing default AI Gateway for semantic actions and assertions, and the language model (default `anthropic/claude-haiku-5.5`) for `waitFor` and `extract`. The application does not receive that token. Follow each action with an exact deterministic assertion. Use `expect` for waiting.

Verify credential sign-in by reaching the authenticated UI; a healthy port is insufficient. A missing sign-in provider or `Sign-in is not configured for this deployment.` remains a product failure. Verify mutations through reload or a second user-facing view, including saved settings, bot/workflow records, session history, and authorization boundaries. Exercise real Cloudflare services and providers without interception, module mocks, or separate browser/test runners.

Read `.e2e/report.json`, `.e2e/summary.md`, failure evidence, and the ignored stack log. Distinguish live execution from strict replay and identify any unverified external flows. Raw network/browser traces are disabled because dynamically minted credentials cannot be registered for redaction by the published SDK. Retain sanitized screenshots and reports, keep secrets out of model observations, and leave credential displays before failure capture.

Cloud-agent proof follows [Cloud-agent PR artifacts](../../../AGENTS.md#cloud-agent-pr-artifacts). Evidence output survives cleanup in `.e2e/artifacts`.

## Scope and cleanup

Use only the isolated e2e profile and disposable fixtures. Do not run `infra:deploy:*` or `db:copy-d1-to-planetscale` during verification. Preserve pinned Alchemy, Effect, Wrangler, and provider versions unless the requested fix requires a change. The e2e launcher owns process cleanup; preserve unrelated development stacks. Delete temporary integration fixtures and revoke minted tokens in `finally` blocks.

When e2e stops the app target, the target stops `alchemy dev`, removes the run's labelled Docker containers and images, and removes `.e2e/runs/<UUID>/`. It never calls the Cloudflare API. Preserve the replay cache, the shared `default` gateway, and unrelated resources. Runs are local only, so there is no recovery command; after a SIGKILL, stop leftover processes by hand. See `docs/e2e.md` for remote preview limitations.

The previous `control-solzero` Chrome driver and its recipes were removed. Keep new regression cases in the shared e2e suite rather than rebuilding that driver.
