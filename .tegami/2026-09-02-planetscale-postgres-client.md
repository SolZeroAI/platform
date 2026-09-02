---
packages:
  "release:solzero": patch
---

## PlanetScale sign-in after a local or Hyperdrive boot

Credential sign-in and `/api/auth/config` now work when `DATABASE=planetscale`.
The Worker already created a postgres.js client for Hyperdrive; it then rejected
that client because postgres.js exposes a function, not a plain object. Auth
config returned 500 and the welcome form could not load.

The Worker also kept that Hyperdrive client on the isolate `env` object and
reused it on the next request. Cloudflare Workers reject that I/O reuse, so
sign-in after a successful auth-config request failed. Each request now gets
its own postgres.js client.

Better Auth session inserts now serialize timestamps as ISO strings. workerd
rejects postgres.js binds of `Date` objects, so a valid password still returned
500 after credential check.
