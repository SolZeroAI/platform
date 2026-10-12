---
packages:
  "release:solzero": patch
---

## Complete delegated GPT-OSS turns

Isolate parent and child turns now use a 4096-token output budget for native Cloudflare GPT-OSS when no explicit limit is supplied, avoiding its short default during tool execution and delegation.
