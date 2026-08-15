---
name: generate-release-notes-card
description: Generate or update the branded SolZero release-notes image from Tegami entries or structured JSON. Use when a user asks for a release card, release image, social release graphic, or a visual summary of a SolZero version.
---

# Generate Release Notes Card

Use the canonical `@solzero/creative` renderer. Keep fonts, logos, colors, and layouts in that
package.

## Workflow

1. Work from the SolZero repository root.
2. Use pending `.tegami/*.md` entries and `VERSION` when the user supplies no release data.
3. Review each entry's social copy before rendering. Keep the section heading and body useful for
   the GitHub release. Add an invisible creative directive when the image needs sharper copy:

```md
<!-- creative: {"title":"Send every model through one reliable gateway.","bullets":["Route agents through Cloudflare AI Gateway.","Manage models and provider keys from one catalog."],"workType":"feature"} -->
```

Use a title of three to eight words when the meaning stays clear. State the user outcome. Write one
or two concise bullets for the image. Keep each bullet under 120 characters. Put remaining
implementation detail in the full release note.

4. Set `workType` for every highlight. Use `feature`, `bug`, `ktlo`, `security`, `performance`, `ux`,
   `docs`, or `breaking`.
5. Select `light-features` for one to three primary updates. Select `dark-columns` for compact lists
   with up to four updates or when the user requests the dark layout. Extra highlights appear as
   brief badges in the optional `Also in vX.Y.Z` footer.
6. Run the package through the root command:

```sh
nub run creative:release-card
```

Pass requested controls after `--`:

```sh
nub run creative:release-card -- --layout dark-columns --version 1.5.0
```

Use a structured input file when the user provides custom content:

```sh
nub run creative:release-card -- --input path/to/release-card.json
```

The JSON shape is documented in `packages/creative/README.md`.

The release hook and GitHub Actions render the card through Takumi's native Node binding.

7. Confirm that `docs/solzero-release-notes.png` exists and has a 1200 by 675 pixel canvas.
8. Inspect the rendered image. Check badge selection, round bullet fit, text contrast, the SolZero
   logo and name, the Manrope font, the plain canvas, and the overflow footer.
9. Report the layout and card path.

Do not edit `VERSION`, `CHANGELOG.md`, or `.tegami/publish-lock.yaml` while generating the card.
