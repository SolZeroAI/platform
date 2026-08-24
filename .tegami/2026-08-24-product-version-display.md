---
packages:
  "release:solzero": patch
---

## Show the real product version in the app

The web sidebar and the API health endpoint now display the product version from the repository
`VERSION` file, followed by the short commit hash of the deployed build, for example
`v1.5.0-036d0b`. Deployments previously displayed `v0.0.0` because they read the placeholder
workspace package version.

A build that contains commits after the release tag also shows the unreleased commit count, for
example `v1.5.0+2-bbb222`. A build deployed from the release tag itself, such as a production
deployment, keeps the plain `v1.5.0-036d0b` form. The count needs the release tag and full history
in the deploy checkout; without them the label omits the count.
