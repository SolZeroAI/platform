# Releasing SolZero

SolZero uses [Tegami](https://tegami.fuma-nama.dev) to prepare versions and publish releases. The
public product has one version. `VERSION` stores it. Private workspace packages stay at `0.0.0` and
are never published to npm.

Each release creates an immutable `vX.Y.Z` Git tag and a GitHub Release with the same version on
[SolZeroAI/platform](https://github.com/SolZeroAI/platform).

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
[`apps/web/src/creative/README.md`](../apps/web/src/creative/README.md) for the field limits.

The automated release flow renders a card for minor and major releases. Patch releases publish
text-only GitHub notes. The manual command remains available for local previews.

Run `nub run tegami` to create an entry interactively. The pull request preview workflow posts the
combined version and release-note preview. A change with no observable effect can use the
`release:none` label after the pull request explains why it needs no entry.

## Automated release flow

1. Merge a feature pull request with its pending `.tegami/` entries.
2. Wait for `Validate` to pass on `master`. That workflow runs static checks and isolated Cloudflare e2e checks. The `Release`
   workflow then runs `nub run tegami ci` and opens or updates `tegami/version-packages`. Preview
   deploys are not required for a GitHub Release. On SolZeroAI/platform, disable `Deploy Preview`
   with Actions → Deploy Preview → Disable workflow (`gh workflow disable preview.yml`). Keep the
   YAML in the tree. The invert guard skips secret-using jobs on this public repository even if the
   workflow is enabled. Fork owners enable it on their own Actions page. Do not run `Deploy Preview`
   or `Deploy` on SolZeroAI/platform. The canonical `Validate` e2e job uses dedicated Cloudflare test credentials; deployment remains disabled. On the private fork, **Run
   workflow** on `Deploy Preview` can refresh standing Alchemy stage `pre` (`deploy-standing-pre`)
   or destroy an orphaned `pre-<number>` stage (`destroy-ephemeral` plus a canonical `pre-<positive-number>` stage for a currently closed, same-repository pull request).
   The lifetime guard preserves standing `pre`, open/reopened previews and unrelated stages. Manual `Deploy`
   (`deploy.yml`) stays a separate `workflow_dispatch` with a required `environment` choice of `pre`
   or `prod`. Do not fold those Deploy Preview actions into `Deploy`. It runs only when
   `github.repository != 'SolZeroAI/platform'` (the private deploy fork `jonbeckman/solzero`).
3. Review the version pull request. It updates `VERSION`, prepends `CHANGELOG.md`, consumes the
   pending entries, and writes `.tegami/publish-lock.yaml`.
4. Merge the version pull request. After validation, the release workflow pushes the `vX.Y.Z` tag and
   creates its GitHub Release.
5. When this run publishes that GitHub Release, the same workflow checks out the new tag and uploads
   `alchemy.new.tar.gz` for that commit. It does not attach the archive to an older release. See
   [Ready deploy artifact](#ready-deploy-artifact).

Do not edit generated version files in a feature pull request. Review them in the version pull request
before merge.

## Ready deploy artifact

alchemy.new deploys SolZero from the GitHub Release asset named by `deployment.artifact` in
`alchemy.new.jsonc`. That asset is `alchemy.new.tar.gz`. The runner downloads the asset and runs
`node node_modules/alchemy/bin/cli.js deploy`. It does not clone the tag, and it does not install
dependencies or build container images.

The Release workflow publishes the digest-pinned agent container images first. Tegami then creates
the GitHub Release. The pack job runs only when that same run published the release. It checks out
the release tag on linux/amd64 and continues only when the checkout, the recorded publish commit, and
the live tag commit are the same SHA. A tree whose `VERSION` names an older release, such as current
master naming `v1.8.0`, is not packed. When the asset is already on that tag, the job leaves it in
place. Otherwise it runs:

```sh
nub install --frozen-lockfile
tar -czf alchemy.new.tar.gz --exclude=.git --exclude=alchemy.new.tar.gz .
```

`scripts/pack-alchemy-new-artifact.sh` creates that archive. The archive root is the package root.
It includes `node_modules` and the project-local Nub store. `.npmrc` sets
`enableGlobalVirtualStore=false`, so package links stay inside the project and the tree runs without
another install. The script rejects symlinks that resolve outside the project, and it checks that
`node_modules/alchemy/bin/cli.js` and `packages/infra/alchemy.run.ts` resolve inside the archive.
It excludes `.git`.

Alchemy builds the Workers and the Vite site during deploy. The pack job does not run `nub run
build`. Deploy and Deploy Preview on SolZeroAI/platform stay disabled.

A release without `alchemy.new.tar.gz` cannot be deployed on alchemy.new. Re-run the failed jobs on
the same Release workflow run to retry a missing upload. A later run does not upload to a release it
did not publish. Tegami skips an existing tag and GitHub Release. The pack job leaves an existing
asset for that tag in place. A workflow triggered by `release: published` does not start, because
Tegami creates the release with the workflow token.

## Repository settings

Enable **Allow GitHub Actions to create and approve pull requests** in the repository Actions
settings. Keep workflow permissions restricted to the values in each workflow. The version workflow
needs `contents: write` and `pull-requests: write`.

Create the `release:none` label for pull requests that have no user-visible release note. Immutable
releases reject asset changes after publication. Leave that setting off while this workflow attaches
`alchemy.new.tar.gz` after Tegami publishes the release.

## Failure recovery

Re-run the failed `Release` workflow after a network or GitHub API failure. Tegami checks existing
tags and releases, so the retry continues the same version without duplicating work. Re-run the
failed jobs on the publishing run to retry a missing `alchemy.new.tar.gz` upload. A new run does not
attach that archive to a release it did not publish.

If a released change has a defect, fix it in a new pull request and add a new release entry. Keep an
existing release tag at its original commit. Never delete or move a published release tag.
