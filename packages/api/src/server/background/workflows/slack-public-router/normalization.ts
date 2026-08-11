import { getWebUrl } from "@solzero/shared"
import { toError } from "../../../lib/effect-errors"
import type {
  WorkflowSlackAppStorePromise,
  WorkflowSlackTriggerRegistrationRecord,
} from "../../db/workflow-slack-apps"
import { createWorkflowStoreFromD1 } from "../../db/workflows"
import type { Env } from "../../types"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { log } from "./log"

const SLACK_SIGNATURE_VERSION = "v0"
const SLACK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60
const EVENTS_PATTERN = /^\/workflows\/slack-apps\/(?<appId>[^/]+)\/events$/
const COMMANDS_PATTERN = /^\/workflows\/slack-apps\/(?<appId>[^/]+)\/commands\/(?<commandId>[^/]+)$/
const INTERACTIONS_PATTERN = /^\/workflows\/slack-apps\/(?<appId>[^/]+)\/interactions$/

export type SlackSurface = "event" | "command" | "interaction"

export interface SlackRouteMatch {
  appId: string
  surface: SlackSurface
  commandId?: string
}

export interface NormalizedSlackPayload {
  surface: SlackSurface
  deliveryKey: string
  teamId: string | null
  channelId: string | null
  channelName: string | null
  channelType: string | null
  userId: string | null
  text: string
  eventType: string | null
  command: string | null
  messageTs: string | null
  threadTs: string | null
  triggerId: string | null
  actionId: string | null
  responseUrl: string | null
  rawPayload: Record<string, unknown>
}

export interface NormalizedSlackResult {
  payload: NormalizedSlackPayload | null
  response: Response | null
}

interface SlackEventEnvelope {
  type?: string
  challenge?: string
  team_id?: string
  event_id?: string
  event?: Record<string, unknown>
}

export type SlackRunResult = {
  runId?: string
  workflowId: string
  nodeId: string
  status: string
  error?: string
  setupUrl?: string
  slackUserId?: string
}

export type SlackRegistration = WorkflowSlackTriggerRegistrationRecord
export type SlackDelivery = Awaited<
  ReturnType<WorkflowSlackAppStorePromise["createDeliveryIfAbsent"]>
>

export interface SlackRequestOptions {
  setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
}

export interface SlackAppContext {
  request: Request
  env: Env
  options: SlackRequestOptions
  route: SlackRouteMatch
  secrets: { signingSecret: string | null; botToken: string | null }
}

export interface ProcessSlackRegistrationInput {
  env: Env
  appId: string
  payload: NormalizedSlackPayload
  commandId?: string
  registration: SlackRegistration
  actor: SlackWorkflowActor
  setUserIdentity?: (identity: { userId: string; oktaUserId: string | null }) => void
}

export interface ProcessDeliveryParams {
  input: ProcessSlackRegistrationInput
  slackStore: WorkflowSlackAppStorePromise
  workflowStore: ReturnType<typeof createWorkflowStoreFromD1>
  delivery: SlackDelivery
  now: number
}

export interface MatchRegistrationInput {
  payload: NormalizedSlackPayload
  registration: SlackRegistration
  commandId?: string
}

export type SlackWorkflowActor =
  | { _tag: "workflow_owner" }
  | { _tag: "slack_user"; userId: string; oktaUserId: string | null }

export type SlackWorkflowActorResolution =
  | SlackWorkflowActor
  | { _tag: "setup_required"; slackUserId: string; setupUrl: string }
  | { _tag: "missing_slack_user" }

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return Match.value(isRecord(value)).pipe(
    Match.when(true, () => value as Record<string, unknown>),
    Match.orElse(() => ({}) as Record<string, unknown>),
  )
}

