---
packages:
  "release:solzero": patch
---

## Show the real product version in the app

The web sidebar and the API health endpoint now display the product version from the repository
`VERSION` file, followed by the short commit hash of the deployed build, for example
`v1.5.0-036d0b`. Deployments previously displayed `v0.0.0` because they read the placeholder
workspace package version.
