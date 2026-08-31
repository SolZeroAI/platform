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
