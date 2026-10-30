---
packages:
  "release:solzero": patch
---

## Simplify PR preview cleanup

PR preview cleanup no longer captures, uploads or restores ownership artifacts. After the destroy, it checks by stage name that no Worker, Durable Object namespace, container application, D1 database, R2 bucket, KV namespace, workflow, AI Gateway, API token, provider-key secret or AI Search namespace of the stage remains.
