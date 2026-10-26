---
packages:
  "release:solzero": minor
---

## Answer local model calls without an account AI Gateway

Set `aiGatewayLayer` to `mock` to answer Workers AI `run()` and `gateway()` locally. That choice does not provision an account AI Gateway, secrets store, or run token. Leave it `live` for deployed stages. Remove `aiProviders.cloudflareAiGateway.localBinding`; that field is no longer accepted.
