---
packages:
  "release:solzero": patch
---

## Run CI on GitHub-hosted runners by default

The workflow templates now default to GitHub-hosted `ubuntu-latest` runners instead of Blacksmith. A fork that does not set the `S0_CI_RUNNER` repository variable now runs its deployment and validation jobs on `ubuntu-latest`. The Release and Tegami jobs also run on `ubuntu-latest`. To keep Blacksmith for deployment and validation, set `S0_CI_RUNNER` to `blacksmith-4vcpu-ubuntu-2404`.
