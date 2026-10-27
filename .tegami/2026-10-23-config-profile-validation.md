---
packages:
  "release:solzero": patch
---

## Validate complete deployment profiles

Configuration checks now include a named profile's test-stage file when it exists. Rewriting an
existing stage-secret file also restores private file permissions, rather than preserving a broader
mode from an earlier copy.
