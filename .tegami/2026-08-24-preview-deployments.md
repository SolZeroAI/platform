---
packages:
  "release:solzero": minor
---

## Deploy previews from GitHub Actions

The new `Deploy Preview` workflow deploys the `pre` stage on each merge to `master`. Each pull
request deploys an ephemeral `pre-<number>` stage and posts its preview URL as a pull request
comment. The workflow destroys the ephemeral stage when the pull request closes. A manual dispatch
input removes an orphaned `pre-*` stage.

The `Release` workflow now starts after `Deploy Preview` succeeds on `master`. Deployment operators
must set the GitHub `pre` environment secrets and the repository Cloudflare secrets. Run
`nub run github:sync-env-secrets` to upload them.
