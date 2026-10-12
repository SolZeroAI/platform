---
packages:
  "release:solzero": patch
---

## Release isolated test gateways after validation

Cloudflare end-to-end checks reuse dedicated test gateway names and destroy their owned
infrastructure after each CI run, including revoking the generated application run token.
Local test operators can run `nub run test:e2e:cleanup` after stopping the stack. Cleanup
validates ownership and leaves production and shared gateways unchanged.
