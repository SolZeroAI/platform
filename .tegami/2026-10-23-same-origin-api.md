---
packages:
  "release:solzero": minor
---

Serve the API at the web application's `/api` path with `deployment.apiRouting: "same-origin"`. Public requests route directly to the API Worker, while server-rendered pages use a private service binding. Workflow webhooks, Slack callbacks, agent URLs and OpenAPI retain the configured API base path. Separate API domains remain the default.
