# Control-plane database flavors

SolZero ships two control-plane database flavors in one package. **D1 is the OSS default.** PlanetScale
Postgres is an optional paid path for operators who outgrow the 10 GB D1 limit.

Session messages, events, and artifacts stay in Durable Object sqlite. R2 and Cloudflare AI Search
stay on both flavors. A second database does not move chat.

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

`bun alchemy deploy` / `nub run infra:deploy:*` with no `DATABASE` value and no PlanetScale tokens
stays on D1.

- Binding: `DB`
- Runtime: `drizzle-orm/d1`
- Better Auth: native D1 (`database: env.DB`)
- Migrations: hand-written SQL in `packages/infra/d1-migrations/`

## PlanetScale Postgres (paid)

PlanetScale has no free plan. Budget about **$5/month** for a small cluster. Required only when
`DATABASE=planetscale` **and** `APP_DB_MODE=remote`.

Add these IaC credentials to `config/.env` for remote PlanetScale stages. Names match alchemy.new:

```sh
DATABASE=planetscale
PLANETSCALE_SERVICE_TOKEN_ID=
PLANETSCALE_SERVICE_TOKEN=
PLANETSCALE_ORGANIZATION=
```

Public CI stays secret-less. PGLite tests do not need these tokens.

Alchemy 2.0.0-beta.74 still reads `PLANETSCALE_API_TOKEN_ID` and `PLANETSCALE_API_TOKEN` internally.
The stack copies the service-token names into those Alchemy names only when the PlanetScale Layers
merge. Operators should set the service-token names.

Alchemy creates one Postgres cluster, admin and app roles, one logical database named `s0`, and a
Hyperdrive connection. The Worker binding is `APP_HYPERDRIVE`. Runtime uses Hyperdrive with
postgres.js for promise Drizzle and Better Auth, plus `@effect/sql-pg` for Effect-native paths. It
does not use `drizzle-orm/pglite` or Node `pg` inside the Worker. The D1 Worker graph does not load
the postgres client.

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

## What does not change

- Durable Object sqlite for session messages, events, and artifacts
- R2 buckets
- Cloudflare AI Search
- Alchemy `2.0.0-beta.74`, Effect `4.0.0-beta.107`, wrangler `4.116.0`, and better-auth `1.6.24`
