---
packages:
  "release:solzero": patch
---

Align exported API key and session response schemas with the live Worker responses. API key identifiers and timestamps now decode correctly, and session state no longer requires a nonexistent response wrapper.
