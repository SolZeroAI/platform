# Slack Integration Debugging Reference

## First Question

Prove whether Slack reached the Worker. Query `/workflows/slack-apps/` on the API Worker before debugging workflow internals or Slack app settings.

Useful log names:

- `slack.hydrate.start`
- `slack.hydrate.response`
- `slack.hydrate.result`
- `slack.dispatch`
- `slack.registrations.listed`
- `slack.registration.filtered`
- `slack.registrations.matched`
- `slack.response`

Interpretation:

- `slack.hydrate.response` with `slackOk:false` means Slack API/channel hydration failed.
- `slack.registrations.listed` proves trigger registrations were loaded.
- `slack.registration.filtered` explains why a registration did not match. Look at event type, surface, channel pattern, keyword rules, and command/action IDs.
- `slack.registrations.matched` proves which workflow trigger nodes should run.
- `slack.response` with `runCount` and statuses proves dispatch output, not necessarily async workflow completion.

## Common Query

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
      "from": "<utc-start>",
      "to": "<utc-end>"
    }
  }
}
```

## `invalid_arguments`

For Slack Web API methods, verify the expected transport shape. Some read methods such as `conversations.info` and `conversations.replies` are safest as GET/query-parameter requests. If the code sends JSON POST and Slack returns HTTP 200 with `{ ok:false, error:"invalid_arguments" }`, log the Slack error and response messages, then patch the Slack API call shape at the node or hydration boundary.

Log useful context:

- channel id
- status
- `slackOk`
- `slackError`
- response messages when Slack provides them
- whether a channel name was hydrated

Do not log bot tokens, auth headers, raw request bodies, or full event payloads.

## App Mention And Keyword Triggers

For app mentions:

- Expected Slack event type is usually `app_mention`.
- Confirm `incident_question` or equivalent trigger matched.
- If the bot should acknowledge without sending text, add or verify a `slack-add-reaction` node connected from trigger `channelId` and `messageTs`.

For keyword triggers:

- Expected Slack event type is usually `message`.
- Confirm keyword rules and channel pattern in `slack.registration.filtered`.
- Use D1 run events to distinguish no match, match with failed run, and match with duplicated upstream output.

## Safe Live Testing

Use Slack/browser only if the user explicitly authorizes the channel. Send one clear test message containing a timestamp or unique token. After sending:

1. Query observability for webhook ingress.
2. Query D1 latest runs for the workflow.
3. Query run events for node outputs and Slack API side effects.
4. Inspect Slack UI only for final user-visible confirmation.

## Slack Duplicate Response Checklist

1. Count webhook events for the message time window.
2. Count workflow runs for the trigger node.
3. Count Slack send node completions.
4. Inspect the send node text input.
5. Inspect upstream isolate/model output.

One run plus one Slack send means Slack did not duplicate the response. If the text is already duplicated before the send node, debug the upstream model/session node or prompt.
