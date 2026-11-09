---
packages:
  "release:solzero": patch
---

## Complete manual test-recording refreshes

Successful manual validation runs now execute the requested recording-commit step when release
detection is skipped. Failed or cancelled tests cannot publish recordings.
