---
packages:
  "release:solzero": patch
---

## Search secrets with long names

Secret search applies literal matching after user-scoped database selection, avoiding D1 pattern-length errors for longer names.