function readString(value: unknown): Option.Option<string> {
  return Match.value(value).pipe(
    Match.when(Match.string, (resolved) =>
      Option.filter(Option.some(resolved.trim()), (trimmed) => trimmed.length > 0),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

function slackResponseMessages(data: Record<string, unknown> | null): string[] {
  const metadata = data?.response_metadata
  return Match.value(isRecord(metadata) && Array.isArray(metadata.messages)).pipe(
    Match.when(false, () => []),
    Match.orElse(() =>
      (metadata as { messages: unknown[] }).messages.reduce<string[]>(
        (messages, value) =>
          Option.match(readString(value), {
            onNone: () => messages,
            onSome: (message) => [...messages, message],
          }),
        [],
      ),
    ),
  )
}

export function buildSetupUrl(env: Env, slackUserId: string): string {
  const baseUrl = getWebUrl(env).replace(/\/+$/, "")
  const params = new URLSearchParams({ slackUserId })
  return `${baseUrl}/settings?${params.toString()}`
}

function matchEventsRoute(pathname: string): Option.Option<SlackRouteMatch> {
  return Option.map(
    Option.fromNullishOr(pathname.match(EVENTS_PATTERN)?.groups?.appId),
    (appId) => ({ appId: decodeURIComponent(appId), surface: "event" as const }),
  )
}

function matchCommandsRoute(pathname: string): Option.Option<SlackRouteMatch> {
  return Option.map(
    Option.filter(Option.fromNullishOr(pathname.match(COMMANDS_PATTERN)?.groups), (groups) =>
      Boolean(groups.appId && groups.commandId),
    ),
    (groups) => ({
      appId: decodeURIComponent(groups.appId),
      commandId: decodeURIComponent(groups.commandId),
      surface: "command" as const,
    }),
  )
}

function matchInteractionsRoute(pathname: string): Option.Option<SlackRouteMatch> {
  return Option.map(
    Option.fromNullishOr(pathname.match(INTERACTIONS_PATTERN)?.groups?.appId),
    (appId) => ({ appId: decodeURIComponent(appId), surface: "interaction" as const }),
  )
}

export function readRouteMatch(pathname: string): Option.Option<SlackRouteMatch> {
  return Option.firstSomeOf([
    matchEventsRoute(pathname),
    matchCommandsRoute(pathname),
    matchInteractionsRoute(pathname),
  ])
}

const signHex = Effect.fn("workflows.slack.signHex")(function* (message: string, secret: string) {
  const encoder = new TextEncoder()
  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    catch: toError,
  })
  const signature = yield* Effect.tryPromise({
    try: () => crypto.subtle.sign("HMAC", key, encoder.encode(message)),
    catch: toError,
  })
  return Arr.join(
    Arr.map(Array.from(new Uint8Array(signature)), (byte) => byte.toString(16).padStart(2, "0")),
    "",
  )
})

function timingSafeEqual(left: string, right: string): boolean {
  return Match.value(left.length !== right.length).pipe(
    Match.when(true, () => false),
    Match.orElse(
      () =>
        Arr.reduce(
          Arr.makeBy(left.length, (index) => left.charCodeAt(index) ^ right.charCodeAt(index)),
          0,
          (accumulator, value) => accumulator | value,
        ) === 0,
    ),
  )
}

export const verifySlackSignatureHmac = Effect.fn("workflows.slack.verifySignatureHmac")(function* (
  input: { body: string; signingSecret: string },
  timestamp: string,
  signature: string,
) {
  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${input.body}`
  const expected = `${SLACK_SIGNATURE_VERSION}=${yield* signHex(baseString, input.signingSecret)}`
  return Match.value(timingSafeEqual(signature, expected)).pipe(
    Match.when(false, () => json({ error: "Invalid Slack request signature" }, 401)),
    Match.orElse(() => null as Response | null),
  )
})

export const verifySlackSignature = Effect.fn("workflows.slack.verifySignature")(function* (input: {
  request: Request
  body: string
  signingSecret: string
}) {
  const timestamp = input.request.headers.get("x-slack-request-timestamp") ?? ""
  const signature = input.request.headers.get("x-slack-signature") ?? ""
  const timestampSeconds = Number.parseInt(timestamp, 10)
  const validTimestamp =
    Number.isFinite(timestampSeconds) &&
    Math.abs(Date.now() / 1000 - timestampSeconds) <= SLACK_SIGNATURE_TOLERANCE_SECONDS
  return yield* Match.value(validTimestamp).pipe(
    Match.when(false, () =>
      Effect.succeed(json({ error: "Invalid Slack request timestamp" }, 401)),
    ),
    Match.orElse(() =>
      verifySlackSignatureHmac(
        { body: input.body, signingSecret: input.signingSecret },
        timestamp,
        signature,
      ),
    ),
  )
})

function sanitizeArrayItem(item: unknown): unknown {
  return Match.value(isRecord(item)).pipe(
    Match.when(true, () => sanitizeRawPayload(item as Record<string, unknown>)),
    Match.orElse(() => item),
  )
}

function sanitizeChild(child: unknown): unknown {
  return Match.value(child).pipe(
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> => isRecord(candidate),
      (record) => sanitizeRawPayload(record),
    ),
    Match.when(
      (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
      (array) => Arr.map(array, (item) => sanitizeArrayItem(item)),
    ),
    Match.orElse((other) => other),
  )
}

function sanitizeEntry(key: string, child: unknown): [string, unknown] {
  const normalizedKey = key.toLowerCase()
  return Match.value(
    normalizedKey.includes("token") ||
      normalizedKey === "authorization" ||
      normalizedKey === "response_url",
  ).pipe(
    Match.when(true, () => [key, "[redacted]"] as [string, unknown]),
    Match.orElse(() => [key, sanitizeChild(child)] as [string, unknown]),
  )
}

function sanitizeRawPayload(value: unknown): Record<string, unknown> {
  return Match.value(value).pipe(
    Match.when(
      (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
      (array) => ({ value: Arr.map(array, (item) => sanitizeRawPayload(item)) }),
    ),
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> => isRecord(candidate),
      (record) =>
        Object.fromEntries(
          Arr.map(Object.entries(record), ([key, child]) => sanitizeEntry(key, child)),
        ),
    ),
    Match.orElse(() => ({}) as Record<string, unknown>),
  )
}

const parseJsonBody = <T>(value: string) =>
  Effect.tryPromise({
    try: () => new Response(value).json() as Promise<T>,
    catch: () => null as T | null,
  })

const sha256Hex = Effect.fn("workflows.slack.sha256Hex")(function* (value: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    catch: toError,
  })
  return Arr.join(
    Arr.map(Array.from(new Uint8Array(digest)), (byte) => byte.toString(16).padStart(2, "0")),
    "",
  )
})

function slackChannelFromEvent(event: Record<string, unknown>): {
  id: string | null
  name: string | null
} {
  return Match.value(event.channel).pipe(
    Match.when(Match.string, (channel) => ({
      id: channel,
      name: Option.getOrNull(readString(event.channel_name)),
    })),
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> => isRecord(candidate),
      (channel) => ({
        id: Option.getOrNull(readString(channel.id)),
        name: Option.getOrNull(
          Option.orElse(readString(channel.name), () => readString(event.channel_name)),
        ),
      }),
    ),
    Match.orElse(() => ({
      id: Option.getOrNull(readString(event.channel_id)),
      name: Option.getOrNull(readString(event.channel_name)),
    })),
  )
}

const buildSlackEventPayload = Effect.fn("workflows.slack.buildEventPayload")(function* (
  envelope: SlackEventEnvelope,
  event: Record<string, unknown>,
  body: string,
) {
  const channel = slackChannelFromEvent(event)
  const userId = Option.getOrNull(
    Option.orElse(readString(event.user), () =>
      Match.value(event.channel).pipe(
        Match.when(
          (candidate: unknown): candidate is Record<string, unknown> => isRecord(candidate),
          (resolved) => readString(resolved.creator),
        ),
        Match.orElse(() => Option.none<string>()),
      ),
    ),
  )
  const text = Option.getOrElse(
    Option.orElse(readString(event.text), () => readString(event.name)),
    () =>
      Match.value(channel.name).pipe(
        Match.when(Match.string, (name) => `#${name}`),
        Match.orElse(() => ""),
      ),
  )
  const messageTs = Option.getOrNull(
    Option.orElse(readString(event.ts), () => readString(event.event_ts)),
  )
  const threadTs = Option.getOrNull(
    Option.orElse(readString(event.thread_ts), () => Option.fromNullishOr(messageTs)),
  )
  const eventType = Option.getOrNull(readString(event.type))
  const teamId = Option.getOrNull(
    Option.orElse(readString(envelope.team_id), () => readString(event.team)),
  )
  const channelType = Option.getOrNull(readString(event.channel_type))
  const eventIdKey = Option.getOrNull(readString(envelope.event_id))
  const compositeKey = Arr.filter(
    [eventType, channel.id, messageTs, userId, text],
    (part): part is string => Boolean(part),
  ).join(":")
  const fallbackKey = eventIdKey || compositeKey
  const deliveryKey = yield* Match.value(fallbackKey.length > 0).pipe(
    Match.when(true, () => Effect.succeed(fallbackKey)),
    Match.orElse(() => sha256Hex(body)),
  )
  return {
    payload: {
      surface: "event" as const,
      deliveryKey,
      teamId,
      channelId: channel.id,
      channelName: channel.name,
      channelType,
      userId,
      text,
      eventType,
      command: null,
      messageTs,
      threadTs,
      triggerId: null,
      actionId: null,
      responseUrl: null,
      rawPayload: sanitizeRawPayload(envelope),
    },
    response: null,
  }
})

