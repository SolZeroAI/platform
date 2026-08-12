---
packages:
  "release:solzero": minor
---

## Route model traffic through Cloudflare AI Gateway

SolZero now provisions Cloudflare AI Gateway as its default model gateway. Each deployment profile
can set a model allowlist and choose its default model. Sessions that run in Isolate, OpenCode,
Codex, or Claude Code can select a compatible gateway model.

Administrators can supply provider keys through deployment-managed secrets or the Admin dashboard.
A user can also set a personal provider-key override. SolZero keeps injected container credentials
in trusted Worker code.

Deployment owners must grant the Cloudflare API token edit access to AI Gateway and Secrets Store
before provisioning.
