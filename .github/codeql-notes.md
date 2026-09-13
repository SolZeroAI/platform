# CodeQL notes

Default GitHub CodeQL setup (`dynamic/github-code-scanning/codeql`) runs on master pushes.

On 2026-09-13 after #40 (`cc772d5`), Analyze (javascript-typescript) failed once with improved incremental analysis / possible disk space. GitHub records that failure in the Actions cache so the next analysis skips improved incremental. Analyze (actions) failed during SARIF upload on the same run with no open code-scanning alerts.

`gh run rerun` for that run returned HTTP 500; default CodeQL has no `workflow_dispatch`. This no-op notes file exists to re-trigger a clean master CodeQL pass.
