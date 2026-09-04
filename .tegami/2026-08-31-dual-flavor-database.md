---
packages:
  "release:solzero": minor
---

## Optional PlanetScale control-plane database

SolZero now ships two control-plane database flavors in one package. Cloudflare D1 remains the
default when `DATABASE` is omitted. Operators who outgrow the 10 GB D1 limit can set
`DATABASE=planetscale`. That path needs `PLANETSCALE_SERVICE_TOKEN_ID`,
`PLANETSCALE_SERVICE_TOKEN`, and `PLANETSCALE_ORGANIZATION` for remote PlanetScale. Session chat,
Durable Object sqlite, R2, and Cloudflare AI Search stay on both flavors. PlanetScale is a paid
service with no free plan and is not a deployment provider.

## One-shot D1 to PlanetScale copy

Operators can copy control-plane rows from a D1 dump into PlanetScale with
`nub run db:copy-d1-to-planetscale`. This is a convenience copy, not an online
migration. Production stays on D1 until the operator deploys. The default
dry-run prints the jsonc and env edits for `DATABASE=planetscale` and writes
nothing.

## Better Auth email verification on PlanetScale

PlanetScale stores Better Auth `emailVerified` as a boolean so the postgres
adapter can write true and false.

## Popular secret tag order on PlanetScale

Popular secret tags now sort by numeric count on PlanetScale. A tag used ten
times ranks above a tag used twice.
