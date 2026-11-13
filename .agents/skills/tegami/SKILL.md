---
name: tegami
description: Use Tegami to write changelog entries and run version and publish commands. Use when a change needs a release note, when editing files under .tegami, or when running the Tegami CLI.
---

# Tegami

Tegami prepares versions and publishes releases. This repository already uses it.
The official reference is [Tegami](https://tegami.fuma-nama.dev).

## Use the repository script

`scripts/tegami.mts` is the entry point. It builds the release with `tegami()` from `tegami`,
runs it with `runCli` from `tegami/cli`, and registers `github()` from `tegami/plugins/github`.

Run Tegami through that script:

- `nub run tegami` creates a changelog entry.
- `nub run tegami version` drafts version changes and writes the publish lock.
- `nub run tegami ci` versions pending changelogs, or publishes from the existing publish lock.

The release workflow owns `nub run tegami version` and `nub run tegami ci`. On a feature branch
those commands rewrite `VERSION`, `CHANGELOG.md`, and `.tegami/publish-lock.yaml`.

## Changelog entries

Read `docs/releasing.md` and the `manage-solzero-releases` skill before choosing a version or
writing an entry.

A user-visible change adds one Markdown file under `.tegami/`. The frontmatter `packages` map
targets `release:solzero` with `patch`, `minor`, or `major`. The heading and body describe the
outcome for users and operators.

A change with no observable effect uses the `release:none` label. The pull request explains why
it has no `.tegami/` entry.

## Native API

Add Tegami behavior in `scripts/tegami.mts` by passing plugins to `tegami()`. Keep version and
publish work on the `runCli` commands above.
