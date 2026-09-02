---
packages:
  "release:solzero": patch
---

## Local admin password matches the running Worker

`nub run auth:admin-password -- dev --local` now reads the same local Alchemy
state the Worker uses. After local disk state became the default for `dev`,
the helper still read Cloudflare state, so the printed password did not sign
in.
