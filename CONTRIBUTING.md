# Contributing to SolZero

This repository is the SolZero platform: [github.com/SolZeroAI/platform](https://github.com/SolZeroAI/platform).

SolZero is a platform you deploy as one package to Cloudflare. It includes a custom Agent built for
latency, cost, and capability, an agentic Workflow builder, always-on bots in the same class as a
Grok Bot, and the Codex, Grok, and Claude Code harnesses. Read the [README](README.md) for the
product picture and local setup.

Contributions from organizations and individual users are welcome.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For substantial changes, open an issue first so maintainers and contributors can align on the
  problem and approach.
- Report suspected vulnerabilities through the process in [SECURITY.md](SECURITY.md), not through a
  public issue.

## Development setup

SolZero requires Node.js 24.15 and Nub 0.4.11. Follow the complete onboarding instructions in the
[README](README.md#get-started), then install dependencies from the repository root:

```sh
nub install --frozen-lockfile
```

Create a focused branch, keep changes scoped, and add or update tests for behavior changes.

## Release notes

Add a Markdown file under `.tegami/` when a change affects a user, administrator, or deployment
operator. Target `release:solzero` in its frontmatter and choose the version change described in
[the release guide](docs/releasing.md). Run `nub run tegami` to create an entry interactively.

For internal maintenance with no observable effect, explain that choice in the pull request and apply
the `release:none` label.

## Validation

Run the repository checks before opening a pull request:

```sh
nub run config:check
nub run typecheck
nub run lint
nub run format
nub run test
nub run build
```

`nub run lint` runs Oxlint with `s0-lint`, `@mpsuesser/oxlint-plugin-effect`, and
`anti-slop` from `github:dmmulroy/anti-slop`. This repository also enables the opt-in
`anti-slop-effect` plugin because the workspace depends on Effect. Those anti-slop rules
run at `warn`. Lint loads the GitHub package through `tsx` because that package ships
TypeScript source.

GitHub Actions on SolZeroAI/platform runs `config:check`, `typecheck`, `lint`, `format`, and actionlint.
Tests that need Cloudflare tokens and Deploy Preview skip on this public repository
(`github.repository != 'SolZeroAI/platform'`). Keep `preview.yml` as valid YAML and disable it here
with Actions → Deploy Preview → Disable workflow (`gh workflow disable preview.yml`). Disabled state
is per-repo. Fork owners enable it on their Actions page. GitHub disables scheduled workflows on
public forks by default. Do not comment the workflow YAML out.

If a check cannot run in your environment, explain why in the pull request.

## Pull requests

A strong pull request includes:

- A concise explanation of the problem and solution
- Tests or a clear explanation of why tests are not needed
- Documentation and config example updates when behavior or configuration changes
- A `.tegami/` release entry, or a `release:none` explanation
- No credentials, private data, internal URLs, or organization-specific defaults
- Updates to `THIRD_PARTY_NOTICES.md` when third-party code or separately licensed assets are added

By submitting a contribution, you agree that it may be distributed under the repository's
LGPL-3.0-only license and that you have the right to contribute it.
