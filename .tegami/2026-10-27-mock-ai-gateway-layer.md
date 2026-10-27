---
packages:
  "release:solzero": minor
---

## Run a local stage without an account AI Gateway

Set the optional top-level `aiGatewayLayer` to `mock` in a stage configuration to answer Workers AI model calls inside the Worker. Each answer repeats the user's message. That stage does not provision an account AI Gateway, secrets store, or run token, and it does not need a Cloudflare API token for model calls. Use it only for local testing. Omit the field or set it to `live` for every deployed stage.
