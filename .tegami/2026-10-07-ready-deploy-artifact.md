---
packages:
  "release:solzero": minor
---

## Deploy from the alchemy.new registry

<!-- creative: {"title":"Deploy SolZero from the alchemy.new registry.","bullets":["The release publishes a ready package for that version.","The deploy sandbox does not install dependencies."],"workType":"feature"} -->

alchemy.new deploys SolZero from registry package `solzero/platform`. The release workflow publishes that package for the release it just created. The deploy sandbox does not clone the tag or install dependencies. Agent container images stay pinned by digest. A release that did not publish the package cannot be deployed on alchemy.new. Releases published before this package, including v1.8.0, stay undeployable there until you select a release that published it.

Allow the publisher at alchemy.new before the first deploy. The repository is `SolZeroAI/platform`, the workflow is `.github/workflows/release.yml`, and the GitHub Environment is `alchemy-new`.
