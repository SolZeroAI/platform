---
packages:
  "release:solzero": patch
---

## Deploy with Alchemy 2.0.0-beta.84 and Effect 4.0.5

Deploys use Alchemy 2.0.0-beta.84 with its `@alchemy.run/cloudflare` and `@alchemy.run/planetscale` provider packages, and Effect 4.0.5. Operator deploys no longer apply `patches/alchemy@2.0.0-beta.81.patch`.

`alchemy-planetscale-logical-db` 2.1.0 still imports the old `alchemy/Planetscale` path. A patch maps that import to `@alchemy.run/planetscale` until a fixed release is published.
