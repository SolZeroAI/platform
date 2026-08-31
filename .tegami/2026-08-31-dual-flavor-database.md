---
packages:
  "release:solzero": minor
---

## Optional PlanetScale control-plane database

SolZero now ships two control-plane database flavors in one package. Cloudflare D1 remains the
default and needs no PlanetScale credentials. Operators who outgrow the 10 GB D1 limit can select
PlanetScale Postgres in the stage config. Session chat, Durable Object sqlite, R2, and Cloudflare
AI Search stay on both flavors. PlanetScale is a paid service with no free plan.
