---
packages:
  "release:solzero": patch
---

## Continue existing harness sessions

The session run API now inherits an existing session's kind when a follow-up request omits it. OpenCode and Codex follow-ups no longer fail with an incorrect isolate-kind conflict.
