---
packages:
  "release:solzero": minor
---

## Deploy pull request previews on demand

On a fork that sets `CLOUDFLARE_DEPLOY`, a pull request no longer deploys a `pre-<number>` preview stage on every push. Add the `preview` label to deploy one. Later pushes redeploy it while the label stays. Remove the label or close the pull request to destroy the stage.

The new `PR Preview` workflow owns these stages. Fork operators must enable it on their Actions page and create the `preview` label. To destroy an orphaned stage, use **Run workflow** on `PR Preview` and enter the `stage`. **Run workflow** on `Deploy Preview` now only refreshes standing `pre`.
