# Control-plane database flavors

SolZero ships two control-plane database flavors in one package. **D1 is the OSS default.** PlanetScale
Postgres is an optional paid path for operators who outgrow the 10 GB D1 limit.

Session messages, events, and artifacts stay in Durable Object sqlite. R2 and Cloudflare AI Search
stay on both flavors. A second database does not move chat.

## Shared Project DNA exception

The SolZero Shared Project DNA keeps platform on Cloudflare D1. The optional PlanetScale Postgres
flavor is an accepted, permanent exception to that rule (decided 2026-10-27).

- Keep D1 as the default for every stage, PR preview, and test run.
- Keep the Postgres flavor working. Do not remove it in a cleanup, and do not file a ticket to move
  platform to PlanetScale.
- A change to a control-plane table must update both Drizzle schemas (`schema.ts` and `schema.pg.ts`
  in `packages/api/src/server/effect/db/`) and both migration trees:
  `packages/infra/d1-migrations/` and `packages/infra/migrations/pg/`.
- Do not copy the Postgres flavor into other SolZero repositories. Janus uses shared PlanetScale through
  `alchemy-planetscale-logical-db`; alchemy.new stays on D1.

## Select a flavor

Set process env `DATABASE`. This is the alchemy.new select parameter. Do not invent
`DATABASE_ENGINE`. Do not use `APP_DB_MODE` as the sqlite-vs-postgres switch.

| Value | Meaning |
| --- | --- |
| omitted, empty, or `d1` | Cloudflare D1 + sqlite. Existing `packages/infra/d1-migrations/` SQL. No PlanetScale tokens. |
| `planetscale` | PlanetScale Postgres + Hyperdrive. Postgres Drizzle schema and `packages/infra/migrations/pg`. |

`deployment.providers` stays Cloudflare only. PlanetScale is an implementation path, not a cloud
provider.

This repository does not edit the SolZeroAI/alchemy.new repo. Consume alchemy.new pull request 39
as-is: `DATABASE` is `d1` or `planetscale`, default `d1`.

The Worker binding is also `DATABASE`.

## D1 default

`nub run infra:deploy:*` with no `DATABASE` value and no PlanetScale tokens
stays on D1.

- Binding: `DB`
- Runtime: `drizzle-orm/d1`
- Better Auth: native D1 (`database: env.DB`)
- Migrations: hand-written SQL in `packages/infra/d1-migrations/`

## PlanetScale Postgres (paid)

PlanetScale is a paid service. Provisioning credentials are required only when
`DATABASE=planetscale` **and** `APP_DB_MODE=remote`.

Add these IaC credentials to `config/.env` for remote PlanetScale stages. Names match alchemy.new:

```sh
DATABASE=planetscale
PLANETSCALE_SERVICE_TOKEN_ID=
PLANETSCALE_SERVICE_TOKEN=
PLANETSCALE_ORGANIZATION=
```

Public CI stays secret-less. PGLite tests do not need these tokens.

Alchemy reads `PLANETSCALE_API_TOKEN_ID` and `PLANETSCALE_API_TOKEN` internally.
The stack copies the service-token names into those Alchemy names only when the PlanetScale Layers
merge. Operators should set the service-token names.

Alchemy creates one Postgres cluster, admin and app roles, one logical database (default `s0`), and a
Hyperdrive connection. The Worker binding is `APP_HYPERDRIVE`. Runtime uses Hyperdrive with
postgres.js for promise Drizzle and Better Auth, plus `@effect/sql-pg` for Effect-native paths. It
does not use `drizzle-orm/pglite` or Node `pg` inside the Worker. The D1 Worker graph does not load
the postgres client.

Configure capacity, region and logical name through `deployment.planetscale`; see
[customization](customization.md#planetscale-provisioning).

### `APP_DB_MODE` (postgres flavor only)

| Value | Meaning |
| --- | --- |
| `local` | PGLite via pglite-socket as the Hyperdrive `dev` origin. Default for Alchemy dev and the `test` stage. |
| `remote` | PlanetScale origin on port **6432**. Default for pre and prod. |

Local Hyperdrive origin URL:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/postgres
```

Port **15432** is the single local PGLite port for this repository. Start it with:

```sh
nub run db:pglite
```

Then run `nub run dev` with `DATABASE=planetscale`. Leave `APP_DB_MODE=local` (or omit it in Alchemy
dev). Local PGLite does not need PlanetScale service tokens.

Generate or inspect postgres migrations with:

```sh
nub run db:generate:pg
```

D1 hand SQL is not applied to postgres. The postgres tree starts at
`packages/infra/migrations/pg/0000_control_plane.sql`.

## Copy D1 to PlanetScale (one-shot convenience CLI)

This is **not** an online or zero-downtime migration. The operator copies
control-plane rows once from a D1 dump, then deploys. Production stays on D1
until cutover. Freeze writes and drain work before the final export. Keep the destination offline
until independent verification and cutover checks pass.

The first-party path is a typed Effect CLI that reuses the same Drizzle schemas
and `DATABASE` contract as the app. Control-plane tables only. It does not copy
Durable Object sqlite, R2, or AI Search.

```sh
# Export the operator D1 database (sqlite dump or SQL).
wrangler d1 export <D1_NAME> --output ./d1-export.sql --remote

# Supply DATABASE_URL securely through the environment, not command-line arguments.
# Default: plan only, bounded reads, no destination writes.
nub run db:copy-d1-to-planetscale -- --source-sqlite ./d1-export.sql

# Write the copy. Deploy yourself after it succeeds.
nub run db:copy-d1-to-planetscale -- --apply --source-writes-frozen --source-sqlite ./d1-export.sql

# Independently re-read all keys, counts and checksums.
nub run db:copy-d1-to-planetscale -- --verify-only --source-sqlite ./d1-export.sql
```

After copy succeeds, set process env `DATABASE=planetscale` before the next
deploy. Missing or empty `DATABASE` stays `d1`. Do not add a second engine
field to jsonc. For remote PlanetScale also set `PLANETSCALE_SERVICE_TOKEN_ID`,
`PLANETSCALE_SERVICE_TOKEN`, and `PLANETSCALE_ORGANIZATION`. The dry-run prints
that jsonc and env diff. It never rewrites the live jsonc and never deploys.

`--apply` verifies inside a serializable transaction, then re-reads after commit. Reports contain actual
counts and checksums, not row data or secret values. `--batch-size` is bounded to 1–500 rows. Unknown
source tables/columns, unrelated destination rows, duplicate built-ins and changed destination seeds
fail closed. Missing tables in older sources are listed explicitly and must have no destination rows.
Only the untouched canonical PR skill seed can be reconciled to its legacy identity; existing IDs and
preferences remain intact. Conflicting rows require a fresh destination or explicit `--overwrite`.

The selected profile determines the default prod JSONC path; use `--config` for a different stage.
Printed cutover diffs omit secret values and unrelated assignments. Optional `--patch-out` files are
created exclusively with mode 0600 and never rewrite deployment files. See [offline migration](migration.md)
for portable-state transfers, source inventory requirements and rollback limits. Relational copy alone
is not a cutover gate.

## What does not change

- Durable Object sqlite for session messages, events, and artifacts
- R2 buckets
- Cloudflare AI Search
- Alchemy `2.0.0-beta.81`, Effect `4.0.3`, wrangler `4.149.0`, and better-auth `1.7.7`
