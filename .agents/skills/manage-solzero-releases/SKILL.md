---
name: manage-solzero-releases
description: Choose SolZero release versions and write clear Tegami changelog entries. Use when a change affects users or operators, when preparing a pull request, when editing files under .tegami, or when running and recovering the version and GitHub Release process.
---

# Manage SolZero Releases

Read `docs/releasing.md` before release work. Treat `VERSION` as the public product version. Keep
private workspace package versions at `0.0.0`.

## Assess the change

- Add a release entry for a change that affects a user, an administrator, or a deployment operator.
- Use the `release:none` pull request label for tests, refactors, or internal maintenance with no
  observable effect. Explain the choice in the pull request.
- Describe the outcome that ships. Omit internal file names, implementation steps, and temporary
  migration details unless an operator must act on them.

## Choose the version change

- Before `1.0.0`, choose `patch` for a compatible fix. Choose `minor` for a feature or a breaking
  change. Reserve `major` for the first stable release.
- From `1.0.0`, follow standard SemVer. A compatible fix is `patch`. A compatible feature is
  `minor`. A breaking change is `major`.
- Choose the largest change required by the pull request.

## Write the entry

Create one Markdown file at `.tegami/YYYY-MM-DD-short-slug.md`:

```md
---
packages:
  "release:solzero": patch
---

## Preserve sessions after a restart

SolZero now restores active sessions when the service restarts.
```

Use a short heading that identifies the user-visible outcome. Write complete sentences in the body.
State required operator action when one exists. Keep separate outcomes in separate entries so release
notes remain easy to scan.

## Check the pull request

- Confirm that the frontmatter targets only `release:solzero`.
- Confirm that the bump follows the current version policy.
- Confirm that the note makes sense without the pull request description.
- Run the focused tests for the changed code. Let the Tegami preview workflow show the combined
  version and release notes after the pull request opens.

Do not run `nub run tegami version` on a feature branch. That command changes `VERSION`,
`CHANGELOG.md`, and the publish lock. Let the release workflow make those changes in its version pull
request.

## Run or recover a release

- Review the generated version pull request before merge. Verify `VERSION`, `CHANGELOG.md`, and the
  release notes.
- Re-run a failed release workflow after a transient failure. Tegami skips an existing tag and GitHub
  Release.
- Fix a released defect in a new pull request and add another release entry.
- Keep published `vX.Y.Z` tags immutable.
