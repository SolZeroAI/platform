# Wrangler, D1, And R2 Reference

## Auth

Wrangler remote commands need auth in non-interactive shells. Load `config/.env` without echoing values:

```bash
set -a
source config/.env
set +a
nub exec wrangler whoami
```

If `wrangler` reports `Failed to fetch auth token`, `Not logged in`, or says `CLOUDFLARE_API_TOKEN` is required, stop and fix auth before retrying remote commands.

## Resource Discovery

In c0, inspect infra code before naming resources:

```bash
rg -n "D1Database|R2Bucket|observability|Worker\(" apps packages -S
```

For c0 pre, the common resource names are:

- Worker: `c0-api-pre`
- D1: `c0-db-pre`
- Workflow artifacts bucket: `c0-workflow-artifacts-pre`

These are stage-specific. Re-check before using another stage.

## D1 Read Queries

Use `--remote --json` for deployed state:

```bash
nub exec wrangler d1 execute c0-db-pre --remote --json --command \
"select id,user_id,name,status,manifest_version,manifest_key,code_key from workflows where id='wf_...';"
```

Workflow registration check:

```bash
nub exec wrangler d1 execute c0-db-pre --remote --json --command \
"select node_id,workflow_version,enabled from workflow_slack_trigger_registrations where workflow_id='wf_...' order by node_id;"
```

Latest runs:

```bash
nub exec wrangler d1 execute c0-db-pre --remote --json --command \
"select id,status,trigger_node_id,workflow_version,error,started_at,completed_at from workflow_runs where workflow_id='wf_...' order by started_at desc limit 10;"
```

Run events:

```bash
nub exec wrangler d1 execute c0-db-pre --remote --json --command \
"select sequence,node_id,event_type,level,message,data_json from workflow_run_events where run_id='wfr_...' order by sequence;"
```

Prefer read queries while diagnosing. For updates, use guarded predicates such as `where id='wf_...' and manifest_version=6` and verify changed row counts.

## R2 Artifact Readback

Get a workflow manifest:

```bash
nub exec wrangler r2 object get \
"c0-workflow-artifacts-pre/<user-id>/workflows/<workflow-id>/v<version>/manifest.json" \
--file /tmp/workflow-manifest.json
```

Get compiled code:

```bash
nub exec wrangler r2 object get \
"c0-workflow-artifacts-pre/<user-id>/workflows/<workflow-id>/v<version>/workflow.js" \
--file /tmp/workflow.js
```

Upload only after you have local validation and a rollback path:

```bash
nub exec wrangler r2 object put \
"c0-workflow-artifacts-pre/<user-id>/workflows/<workflow-id>/v<next>/manifest.json" \
--file /tmp/workflow-manifest-vnext.json \
--content-type application/json
```

```bash
nub exec wrangler r2 object put \
"c0-workflow-artifacts-pre/<user-id>/workflows/<workflow-id>/v<next>/workflow.js" \
--file /tmp/workflow-vnext.js \
--content-type application/javascript
```

## Safety

- Never print tokens, authorization headers, cookies, Slack payload secrets, or raw custom MCP definitions.
- Do not run destructive Wrangler commands unless the user explicitly approved the exact operation.
- Record exact commands that changed deployed state in the final report.
