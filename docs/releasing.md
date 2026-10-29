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
   workflow runs `nub run tegami ci` and opens or updates `tegami/version-packages`. Preview
   deploys are not required for a GitHub Release. On SolZeroAI/platform, disable `Deploy Preview`
   with Actions → Deploy Preview → Disable workflow (`gh workflow disable preview.yml`). Keep the
   YAML in the tree. Deploy Preview and Deploy jobs run only when the repository variable
   `CLOUDFLARE_DEPLOY` is `true`. SolZeroAI/platform does not set that variable, so the jobs skip
   even if a workflow is enabled, and this repository does not need `CLOUDFLARE_API_TOKEN`.
   Fork owners enable Deploy Preview on their Actions page, set `CLOUDFLARE_DEPLOY` to `true`, and
   set the token. See [deployment customization](customization.md#private-deployment-ci). The canonical `Validate` e2e job uses dedicated Cloudflare test credentials; deployment remains disabled. On a fork that sets the variable, **Run
   workflow** on `Deploy Preview` can refresh standing Alchemy stage `pre` (`deploy-standing-pre`)
   or destroy an orphaned `pre-<number>` stage (`destroy-ephemeral` plus a canonical `pre-<positive-number>` stage for a currently closed, same-repository pull request).
   The lifetime guard preserves standing `pre`, open/reopened previews and unrelated stages. Manual `Deploy`
   (`deploy.yml`) stays a separate `workflow_dispatch` with a required `environment` choice of `pre`
   or `prod`. Do not fold those Deploy Preview actions into `Deploy`. It runs only when
   `CLOUDFLARE_DEPLOY` is `true`. Put production deploy secrets in a `prod` environment limited to `master`. Only that Deploy job selects `prod`.
3. Review the version pull request. It updates `VERSION`, prepends `CHANGELOG.md`, consumes the
   pending entries, and writes `.tegami/publish-lock.yaml`.
4. Merge the version pull request. After validation, the release workflow pushes the `vX.Y.Z` tag and
   creates its GitHub Release. The same run publishes the alchemy.new registry package. See
   [Registry package](#registry-package).

Do not edit generated version files in a feature pull request. Review them in the version pull request
before merge.

## Registry package

`alchemy.new.jsonc` names registry package `solzero/platform`. `.github/workflows/release.yml` publishes
it with `SolZeroAI/alchemy-new-publish-action@v1` when the version tag does not already exist. The
registry job checks out that release commit, uses GitHub Environment `alchemy-new`, and requests
`id-token: write`. Pull requests pack the archive with `dry-run: true` and do not request a token.

Before it packs the archive, the registry job builds the OpenCode, Codex and Claude Code agent
images and pushes them to `ghcr.io/solzeroai/<runtime>-agent:vX.Y.Z`. It writes their digests into
`packages/agent-container/src/published-images.ts` in the archive only. The alchemy.new deploy
sandbox has no Docker, so the release deploys these prebuilt images. The repository keeps that
object empty. A deploy from a git checkout builds each image from
`packages/agent-container/Dockerfile` with Alchemy and rebuilds it only when the bundled context
changes. Do not commit image digests.

Allow this publisher before the first deploy. The OIDC `job_workflow_ref` must equal
`SolZeroAI/platform/.github/workflows/release.yml@refs/heads/master`, and the `ref` claim must equal
`refs/heads/master`.

| Field | Value |
| --- | --- |
| Repository | `SolZeroAI/platform` |
| Workflow | `release.yml` |
| Ref | `refs/heads/master` |
| Environment | `alchemy-new` |

## Repository settings

The release job mints a GitHub App installation token with `actions/create-github-app-token@v3`.
That job selects the `release` environment, which is limited to `master`. The App credentials are
the SolZeroAI organization secrets `RELEASE_APP_CLIENT_ID` (the `solzero-bot` Client ID) and
`RELEASE_APP_PRIVATE_KEY`, which the action reads through its `client-id` and `private-key` inputs.
Do not add repository or environment copies; they override the organization values. The token is limited to this repository. It requests contents write and pull requests write.
Checkout and `nub run tegami ci` use that token for the version pull request, the `vX.Y.Z` tag, and
the GitHub Release. The app opens `tegami/version-packages`, so pull request workflows start.

Keep each job's `GITHUB_TOKEN` permissions at the minimum in the workflow file. The release job has
`contents: read`. The registry job has `contents: read`, `id-token: write`, and `packages: write`
for the agent image push.

Create the `release:none` label for pull requests that have no user-visible release note. Enable
immutable releases after the repository supports that GitHub setting. Create the `alchemy-new`
environment for the registry job. It holds no registry token.

## Failure recovery

Re-run the failed `Release` workflow after a network or GitHub API failure. Tegami checks existing
tags and releases, so the retry continues the same version without duplicating work. Re-run the
registry job on that same workflow run if the upload failed after the tag was created.

If a released change has a defect, fix it in a new pull request and add a new release entry. Keep an
existing release tag at its original commit. Never delete or move a published release tag.
