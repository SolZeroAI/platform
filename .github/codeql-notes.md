# CodeQL

Code scanning uses advanced setup in `.github/workflows/codeql.yml`.

The workflow runs on:

- `push` to `master`
- `pull_request` to `master`
- `merge_group` with type `checks_requested`, for base branch `master`
- a weekly schedule, `32 8 * * 1`

Check contexts:

- `Analyze (javascript-typescript)`, job `analyze-javascript-typescript`
- `Analyze (actions)`, job `analyze-actions`
- `CodeQL`, posted by the code scanning app when the analysis upload finishes

The job names are fixed strings. They match the previous default-setup contexts. They do not come from a matrix value.

Disable default setup (`dynamic/github-code-scanning/codeql`) before this workflow uploads results. Default setup has no `merge_group` trigger. GitHub rejects advanced setup uploads while default setup is enabled.

```sh
gh api -X PATCH /repos/SolZeroAI/platform/code-scanning/default-setup -f state=not-configured
```

## Earlier default-setup failure

Default setup ran on master pushes before this workflow. On 2026-09-13 after #40 (`cc772d5`), Analyze (javascript-typescript) failed once with improved incremental analysis / possible disk space. GitHub records that failure in the Actions cache so the next analysis skips improved incremental. Analyze (actions) failed during SARIF upload on the same run with no open code-scanning alerts.

`gh run rerun` for that run returned HTTP 500; default setup has no `workflow_dispatch`. This notes file was used to re-trigger a clean master CodeQL pass.

Second re-trigger 2026-09-13T09:56Z: prior master Push run 34748722747 cannot be rerun (SARIF upload Server Error on Analyze actions).
