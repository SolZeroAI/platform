# c0 Workflows Debugging Reference

## Evidence Order

1. Worker ingress logs: prove the request reached the deployed Worker and which route handled it.
2. Workflow registration/routing logs: prove the expected trigger matched.
3. D1 workflow rows: prove runs, events, status, and node-level inputs/outputs.
4. R2 artifacts: prove which manifest/code version the runtime used.
5. Node implementation: patch the owning node or boundary, not a downstream symptom.

## D1 Tables To Check

- `workflows`: current manifest version and artifact keys.
- `workflow_runs`: run status, trigger node, version, error.
- `workflow_run_events`: node start/completion/failure, inputs, outputs, and persisted terminal failures.
- `workflow_slack_trigger_registrations`: Slack trigger nodes registered for a workflow and version.

Use run events to answer questions like:

- Did a run exist?
- Which trigger node started it?
- Which node failed?
- Did a Slack send node post once?
- Was duplicated text already present before Slack posting?
- Did a reaction or side effect return `ok:true`?

## Error Logging Gap Pattern

Dynamic workflow artifacts may catch a node failure, call `actions.recordWorkflowEvent(...)` with `level:"error"` and `eventType:"run_failed"`, call `completeWorkflowRun(...)`, then rethrow. If `recordWorkflowEvent` persists to D1 without an attached request logger, the UI/D1 can show the failure while Cloudflare Worker logs do not show a clear error.

Fix this at the workflow action boundary:

- Pass the request logger into the action executor.
- Emit a sanitized structured error log for error-level workflow events.
- Include workflow id, run id, node id/type/label, event type, and sanitized error text.
- Do not log raw event data, trigger payloads, headers, tokens, or cookies.

Good marker names are stable, queryable strings such as `workflowRunEventError`.

## Existing Workflow Artifact Update Pattern

Template changes only affect newly-created workflows. Existing workflows need their stored manifest/code artifacts updated, or they keep running the old version.

Safe update sequence:

1. Read the workflow row from D1 and record current `manifest_version`, `manifest_key`, and `code_key`.
2. Download the current manifest and code from R2.
3. Generate a new manifest version locally from the current manifest, not from memory.
4. Compile workflow code with the repo compiler.
5. Upload new artifacts under `v<next>`.
6. Update the `workflows` row with a guarded predicate on the old version.
7. Update trigger registrations to the new workflow version when the trigger manifest changed.
8. Read back D1 and R2 to prove the new version is active.

Example guarded update shape:

```sql
update workflows
set manifest_version = 7,
    manifest_key = '<user-id>/workflows/<workflow-id>/v7/manifest.json',
    code_key = '<user-id>/workflows/<workflow-id>/v7/workflow.js',
    updated_at = unixepoch() * 1000
where id = '<workflow-id>' and manifest_version = 6;
```

Then update registrations:

```sql
update workflow_slack_trigger_registrations
set workflow_version = 7
where workflow_id = '<workflow-id>' and enabled = 1;
```

## Duplicate Response Diagnosis

Do not assume Slack duplicated a response. Check:

1. Number of workflow runs for the trigger message.
2. Number of `slack-send-message` node completions.
3. The text input to the Slack send node.
4. The upstream model/session node output.

If one run and one Slack post exist, but the send node input already contains duplicated text, the duplication happened upstream of Slack posting.

## Validation

For code changes in c0, follow repo validation:

```bash
nub run format
nub run typecheck
nub run lint
```

Use focused workflow tests while iterating, then run root checks before handoff.
