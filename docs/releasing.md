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
5. When this run publishes that GitHub Release, the same workflow checks out the new tag and
   publishes the alchemy.new registry package for that commit. It does not publish a later commit
   under an older version. See [Registry package](#registry-package).

Do not edit generated version files in a feature pull request. Review them in the version pull request
before merge.

## Registry package

alchemy.new deploys SolZero from the registry package named in `alchemy.new.jsonc`. The manifest
uses schema version 1 and `$schema` `https://alchemy.new/schema/project.json`. `source.kind` is
`registry`, `source.org` is `solzero`, and `source.project` is `platform`. The manifest does not set
`source.version`. The published version is the release tag without the leading `v`. The runner
downloads the archive, writes the stored manifest to the package root, and runs
`node node_modules/alchemy/bin/cli.js deploy`. It does not clone the tag, and it does not install
dependencies or build container images. The manifest is a separate upload. A root `alchemy.new.jsonc`
inside the archive is rejected.

The Release workflow (`.github/workflows/release.yml`) publishes the digest-pinned agent container
images first. Tegami then creates the GitHub Release. The registry job runs only when that same run
published the release. It checks out the release tag on linux/amd64 and continues only when the
checkout, the recorded publish commit, and the live tag commit are the same SHA. A tree whose
`VERSION` names an older release, such as current master naming `v1.8.0`, is not published. The job
then runs:

```sh
nub install --frozen-lockfile
nub run build
nub prune --prod
```

`scripts/prepare-alchemy-new-package.sh` runs those commands. Vite and the Tailwind plugin are
production dependencies because deploy runs `vite build` from `apps/web`. Alchemy is a production
dependency so `node_modules/alchemy/bin/cli.js` remains after the prune. The script then replaces
the `node_modules/alchemy` directory link with relative links into `node_modules/.store`. It then
rewrites any remaining absolute symlink that points inside the package. The publish action rejects
an absolute symlink target. Nub keeps the store in the project (`enableGlobalVirtualStore=false`).
The publish action does not walk a directory link, and it requires
`node_modules/alchemy/bin/cli.js` as an archive member. The file bytes stay in the store.

`SolZeroAI/alchemy-new-publish-action@v1` packs the tree and publishes it with GitHub OIDC. The
workflow sets `manifest` to `alchemy.new.jsonc`. The action uploads that file separately and leaves
it out of the tar. The job summary includes the `manifest-sha256` output. The registry job uses
GitHub Environment `alchemy-new`. Its permissions are `contents: read` and `id-token: write`. It
does not use a registry token. `package` is `solzero/platform`. The version is the release tag.
`on-immutable` is `skip-if-digest-matches`, so a retry of the same archive and the same manifest
succeeds. A different archive or manifest for that version fails. Include and exclude patterns live
in `scripts/alchemy-new-pack.include` and `scripts/alchemy-new-pack.exclude`. The exclude list names
`alchemy.new.jsonc`. The action's default excludes still drop tests, VCS metadata, and secret files.
The archive root is the package root. It contains `packages/infra/alchemy.run.ts`, the built web
output, `apps/web/public`, and production `node_modules`.

Pull requests from this repository run the same prepare steps with `dry-run: true`. That job has
`contents: read` only. It does not use the `alchemy-new` environment and it does not publish.
`@v1` floats and is not tagged yet. The dry-run check fails until the tag exists. After Tegami
releases the action, pin `alchemy-new-publish-action@1.x.y` or that tag's commit SHA.

Archives over 80 MiB warn. Archives over 256 MiB fail. Deploy runs `vite build` from `apps/web`,
and Vite copies `public/` into the client output, so `apps/web/public/images` stays in the archive.
The GIF files in that directory are static public assets. Application source does not import them.
The same bytes also land in `apps/web/dist/client/images` during the release build. That copy is
excluded. The linux/amd64 workerd binary, sharp, and the Vite native bindings stay. Together with
the Alchemy provider JavaScript and the public GIF assets, the package is larger than the 80 MiB
guide and under the 256 MiB cap. Deploy and Deploy Preview on SolZeroAI/platform stay disabled.

A release that did not publish the registry package cannot be deployed on alchemy.new. Re-run the
failed jobs on the same Release workflow run to retry. A later run does not publish a version for a
release it did not create. Tegami skips an existing tag and GitHub Release. A workflow triggered by
`release: published` does not start, because Tegami creates the release with the workflow token.

After the registry production deploy, allow this publisher at alchemy.new `/packages`:

| Field | Value |
| --- | --- |
| Organization | `solzero` |
| Package | `platform` |
| Repository | `SolZeroAI/platform` |
| Workflow | `.github/workflows/release.yml` |
| GitHub Environment | `alchemy-new` |

Create the `alchemy-new` environment in this repository before the first registry publish. Do not
store a registry token in it. The job requests an OIDC token for
`https://alchemy.new/registry/publish`.

## Repository settings

Enable **Allow GitHub Actions to create and approve pull requests** in the repository Actions
settings. Keep workflow permissions restricted to the values in each workflow. The version workflow
needs `contents: write` and `pull-requests: write`.

Create the `release:none` label for pull requests that have no user-visible release note. The
registry package is not a GitHub Release asset. GitHub's immutable-release setting can stay enabled.
Create the `alchemy-new` environment for the registry job. That environment is the trusted-publisher
allowlist value. It does not hold secrets.

## Failure recovery

Re-run the failed `Release` workflow after a network or GitHub API failure. Tegami checks existing
tags and releases, so the retry continues the same version without duplicating work. Re-run the
failed jobs on the publishing run to retry a missing registry publish. A new run does not publish a
package for a release it did not create. When the registry already has the same archive digest and
the same manifest digest, `skip-if-digest-matches` skips the upload. Different bytes for that
version fail.

If a released change has a defect, fix it in a new pull request and add a new release entry. Keep an
existing release tag at its original commit. Never delete or move a published release tag.
