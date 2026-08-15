# Releasing SolZero

SolZero uses [Tegami](https://tegami.fuma-nama.dev) to prepare versions and publish releases. The
public product has one version. `VERSION` stores it. Private workspace packages stay at `0.0.0` and
are never published to npm.

Each release creates an immutable `vX.Y.Z` Git tag and a GitHub Release with the same version.

## Version policy

The first Tegami-managed release is `v1.5.0`. The release setup adopts `1.4.4` as the previous
product version. Its pending minor entry prepares `v1.5.0`.

Follow Semantic Versioning. Compatible fixes increment the patch number. Compatible features
increment the minor number. Breaking changes increment the major number.

## Add a release entry

Every pull request with an observable effect must add one or more Markdown files under `.tegami/`.
Use a clear file name such as `.tegami/2026-08-11-preserve-sessions.md`.

```md
---
packages:
  "release:solzero": patch
---

## Preserve sessions after a restart

SolZero now restores active sessions when the service restarts.
```

Choose `patch`, `minor`, or `major` according to the version policy. Write the note for users and
operators. Include required action in the note. Tegami adds pull request and contributor links to the
GitHub Release.

Add a creative directive after the section heading when the release card needs shorter social copy:

```md
<!-- creative: {"title":"Send every model through one reliable gateway.","bullets":["Route agents through Cloudflare AI Gateway.","Manage models and provider keys from one catalog."],"workType":"feature"} -->
```

Use a short title that states the user benefit. Add one or two concise bullets for the card. Put
remaining technical context in the full release note. Set the work type for each highlight. Use the
release-card skill to render and inspect the final card. See
[`packages/creative/README.md`](../packages/creative/README.md) for the field limits.

Run `nub run tegami` to create an entry interactively. The pull request preview workflow posts the
combined version and release-note preview. A change with no observable effect can use the
`release:none` label after the pull request explains why it needs no entry.

## Automated release flow

1. Merge a feature pull request with its pending `.tegami/` entries.
2. Wait for `Validate` to pass on `master`. The `Release` workflow then runs `nub run tegami ci` and
   opens or updates `tegami/version-packages`.
3. Review the version pull request. It updates `VERSION`, prepends `CHANGELOG.md`, consumes the
   pending entries, and writes `.tegami/publish-lock.yaml`.
4. Merge the version pull request. After validation, the release workflow pushes the `vX.Y.Z` tag and
   creates its GitHub Release.

Do not edit generated version files in a feature pull request. Review them in the version pull request
before merge.

## Repository settings

Enable **Allow GitHub Actions to create and approve pull requests** in the repository Actions
settings. Keep workflow permissions restricted to the values in each workflow. The version workflow
needs `contents: write` and `pull-requests: write`.

Create the `release:none` label for pull requests that have no user-visible release note. Enable
immutable releases after the repository supports that GitHub setting.

## Failure recovery

Re-run the failed `Release` workflow after a network or GitHub API failure. Tegami checks existing
tags and releases, so the retry continues the same version without duplicating work.

If a released change has a defect, fix it in a new pull request and add a new release entry. Keep an
existing release tag at its original commit. Never delete or move a published release tag.