const normalizeUserEvent = Effect.fn("workflows.slack.normalizeUserEvent")(function* (
  envelope: SlackEventEnvelope,
  event: Record<string, unknown>,
  body: string,
) {
  const isBotOrSubtype =
    Option.isSome(readString(event.bot_id)) || Option.isSome(readString(event.subtype))
  return yield* Match.value(isBotOrSubtype).pipe(
    Match.when(true, () => Effect.succeed({ payload: null, response: json({ ok: true }) })),
    Match.orElse(() => buildSlackEventPayload(envelope, event, body)),
  )
})

const normalizeEventCallback = Effect.fn("workflows.slack.normalizeEventCallback")(function* (
  envelope: SlackEventEnvelope,
  body: string,
) {
  const eventOption = Option.filter(
    Option.filter(Option.fromNullishOr(envelope.event), isRecord),
    () => envelope.type === "event_callback",
  )
  return yield* Option.match(eventOption, {
    onNone: () => Effect.succeed({ payload: null, response: json({ ok: true }) }),
    onSome: (event) => normalizeUserEvent(envelope, event, body),
  })
})

const normalizeSlackEnvelope = Effect.fn("workflows.slack.normalizeEnvelope")(function* (
  envelope: SlackEventEnvelope,
  body: string,
) {
  return yield* Match.value(envelope.type).pipe(
    Match.when("url_verification", () =>
      Effect.succeed({ payload: null, response: json({ challenge: envelope.challenge ?? "" }) }),
    ),
    Match.orElse(() => normalizeEventCallback(envelope, body)),
  )
})

