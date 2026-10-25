---
packages:
  "release:solzero": patch
---

## Bind Workers AI locally from deployment config

Set `aiProviders.cloudflareAiGateway.localBinding` to use a local Workers AI binding during `alchemy dev`. That setting does not provision an account AI Gateway or run token.
