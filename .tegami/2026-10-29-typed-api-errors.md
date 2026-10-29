---
packages:
  "release:solzero": patch
---

## Name the error type in API error responses

API error responses now include `_tag` (for example `NotFoundError`) and `message` beside the existing `error` field, so typed clients built from the published OpenAPI contract can decode them. The `error` field is unchanged. The web app now loads and saves secrets through that typed client.