export const normalizeSlackEvent = Effect.fn("workflows.slack.normalizeEvent")(function* (
  body: string,
) {
  const envelope = yield* parseJsonBody<SlackEventEnvelope>(body)
  return yield* Option.match(Option.fromNullishOr(envelope), {
    onNone: () =>
      Effect.succeed({
        payload: null,
        response: json({ error: "Invalid Slack event payload" }, 400),
      }),
    onSome: (resolved) => normalizeSlackEnvelope(resolved, body),
  })
})

const buildCommandDeliveryKey = Effect.fn("workflows.slack.buildCommandDeliveryKey")(function* (
  form: URLSearchParams,
  commandId: string | undefined,
  body: string,
) {
  const hash = yield* sha256Hex(body)
  return `${commandId ?? "command"}:${form.get("team_id") ?? ""}:${form.get("user_id") ?? ""}:${
    form.get("channel_id") ?? ""
  }:${hash}`
})

export const normalizeSlackCommand = Effect.fn("workflows.slack.normalizeCommand")(function* (
  body: string,
  commandId: string | undefined,
) {
  const form = new URLSearchParams(body)
  const triggerId = Option.getOrNull(readString(form.get("trigger_id")))
  const deliveryKey = yield* Option.match(Option.fromNullishOr(triggerId), {
    onNone: () => buildCommandDeliveryKey(form, commandId, body),
    onSome: (resolved) => Effect.succeed(resolved),
  })
  return {
    payload: {
      surface: "command" as const,
      deliveryKey,
      teamId: Option.getOrNull(readString(form.get("team_id"))),
      channelId: Option.getOrNull(readString(form.get("channel_id"))),
      channelName: Option.getOrNull(readString(form.get("channel_name"))),
      channelType: null,
      userId: Option.getOrNull(readString(form.get("user_id"))),
      text: Option.getOrElse(readString(form.get("text")), () => ""),
      eventType: null,
      command: Option.getOrNull(readString(form.get("command"))),
      messageTs: null,
      threadTs: null,
      triggerId,
      actionId: null,
      responseUrl: Option.getOrNull(readString(form.get("response_url"))),
      rawPayload: sanitizeRawPayload(Object.fromEntries(form.entries())),
    },
    response: null,
  }
})

