---
packages:
  "release:solzero": patch
---

## Run Workers AI models through the Agents SDK provider

Isolate sessions now reach Workers AI models through `createAI` from the Cloudflare Agents SDK (`agents` 0.30) instead of the deprecated `workers-ai-provider` package. The Think runtime moves to 0.20. Model selection, reasoning effort, and the deployment's AI Gateway stay the same. No operator action is required.
