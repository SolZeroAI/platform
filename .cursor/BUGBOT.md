# Bugbot review contract

## What this file is

This file tells you what is intended on SolZeroAI/platform and what is a regression.
You include this root file on every review.
Do not expect nested `.cursor/BUGBOT.md` copies under packages.
Cursor project rules in `.cursor/rules` do not apply to you.
The repo is public at https://github.com/SolZeroAI/platform.
The license is LGPL-3.0-only.

## Review posture

You flag real regressions.
You do not flag intended locks.
Locks below are the intended DNA of this repo.
Do not recommend changing a lock.
Do not recommend Clerk.
Do not recommend Effect 3.x.
Do not recommend moving the default control plane off Cloudflare D1.

The dual-flavor contract below is a lock even when `docs/database.md` is absent.
Absence of that doc is not a bug.
D1 remains the OSS default when PlanetScale code is not on the branch.

## Locks you treat as intended

### Control-plane database

Cloudflare D1 is the OSS default control plane.
The Worker binding is `DB`.
The runtime adapter is `drizzle-orm/d1` through `makeD1Drizzle` in `packages/api/src/server/effect/db/d1-drizzle.ts`.
Better Auth uses native D1.
`createBetterAuth` in `packages/api/src/server/lib/better-auth.ts` sets `database: env.DB`.

PlanetScale Postgres is optional.
The switch is process env `DATABASE=planetscale`.
When `DATABASE` is missing or empty, the flavor is `d1`.
Do not invent `DATABASE_ENGINE`.
`APP_DB_MODE` selects local PGLite or remote PlanetScale on the postgres flavor only.
`APP_DB_MODE` is not the sqlite-versus-postgres switch.

Do not recommend moving the default to PlanetScale.
`deployment.providers` stays Cloudflare only.
PlanetScale is an implementation path, not a cloud provider.

Numbered hand SQL lives in `packages/infra/d1-migrations/`.
`createAgentResources` in `apps/api/infra/resources.ts` constructs Alchemy `Cloudflare.D1.Database("db", { name, migrations })`.
The `migrations` field is the directory path.
`createS0Api` resolves that path to `packages/infra/d1-migrations`.

The Worker D1 path is query-only.
`makeD1Drizzle` wraps the binding.
There is no `ensureD1Schema`.
There is no Worker apply-on-read.
There is no Drizzle.Schema apply.
Absence of those is intended.
Do not flag that absence.

Tests apply the numbered SQL in-process with `node:sqlite` `DatabaseSync`.
That path starts in `tests/integration/d1-migrations.test.ts` and other store tests.
That is the test apply path.
That is not a Worker apply path.

Session chat, events, and artifacts stay in Durable Object sqlite.
D1 holds the control-plane index.
Durable Object sqlite holds the chat body.
Schema SQL lives in `SCHEMA_SQL` in `packages/api/src/server/background/session/schema.ts`.
D1 holds auth users, sessions, accounts, the session index, workflows, bots, secrets metadata, and the MCP registry.
A second database must not move chat.

When a copy CLI exists as `nub run db:copy-d1-to-planetscale`, dry-run is the default.
That CLI must not rewrite live stage jsonc such as `config/prod.config.jsonc`.
That CLI must not call `infra:deploy:*`.
`.cursor/skills/verify-solzero/SKILL.md` mentions the CLI and forbids running it during verification.

### Better Auth

Stay on better-auth.
Credential Better Auth is the local welcome path.
Stage JSONC in `config/dev.config.jsonc` and the other stage files sets `auth.defaultSignInProviderId` to `"credential"`.
The credential provider is enabled.

Welcome UI is `SignInPage` in `apps/web/src/routes/_authenticated.tsx`.
There is no `/login` route.
Signed-out `/` shows Email, Password, `#admin-email`, `#admin-password`, and Sign In.

The exact product-failure copy is `Sign-in is not configured for this deployment.`
That copy renders when `signInProviders.length === 0`.
It is a product failure.
It is not a mapped empty state.

`.cursor/skills/verify-solzero/SKILL.md` and `.cursor/skills/verify-solzero/features/sign-in.md` require doctor to fail closed.
When `GET /api/auth/config` does not return a credential sign-in provider, doctor fails.
Health-only ready is not enough.
Do not paper over this in verify-solzero.

`GET /api/auth/config` and `/api/auth/*` in `apps/api/index.ts` call `createBetterAuth`.
Credential sign-in is rate-limited.
Public credential signup and password lifecycle paths are forbidden.
`DISABLED_CREDENTIAL_PATHS` in `packages/api/src/server/lib/better-auth.ts` lists those paths.
That block is intended.

The session cookie in tests is `better-auth.session_token`.
`BETTER_AUTH_SECRET` is required outside local development.
Local `dev` may fall back to `better-auth-dev-secret-change-me`.

### Alchemy state

`stackState()` in `packages/infra/src/stack.ts` reads `metadata.infra.alchemyStateStore`.
`"local"` matches `localState()`.
`"cloudflare"` matches `Cloudflare.state()`.
Local stage metadata defaults `alchemyStateStore` to `"local"` in `packages/shared/src/stageMetadata.ts`.
Deployed stages default to `"cloudflare"`.
Local stages write Alchemy state to disk under `.alchemy/` because `alchemyStateStore` defaults to `"local"`.
pre and prod use `Cloudflare.state()`.
Do not flag this split as inconsistent state management.

### Public OSS and GitHub Actions

This public repo must not gain GitHub Actions that publish preview or prod.
`nub run infra:deploy:pre`, `infra:deploy:prod`, and `github:sync-env-secrets` stay scripts.
They are not GHA Environments on SolZeroAI/platform.

