---
packages:
  "release:solzero": patch
---

## Safer decode at bot, session, workflow, and alarm edges

SolZero now parses untrusted bot, session, workflow, and alarm payloads before they reach runtime code. Operators see safer decode of stored rows, manifests, and artifact metadata.
