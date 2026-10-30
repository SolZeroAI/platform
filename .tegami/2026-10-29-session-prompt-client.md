---
packages:
  "release:solzero": patch
---

## Use the typed API client for session prompts and socket tokens

The session page and home page send queued prompts, Okta resumes and websocket token requests through the typed API client. A failed prompt now shows the server's error message instead of the raw response body. Streamed isolate prompts still use `fetch`, because the API contract declares only the queued reply.