`.github/workflows/deploy.yml` and `.github/workflows/preview.yml` are copyable templates.
Invert guards are `github.repository != 'SolZeroAI/platform'`.
Comments say do not add secrets on SolZeroAI/platform.
Keep the YAML valid.
Do not comment the workflows out.
The public repo disables preview with `gh workflow disable preview.yml`.

`.github/workflows/validate.yml` runs secret-less `config:check`, `typecheck`, `lint`, `format`, and actionlint on this public repo.
`nub run test` and `nub run build` are skipped when `github.repository != 'SolZeroAI/platform'`.
Those jobs need Cloudflare tokens.

`.github/workflows/release.yml` runs Tegami version and release after Validate on master push.
That job writes GitHub Release notes.
That job is not a Cloudflare deploy.

`docs/releasing.md` and `CONTRIBUTING.md` state the same invert-guard policy.

### Tests

`s0-lint/no-colocated-tests` lives in `packages/s0-lint/src/rules.ts` and `packages/s0-lint/src/messages.ts`.
`*.test.*` and `*.spec.*` must live under `test`, `tests`, or `__tests__`.
AGENTS.md puts web tests under `apps/web/tests`.
Cross-package suites live under root `tests/<suite>`.
Current suites are `tests/integration`, `tests/infra`, `tests/workflows`, `tests/api`, and `tests/e2e`.
Package-local suites are `packages/api/test` and `packages/s0-lint/tests`.

### Stack versions

Master uses Cloudflare Workers, Durable Objects, D1, KV, and R2.
Pinned versions on this master:

- Effect `4.0.0-beta.107`
- Alchemy `2.0.0-beta.74`
- better-auth `1.6.24`
- wrangler `4.116.0`
- drizzle-orm `1.0.0-rc.5-ab785fc` as a D1 query adapter only

There is no Clerk.
Do not recommend Clerk.
Do not recommend Effect 3.x.
Do not bump Alchemy, Effect, Wrangler, Better Auth, or `ai`/`chat` pins in drive-by PRs.

Docs-only and no user-visible change uses pull request label `release:none`.
Do not edit `VERSION`, `CHANGELOG.md`, or `.tegami/publish-lock.yaml` on a feature branch.

### Observability

Server-side telemetry uses Effect logs, spans, and `createApiRequestObserver` in `packages/api/src/server/effect/services/observability.ts`.
The request-scoped Effect logger is `EffectRequestLogger`.
Prefer that logger over raw `console.*` on the Worker.
Do not add ad hoc local-only debug endpoints.

Never log bearer tokens, refresh tokens, authorization headers, cookies, or raw custom MCP server definitions.
Log names, ids, counts, and boolean flags.

Local logs go to the console logger.
Deployed pre and prod export through Cloudflare Worker Observability destinations in `stageMetadata.infra`.

verify-solzero is not a place to hide product failures.
Do not run `nub run infra:deploy:*` or `db:copy-d1-to-planetscale` from that skill during verification.

## Flag these

### Auth and sessions

Flag auth or session breakage.
Flag a cookie or trusted-origin change that breaks sign-in.
When config still has credential and the credential form is gone, flag it.
When public signup is re-enabled, flag it.
When session lookup hits the wrong store, flag it.
When `DISABLED_CREDENTIAL_PATHS` is weakened, flag it.
When `Sign-in is not configured for this deployment.` is mapped as a success or empty state, flag it.

### Database flavors and migrations

When a PR loads Node `pg` into the D1 Worker graph, flag it.
When a PR requires `PLANETSCALE_SERVICE_TOKEN_*` on the D1 default, flag it.
When a PR applies D1 SQL to postgres, flag it.
When a PR applies postgres SQL to D1, flag it.
When a PR invents `DATABASE_ENGINE`, flag it.
When a PR moves chat out of Durable Object sqlite, flag it.
When numbered D1 migrations are broken or untested, flag it.
When Durable Object sqlite schema changes without a matching apply story in `SCHEMA_SQL`, flag it.
When the copy CLI rewrites `config/prod.config.jsonc`, flag it.
When the copy CLI calls `infra:deploy:*`, flag it.

### Secrets and deploy

Flag secret leakage in source, logs, or public GHA.
When a PR removes invert guards, flag it.
When a PR adds deploy secrets to SolZeroAI/platform, flag it.
When preview or deploy jobs would run on this public repository, flag it.

### Tests and verify-solzero

Flag colocated tests.
When a behavior change has no tests in `test`, `tests`, or `__tests__`, flag it.
When verify-solzero papers over a product failure, flag it.
When verify-solzero treats health-only ready as enough for sign-in, flag it.
When a PR recommends Clerk, Effect 3.x, or moving the default control plane off D1, flag it.

## Paths that often confuse reviewers

`packages/api/src/server/effect/db/d1-drizzle.ts` is the D1 query wrapper.
`packages/api/src/server/lib/better-auth.ts` is Better Auth on native D1.
`packages/infra/d1-migrations/` is numbered hand SQL for D1.
`packages/api/src/server/background/session/schema.ts` is Durable Object sqlite `SCHEMA_SQL`.
`apps/api/infra/resources.ts` is the Alchemy D1 apply path.
`tests/integration/d1-migrations.test.ts` is the test apply path.
`packages/infra/src/stack.ts` is `stackState()`.
`packages/shared/src/stageMetadata.ts` is local versus deployed `alchemyStateStore`.
`apps/web/src/routes/_authenticated.tsx` is `SignInPage`.
`.github/workflows/deploy.yml` and `.github/workflows/preview.yml` are invert-guarded templates.
`.github/workflows/validate.yml` is the secret-less public CI.
`.github/workflows/release.yml` is Tegami notes, not a Cloudflare deploy.
`.cursor/skills/verify-solzero/SKILL.md` must not hide product failures.
