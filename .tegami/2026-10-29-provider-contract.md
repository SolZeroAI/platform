---
packages:
  "release:solzero": patch
---

## Keep interleaved reasoning when saving custom providers

Saving provider settings no longer drops a custom model's `interleaved` reasoning setting. The OpenAPI contract for `/providers` now lists the shared provider override and custom provider fields, the allowed reasoning efforts, and interleaved reasoning, instead of open JSON records. The web app loads and saves provider settings through the typed API client.
