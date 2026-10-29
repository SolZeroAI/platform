---
packages:
  "release:solzero": patch
---

## Use the typed API client for session page actions

The session page's archive, unarchive and agent tools actions, and the tools dialog's MCP Context Forge and AI Search lists, now use the typed API client. A failed action shows the server's error message. The unused `BackgroundSessionsClient` module is removed from the web app.
