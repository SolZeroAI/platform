---
packages:
  "release:solzero": patch
---

## Start container harnesses with their required bootstrap dependency

The agent container includes the pinned pnpm runtime required by the AI SDK harness bootstrap recipes. OpenCode and Codex no longer fail at startup because that executable is missing. Repository development continues to use Nub.
