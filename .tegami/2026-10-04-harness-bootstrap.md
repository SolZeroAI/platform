---
packages:
  "release:solzero": patch
---

## Start container harnesses with their required bootstrap dependency

The agent container includes the pinned pnpm runtime required by the AI SDK harness bootstrap recipes. This supplies the missing executable needed at startup. Isolated end-to-end container runs build the current runtime sources and Dockerfile locally; deployed environments receive the change when release CI publishes updated image digests. Repository development continues to use Nub.