function buildSlackInteractionPayload(parsed: Record<string, unknown>): NormalizedSlackResult {
  const action = Match.value(parsed.actions).pipe(
    Match.when(
      (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
      (actions) => actions[0] as unknown,
    ),
    Match.orElse(() => null),
  )
  const actionRecord = recordOrEmpty(action)
  const user = recordOrEmpty(parsed.user)
  const channel = recordOrEmpty(parsed.channel)
  const message = recordOrEmpty(parsed.message)
  const messageTs = Option.getOrNull(readString(message.ts))
  const actionId = Option.getOrNull(readString(actionRecord.action_id))
  const deliveryKey = Option.getOrElse(readString(parsed.trigger_id), () =>
    Arr.filter(
      [
        actionId,
        Option.getOrNull(readString(user.id)),
        Option.getOrNull(readString(channel.id)),
        messageTs,
      ],
      (part): part is string => Boolean(part),
    ).join(":"),
  )
  const teamId = Option.getOrNull(
    Option.flatMap(Option.filter(Option.fromNullishOr(parsed.team), isRecord), (team) =>
      readString(team.id),
    ),
  )
  return {
    payload: {
      surface: "interaction" as const,
      deliveryKey,
      teamId,
      channelId: Option.getOrNull(readString(channel.id)),
      channelName: Option.getOrNull(readString(channel.name)),
      channelType: Option.getOrNull(readString(channel.type)),
      userId: Option.getOrNull(readString(user.id)),
      text: Option.getOrElse(readString(actionRecord.value), () => ""),
      eventType: Option.getOrNull(readString(parsed.type)),
      command: null,
      messageTs,
      threadTs: Option.getOrNull(
        Option.orElse(readString(message.thread_ts), () => Option.fromNullishOr(messageTs)),
      ),
      triggerId: Option.getOrNull(readString(parsed.trigger_id)),
      actionId,
      responseUrl: Option.getOrNull(readString(parsed.response_url)),
      rawPayload: sanitizeRawPayload(parsed),
    },
    response: null,
  }
}

export const normalizeSlackInteraction = Effect.fn("workflows.slack.normalizeInteraction")(
  function* (body: string) {
    const form = new URLSearchParams(body)
    const rawPayload = form.get("payload") || ""
    const parsed = yield* parseJsonBody<Record<string, unknown>>(rawPayload)
    return Option.match(Option.fromNullishOr(parsed), {
      onNone: () => ({
        payload: null,
        response: json({ error: "Invalid Slack interaction payload" }, 400),
      }),
      onSome: (resolved) => buildSlackInteractionPayload(resolved),
    })
  },
)

const applyHydratedChannelName = Effect.fn("workflows.slack.applyHydratedChannelName")(function* (
  payload: NormalizedSlackPayload,
  response: Response,
) {
  const data = (yield* Effect.tryPromise({
    try: () => response.json() as Promise<Record<string, unknown>>,
    catch: () => null as Record<string, unknown> | null,
  })) as Record<string, unknown> | null
  const channelName = Option.flatMap(Option.fromNullishOr(data), (resolved) =>
    Match.value(resolved.channel).pipe(
      Match.when(
        (candidate: unknown): candidate is Record<string, unknown> => isRecord(candidate),
        (resolvedChannel) => readString(resolvedChannel.name),
      ),
      Match.orElse(() => Option.none<string>()),
    ),
  )
  yield* log("slack.hydrate.response", {
    channelId: payload.channelId,
    status: response.status,
    slackOk: data?.ok === true,
    slackError: Option.getOrNull(
      Option.flatMap(Option.fromNullishOr(data), (resolved) => readString(resolved.error)),
    ),
    slackResponseMessages: slackResponseMessages(data),
    hadName: Option.isSome(channelName),
  })
  return Option.match(channelName, {
    onNone: () => payload,
    onSome: (name) => ({ ...payload, channelName: name }),
  })
})

const fetchHydratedChannelName = Effect.fn("workflows.slack.fetchHydratedChannelName")(
  function* (input: { payload: NormalizedSlackPayload; botToken: string | null }) {
    const url = new URL("https://slack.com/api/conversations.info")
    url.searchParams.set("channel", input.payload.channelId ?? "")
    const response = yield* Effect.tryPromise({
      try: () =>
        // oxlint-disable-next-line effect/avoid-native-fetch -- External HTTP boundary (Slack conversations.info) inside a Worker entry handler; no HttpClient layer is in scope for this public-router path.
        fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${input.botToken}`,
          },
        }),
      catch: () => null as Response | null,
    })
    return yield* Match.value(Boolean(response?.ok)).pipe(
      Match.when(false, () => Effect.succeed(input.payload)),
      Match.orElse(() => applyHydratedChannelName(input.payload, response as Response)),
    )
  },
)

export const hydrateChannelName = Effect.fn("workflows.slack.hydrateChannelName")(
  function* (input: { payload: NormalizedSlackPayload; botToken: string | null }) {
    const needsHydration =
      !input.payload.channelName && Boolean(input.payload.channelId) && Boolean(input.botToken)
    const shouldLogHydration = Effect.succeed(needsHydration)
    yield* log("slack.hydrate.start", {
      channelId: input.payload.channelId,
      hasBotToken: Boolean(input.botToken),
    }).pipe(Effect.when(shouldLogHydration))
    const result = yield* Match.value(needsHydration).pipe(
      Match.when(false, () => Effect.succeed(input.payload)),
      Match.orElse(() => fetchHydratedChannelName(input)),
    )
    yield* log("slack.hydrate.result", {
      channelId: result.channelId,
      channelName: result.channelName,
      hadName: Boolean(result.channelName),
    }).pipe(Effect.when(shouldLogHydration))
    return result
  },
)
