---
packages:
  "release:solzero": minor
---

## Deploy from the ready GitHub Release archive

<!-- creative: {"title":"Deploy SolZero from a ready release archive.","bullets":["alchemy.new uses the alchemy.new.tar.gz release asset.","The deploy sandbox does not install dependencies."],"workType":"feature"} -->

Each GitHub Release includes `alchemy.new.tar.gz`. alchemy.new downloads that archive and deploys it. The deploy sandbox does not clone the tag or install dependencies. Agent container images stay pinned by digest. A release without this asset cannot be deployed on alchemy.new. Releases published before the asset, including v1.8.0, stay undeployable there until you select a release that includes it.
