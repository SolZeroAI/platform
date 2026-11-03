---
packages:
  "release:solzero": patch
---

## Run CI on GitHub-hosted runners by default

The workflow templates now default to GitHub-hosted `ubuntu-latest` runners. A fork that does not set the `S0_CI_RUNNER` repository variable now runs its deployment and validation jobs on `ubuntu-latest`. The Release and Tegami jobs also run on `ubuntu-latest`. To run deployment and validation on another runner, set `S0_CI_RUNNER` to that runner's label.
