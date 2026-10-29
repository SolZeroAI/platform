---
packages:
  "release:solzero": patch
---

## Build agent container images with each release

The OpenCode, Codex and Claude Code agent containers now use images built from the same commit as
the release. Each release pushes its images to GHCR with the release tag, and the alchemy.new
package deploys those exact images. A deploy from a git checkout builds the images from
`packages/agent-container/Dockerfile` and rebuilds them only when that source changes, so Docker
must run during the deploy. The repository no longer stores image digests.
