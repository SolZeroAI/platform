---
packages:
  "release:solzero": patch
---

## Keep Cloudflare credentials in organization secrets

`nub run github:sync-env-secrets` no longer uploads `CLOUDFLARE_ACCOUNT_ID` or
`CLOUDFLARE_API_TOKEN`. SolZeroAI holds them as organization Actions secrets, and a repository
or Environment copy would override them. A fork that deploys sets these two secrets itself.
