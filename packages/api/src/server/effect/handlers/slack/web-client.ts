import { WebClient } from "@slack/web-api"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { ApiEnv } from "infra/types/env"
import { toError } from "../../../lib/effect-errors"

export interface SlackThreadMessage {
  user?: string
  username?: string
  bot_id?: string
  text?: string
  ts?: string
}

export interface SlackThreadRepliesResponse {
  ok?: boolean
  error?: string
  messages?: SlackThreadMessage[]
}

function warnSlackSkipped(message: string) {
  return Effect.logWarning(message)
}

function slackToken(env: ApiEnv) {
  return Option.fromNullishOr(env.SLACK_TOKEN).pipe(Option.filter((token) => token.length > 0))
}

function slackTokenEffect(env: ApiEnv) {
  return Effect.fromOption(slackToken(env))
}

function fetchSlackThreadRepliesWithToken(token: string, channelId: string, threadTs: string) {
  const client = new WebClient(token)
  return Effect.tryPromise({
    try: () =>
      client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 20,
        inclusive: true,
      }),
    catch: toError,
  }).pipe(Effect.map((response) => response as SlackThreadRepliesResponse))
}

export function fetchSlackThreadReplies(env: ApiEnv, channelId: string, threadTs: string) {
  return slackTokenEffect(env).pipe(
    Effect.flatMap((token) => fetchSlackThreadRepliesWithToken(token, channelId, threadTs)),
    Effect.catchTag("NoSuchElementError", () =>
      warnSlackSkipped(
        "Skipping Slack thread context fetch because SLACK_TOKEN is not configured",
      ).pipe(Effect.map(() => null)),
    ),
  )
}

function postSlackMessageWithToken(
  token: string,
  input: { channel: string; threadTs?: string; text: string },
) {
  const client = new WebClient(token)
  return Effect.tryPromise({
    try: () =>
      client.chat.postMessage({
        channel: input.channel,
        thread_ts: input.threadTs,
        text: input.text,
        unfurl_links: false,
        unfurl_media: false,
      }),
    catch: toError,
  }).pipe(Effect.asVoid)
}

export function postSlackMessage(
  env: ApiEnv,
  input: { channel: string; threadTs?: string; text: string },
) {
  return slackTokenEffect(env).pipe(
    Effect.flatMap((token) => postSlackMessageWithToken(token, input)),
    Effect.catchTag("NoSuchElementError", () =>
      warnSlackSkipped("Skipping Slack message because SLACK_TOKEN is not configured").pipe(
        Effect.asVoid,
      ),
    ),
  )
}

function postSlackEphemeralWithToken(
  token: string,
  input: { channel: string; user: string; text: string },
) {
  const client = new WebClient(token)
  return Effect.tryPromise({
    try: () =>
      client.chat.postEphemeral({
        channel: input.channel,
        user: input.user,
        text: input.text,
      }),
    catch: toError,
  }).pipe(Effect.asVoid)
}

export function postSlackEphemeral(
  env: ApiEnv,
  input: { channel: string; user: string; text: string },
) {
  return slackTokenEffect(env).pipe(
    Effect.flatMap((token) => postSlackEphemeralWithToken(token, input)),
    Effect.catchTag("NoSuchElementError", () =>
      warnSlackSkipped(
        "Skipping Slack ephemeral message because SLACK_TOKEN is not configured",
      ).pipe(Effect.asVoid),
    ),
  )
}

function addSlackReactionWithToken(
  token: string,
  input: { channel: string; timestamp: string; name: string },
) {
  const client = new WebClient(token)
  return Effect.tryPromise({
    try: () =>
      client.reactions.add({
        channel: input.channel,
        timestamp: input.timestamp,
        name: input.name,
      }),
    catch: toError,
  }).pipe(Effect.asVoid)
}

export function addSlackReaction(
  env: ApiEnv,
  input: { channel: string; timestamp: string; name: string },
) {
  return slackTokenEffect(env).pipe(
    Effect.flatMap((token) => addSlackReactionWithToken(token, input)),
    Effect.catchTag("NoSuchElementError", () =>
      warnSlackSkipped("Skipping Slack reaction because SLACK_TOKEN is not configured").pipe(
        Effect.asVoid,
      ),
    ),
  )
}
