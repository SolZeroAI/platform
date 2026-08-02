import { WebClient } from "@slack/web-api"
import { getStageMetadataSync } from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type { ApiEnv } from "infra/types/env"
import type { AppContext } from "./types"
import { toError } from "./effect-errors"

function logSlackDelivery(isError: boolean, message: string, context: string) {
  const log = Match.value(isError).pipe(
    Match.when(true, () => Effect.logError(message)),
    Match.orElse(() => Effect.logInfo(message)),
  )
  return log.pipe(Effect.annotateLogs({ context }))
}

function postSlackNotification(input: {
  cfEnv: ApiEnv
  title: string
  titleContext: string
  message: string
  rawMessage: string
  slackChannel: string
  stageTag: string
  serverUrl: string
}) {
  const client = new WebClient(input.cfEnv.SLACK_TOKEN)
  return Effect.tryPromise({
    try: () =>
      client.chat.postMessage({
        channel: input.slackChannel,
        // `text` is used in places where the content cannot be rendered such as: system push notifications, assistive technology such as screen readers, etc.
        text: input.rawMessage,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `${input.title} (${input.stageTag})`,
            },
          },
          {
            type: "context",
            elements: [
              {
                text: input.titleContext,
                type: "mrkdwn",
              },
            ],
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: input.message,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Logs",
                  emoji: true,
                },
                url: `https://dash.cloudflare.com/${input.cfEnv.CLOUDFLARE_ACCOUNT_ID}/workers/services/view/${input.cfEnv.WORKER_NAME}/production/observability/logs?view=events`,
                style: "primary",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "API Dashboard",
                  emoji: true,
                },
                url: `${input.serverUrl}/reference`,
              },
            ],
          },
        ],
      }),
    catch: toError,
  })
}

export const sendMessage = (
  c: AppContext,
  title: string,
  titleContext: string,
  message: string,
  extraContext: string,
  isError = false,
) => {
  c.executionCtx.waitUntil(
    // oxlint-disable-next-line effect/effect-run-in-body -- executionCtx.waitUntil requires a Promise for this background Slack-delivery boundary.
    Effect.runPromise(_sendMessage(c.env, title, titleContext, message, extraContext, isError)),
  )
}

const _sendMessage = Effect.fn("slack.sendMessage")(function* (
  cfEnv: ApiEnv,
  title: string,
  titleContext: string,
  message: string,
  extraContext: string,
  isError = false,
) {
  const rawMessage = `${titleContext}: ${message}`
  yield* logSlackDelivery(isError, rawMessage, extraContext)

  const stageMetadata = getStageMetadataSync(cfEnv)
  yield* Match.value(stageMetadata.app.sendSlackNotifications).pipe(
    Match.when(true, () =>
      postSlackNotification({
        cfEnv,
        title,
        titleContext,
        message,
        rawMessage,
        slackChannel: stageMetadata.app.slackChannel,
        stageTag: stageMetadata._tag,
        serverUrl: stageMetadata.infra.serverUrl,
      }),
    ),
    Match.orElse(() =>
      Effect.logInfo("Skipping Slack notification because sendSlackNotifications is false"),
    ),
  )
})
