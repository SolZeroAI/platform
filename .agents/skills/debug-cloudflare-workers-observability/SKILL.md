---
name: debug-cloudflare-workers-observability
description: Debug deployed Cloudflare Workers using the cf_observability MCP, Wrangler, D1/R2 state, repo evidence, and safe live reproduction. Use for preview/prod runtime incidents involving missing or incomplete logs/traces, webhook delivery, Worker request routing, Workflow runs/events/artifacts, Slack app integrations, Slack API errors such as invalid_arguments, duplicate responses, or cases where the user asks to use Cloudflare Worker Observability or cf_observability to debug c0 behavior.
---

# Debug Cloudflare Workers Observability

Use this as an evidence-first debugging loop for deployed Workers. Start broad enough to prove the request reached the Worker, then narrow through structured logs, durable state, and the owning code boundary.

## Core Loop

1. Bound the incident: stage, Worker script name, user-facing URL/path, approximate UTC window, IDs already known, and what safe live action is allowed.
2. Read the repo surface that defines the runtime: Worker name, route, bindings, D1/R2 names, feature flags, and existing observability helpers.
3. Query deployed observability before guessing from code. Use the `cf_observability` MCP when available; otherwise pivot to Wrangler, D1/R2, app UI, and local reproduction.
4. Cross-check durable state. Logs often prove ingress and routing; D1/R2 usually prove workflow/run/session/artifact state.
5. Reproduce with the smallest safe action only after the path and target environment are clear.
6. Patch the owning boundary. Prefer structured Effect logs/spans/request observers already used by the repo. Do not add noisy catch-all logs or log raw payloads/secrets.
7. Validate locally, deploy only when allowed, then close the loop with a new deployed query and durable-state readback.

## cf_observability First Pass

Use `tool_search` to expose `cf_observability` if its tools are not already loaded.

Start with `observability_keys` scoped to the Worker and an absolute ISO timeframe. Avoid relative windows unless you have verified the MCP accepts that exact format.

Common useful fields:

- `$metadata.service`: Worker script name, such as `c0-api-pre`.
- `$workers.event.request.path`: request path for ingress routing.
- `$metadata.requestId`: Cloudflare request correlation within one invocation.
- `$metadata.traceId` and `annotations.trace.id`: useful when populated, but do not assume they are searchable.
- `message`: structured log text and embedded JSON.
- `annotations.*`: app-specific metadata from Effect logs/spans.

Load [references/cf-observability.md](references/cf-observability.md) for query JSON, known failure modes, and examples.

## Wrangler And State

Before any remote Wrangler work, verify auth without printing secrets:

```bash
set -a
source config/.env
set +a
nub exec wrangler whoami
```

For c0, derive resource names from infra code instead of guessing. In the current pattern, pre resources include `c0-db-pre` and `c0-workflow-artifacts-pre`.

Use D1 for durable truth about runs, registrations, sessions, and configuration. Use R2 for workflow artifacts and generated code. Avoid destructive commands unless the user explicitly approved them.

Load [references/wrangler-d1-r2.md](references/wrangler-d1-r2.md) for command shapes.

## Domain Sections

### Workflows

Use this section when debugging c0 Workflow triggers, workflow overview rows, run failures, node outputs, generated workflow artifacts, or mismatches between the UI and runtime behavior.

Primary evidence order:

1. Observability ingress/routing logs.
2. `workflows`, `workflow_runs`, and `workflow_run_events` D1 rows.
3. Workflow manifest/code artifacts in R2.
4. Compiled workflow and node implementation code.

Load [references/workflows.md](references/workflows.md) for D1 queries, artifact inspection, safe manifest version updates, and how to reason about workflow error logging.

### Slack Integration

Use this section when debugging Slack webhook delivery, app mentions, keyword triggers, slash commands, Slack API errors, duplicate Slack replies, or Slack app setup.

Primary evidence order:

1. Query Worker logs for `/workflows/slack-apps/` ingress.
2. Confirm channel hydration, registration listing/filtering, matched trigger nodes, and run count.
3. Use D1 run events to decide whether Slack posted once or the workflow/model produced duplicated text.
4. Use browser/Slack only in an explicitly authorized channel, and only after backend targeting is clear.

Load [references/slack-integration.md](references/slack-integration.md) for Slack-specific log names, safe test flow, and `invalid_arguments` debugging notes.

## Reporting

Report the investigation as evidence, not vibes:

- What reached the Worker and how you know.
- Which query or command proved each hop.
- Which query failed or produced incomplete evidence.
- What durable state said.
- The exact owning boundary patched.
- Validation, deploy, and post-deploy readback.
