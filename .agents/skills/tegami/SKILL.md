---
name: tegami
description: >-
  Version and publish with Tegami. Use when a project depends on the tegami
  package, has a .tegami directory, or runs a tegami script. Covers the
  library API, CLI commands, and changelog files.
---

# Use Tegami

Tegami versions packages from changelog files and publishes from a publish lock. Configure it with the `tegami` package. Drive the CLI through `runCli`.

## Configure

```ts
import { tegami } from "tegami"
import { runCli } from "tegami/cli"
import { github } from "tegami/plugins/github"

const release = tegami({
  npm: { client: "nub" },
  plugins: [github({ repo: "owner/name" })],
})

await runCli(release)
```

Read the project's Tegami config before changing release behavior. Keep version pull requests, tags, and publish steps in that config and its plugins. Plugin entry points include `tegami/plugins/github`, `tegami/plugins/git`, `tegami/plugins/gitlab`, `tegami/plugins/cargo`, and `tegami/plugins/go`. Set `npm.client` to the repository's package manager.

## Commands

Run the project's Tegami script. With nub, that is `nub run tegami`.

| Command | What it does |
| --- | --- |
| *(none)* | Create changelog files interactively |
| `version` | Apply pending changelogs and write the publish lock |
| `ci` | Version when changelogs are pending; otherwise publish from the lock |
| `publish` | Publish packages recorded in the lock. `--dry-run` validates and does not publish |
| `check-publish` | Exit 0 when a publish is pending, and 1 otherwise |
| `cleanup` | Remove the publish lock after every package is published |
| `init-agent` | Append changelog instructions to `AGENTS.md` |

Tegami writes `CHANGELOG.md` and the publish lock. Leave those files for Tegami to update.

## Changelog files

Pending notes live in `.tegami/` unless `changelogDir` says otherwise. Each file has YAML frontmatter and at least one `#`, `##`, or `###` heading. The changelog format is documented at https://tegami.fuma-nama.dev/changelog.

Explicit bump:

```md
---
packages:
  "npm:my-pkg":
    type: patch
---

## What changed

One paragraph a user of the package can read.
```

`type` is `major`, `minor`, or `patch`. A short form is also valid: `"@scope/name": patch`.

Implicit style lists packages and takes the bump from heading depth: `#` is major, `##` is minor, and `###` is patch. Every listed package receives the highest bump in the file.

A `packages` value is a package name, a package id such as `npm:name`, or a group such as `group:name`.

A private package is versioned. Tegami does not publish it to npm. Leave `package.json` versions and git tags to the Tegami run. When the repository's contributing guide says a change has no release, follow that guide and skip the changelog file.
