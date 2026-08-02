# cf_observability Reference

## Query Discipline

Prefer narrow absolute UTC windows and low limits. Broad Workers Observability queries can return very large payloads.

Recommended first query:

```json
{
  "keysQuery": {
    "datasets": ["cloudflare-workers"],
    "filters": [
      {
        "key": "$metadata.service",
        "operation": "eq",
        "type": "string",
        "value": "c0-api-pre"
      }
    ],
    "limit": 100,
    "timeframe": {
      "from": "2026-06-30T19:15:00Z",
      "to": "2026-06-30T21:15:00Z"
    }
  }
}
```

Then query events by path or message:

```json
{
  "query": {
    "view": "events",
    "queryId": "workers-logs-events",
    "limit": 20,
    "parameters": {
      "datasets": ["cloudflare-workers"],
      "filters": [
        {
          "key": "$metadata.service",
          "operation": "eq",
          "type": "string",
          "value": "c0-api-pre"
        },
        {
          "key": "$workers.event.request.path",
          "operation": "includes",
          "type": "string",
          "value": "/workflows/slack-apps/"
        }
      ],
      "orderBy": { "value": "timestamp", "order": "desc" }
    },
    "timeframe": {
      "from": "2026-06-30T20:45:00Z",
      "to": "2026-06-30T21:00:00Z"
    }
  }
}
```

Search for specific error text in `message`:

```json
{
  "query": {
    "view": "events",
    "queryId": "workers-logs-events",
    "limit": 10,
    "parameters": {
      "datasets": ["cloudflare-workers"],
      "filters": [
        {
          "key": "$metadata.service",
          "operation": "eq",
          "type": "string",
          "value": "c0-api-pre"
        },
        {
          "key": "message",
          "operation": "includes",
          "type": "string",
          "value": "invalid_arguments"
        }
      ]
    },
    "timeframe": {
      "from": "2026-06-30T19:15:00Z",
      "to": "2026-06-30T21:15:00Z"
    }
  }
}
```

## Fields That Usually Matter

- `$metadata.service`: Worker script name.
- `$metadata.requestId`: Cloudflare request id; use it to group logs from the same invocation.
- `$metadata.traceId`: useful only if populated.
- `annotations.trace.id`: app-propagated trace id when present.
- `$workers.event.request.path`: ingress path.
- `$workers.event.request.url`: full request URL.
- `$workers.outcome`: Worker outcome.
- `message`: Effect/console log payload.
- `annotations.event`: structured app event name when exported as an annotation.

## Known Failure Modes

- `workers_get_worker({ scriptName })` may fail with a generic Cloudflare API error while observability queries still work. Continue with `observability_keys` and `query_worker_observability`.
- Relative timeframes can be rejected depending on format. If `offset` fails, switch to absolute `{ "from", "to" }`.
- A user-provided trace id may not appear in `$metadata.traceId` or `annotations.trace.id`. Fall back to path, request id, message text, and durable state.
- Logs can prove routing but still omit the terminal failure if the code only persisted the error in D1. Check persistent run/session tables before concluding no error happened.
- A successful Worker `outcome:"ok"` does not mean the downstream workflow succeeded. It can mean the webhook accepted the event and work continued asynchronously.

## Good Query Sequence

1. `observability_keys` scoped by `$metadata.service`.
2. Path query for the ingress surface.
3. Message query for domain log names or error strings.
4. Request-id query for one invocation:

```json
{
  "key": "$metadata.requestId",
  "operation": "eq",
  "type": "string",
  "value": "a1400f3f1ff14ba9"
}
```

5. D1/R2 readback for async or durable effects.
