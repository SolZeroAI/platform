---
packages:
  "release:solzero": patch
---

## Skip Cloudflare deploys until a fork opts in

Deploy and Deploy Preview run only when the repository variable `CLOUDFLARE_DEPLOY` is `true`.
The public repository does not set that variable, so it does not need `CLOUDFLARE_API_TOKEN`.

A fork that deploys sets `CLOUDFLARE_DEPLOY` to `true` and sets `CLOUDFLARE_API_TOKEN`.
Put production deploy secrets in a `prod` environment limited to `master`. Only the Deploy job uses that environment.
