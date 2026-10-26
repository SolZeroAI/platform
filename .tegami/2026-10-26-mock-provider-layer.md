---
packages:
  "release:solzero": minor
---

## Select live or mock provider layers

Set `providerLayer` to `live` or `mock` for identity and GitHub. Set `aiGatewayLayer` to `live` or `mock` for Workers AI. `aiGatewayLayer: mock` answers `run()` and `gateway()` locally and does not provision an account AI Gateway, secrets store, or run token. Remove `aiProviders.cloudflareAiGateway.localBinding`; that field is no longer accepted.
