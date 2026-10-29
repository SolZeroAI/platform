---
packages:
  "release:solzero": patch
---

## Pin agent container images to the current build

The OpenCode, Codex and Claude Code agent containers now use images built from the current
agent-container source. The previous pins pointed to older builds, and Release could not publish
new images until the GHCR packages granted this repository access.
