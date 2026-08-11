# Contributing to SolZero

Thank you for helping improve SolZero. Contributions from organizations and individual users are welcome.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For substantial changes, open an issue first so maintainers and contributors can align on the
  problem and approach.
- Report suspected vulnerabilities through the process in [SECURITY.md](SECURITY.md), not through a
  public issue.

## Development setup

SolZero requires Node.js 24.15 and Nub 0.4.11. Follow the complete onboarding instructions in the
[README](README.md#getting-started), then install dependencies from the repository root:

```sh
nub install --frozen-lockfile
```

Create a focused branch, keep changes scoped, and add or update tests for behavior changes.

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

If a check cannot run in your environment, explain why in the pull request.

## Pull requests

A strong pull request includes:

- A concise explanation of the problem and solution
- Tests or a clear explanation of why tests are not needed
- Documentation and config example updates when behavior or configuration changes
- No credentials, private data, internal URLs, or organization-specific defaults
- Updates to `THIRD_PARTY_NOTICES.md` when third-party code or separately licensed assets are added

By submitting a contribution, you agree that it may be distributed under the repository's
LGPL-3.0-only license and that you have the right to contribute it.
