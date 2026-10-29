---
packages:
  "release:solzero": patch
---

## Describe session list rows in the API contract

The OpenAPI document now describes each session that `GET /sessions` returns. A failure that a session returns now carries the typed error fields (`_tag` and `message`) beside `error`, so API clients read its message. The agents table and the archive action use the typed API client.
