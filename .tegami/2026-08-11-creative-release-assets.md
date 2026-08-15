---
packages:
  "release:solzero": minor
---

## Publish branded release visuals

<!-- creative: {"title":"Give every release a launch moment.","bullets":["Publish a polished social card with each GitHub release.","Render every card directly from structured release data."],"workType":"feature"} -->

SolZero releases now include a branded release-notes card. The card uses the SolZero logo, Manrope
font, and Kumo colors. Two layouts support feature summaries with different content density. Short
social copy can sit beside the full technical release note. Work-type badges and high-contrast
bullets make each highlight easier to scan. The structured templates keep each release image simple
and consistent.

Tegami sends the release data to Takumi during version preparation. Takumi renders the image through
its native Node binding. The version pull request includes the result, and the GitHub release notes
display the card from the release tag.
