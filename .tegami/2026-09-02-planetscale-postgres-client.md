---
packages:
  "release:solzero": patch
---

## PlanetScale sign-in after a local or Hyperdrive boot

Credential sign-in and `/api/auth/config` now work when `DATABASE=planetscale`.
The Worker already created a postgres.js client for Hyperdrive; it then rejected
that client because postgres.js exposes a function, not a plain object. Auth
config returned 500 and the welcome form could not load.
