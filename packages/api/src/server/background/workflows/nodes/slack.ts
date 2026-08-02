import { parseJson, stringifyJson } from "../../../lib/json"
import { toError } from "../../../lib/effect-errors"
import { resolveWorkflowSlackBotToken } from "../slack-apps"
import { workflowNodeFail } from "./errors"
import {
  createNodeContext,
  getPositiveInteger,
  getString,
  renderJsonTemplate,
  renderTemplate,
  type WorkflowNodeExecutionInput,
} from "./common"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

export type WorkflowSlackNodeExecutionInput = WorkflowNodeExecutionInput

interface SlackApiResponse extends Record<string, unknown> {
  ok?: boolean
  error?: string
}

function asArray(value: unknown): unknown[] {
  return Match.value(value).pipe(
    Match.when(
      (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
      (array) => array,
    ),
    Match.orElse(() => [] as unknown[]),
  )
}

function getRecord(value: unknown): Option.Option<Record<string, unknown>> {
  return Match.value(value).pipe(
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> =>
        typeof candidate === "object" && candidate !== null && !Array.isArray(candidate),
      (record) => Option.some(record),
    ),
    Match.orElse(() => Option.none<Record<string, unknown>>()),
  )
}

export const executeWorkflowSlackNode = Effect.fn("workflows.executeSlackNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  return yield* Match.value(input.node.type).pipe(
    Match.when("slack-send-message", () => runSlackSendMessageNode(input)),
    Match.when("slack-join-channel", () => runSlackJoinChannelNode(input)),
    Match.when("slack-fetch-thread", () => runSlackFetchThreadNode(input)),
    Match.when("slack-add-reaction", () => runSlackAddReactionNode(input)),
    Match.when("slack-remove-reaction", () => runSlackRemoveReactionNode(input)),
    Match.orElse((nodeType) => workflowNodeFail(`Unsupported workflow Slack node '${nodeType}'`)),
  )
})

const resolveWorkflowSlackToken = Effect.fn("workflows.resolveSlackToken")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  const context = createNodeContext(input)
  const token = Option.match(getString(input.inputs.token), {
    onNone: () => null,
    onSome: (template) => renderTemplate(template, context),
  })
  const resolvedToken = resolveWorkflowSlackBotToken({
    env: input.env,
    workflowId: input.workflowId,
    token,
  })
  return yield* Effect.catch(resolvedToken, (error) =>
    Match.value(token !== null && token.length > 0).pipe(
      Match.when(true, () => Effect.fail(error)),
      Match.orElse(() =>
        Option.match(getString(input.env.SLACK_TOKEN), {
          onNone: () => workflowNodeFail("Slack token is required"),
          onSome: (envToken) => Effect.succeed(envToken),
        }),
      ),
    ),
  )
})

const callSlackApi = Effect.fn("workflows.callSlackApi")(function* (
  token: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      // oxlint-disable-next-line effect/avoid-native-fetch -- External HTTP boundary (Slack Web API) inside a workflow node executor; native fetch is required at this external API edge.
      fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: stringifyJson(body),
      }),
    catch: toError,
  })
  const result = (yield* Effect.tryPromise({
    try: () => response.json().catch(() => ({})) as Promise<SlackApiResponse>,
    catch: toError,
  })) as SlackApiResponse
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () =>
      workflowNodeFail(`Slack API ${method} failed with HTTP ${response.status}`),
    ),
    Match.orElse(() =>
      Match.value(result.ok).pipe(
        Match.when(false, () =>
          workflowNodeFail(`Slack API ${method} failed: ${result.error ?? "unknown_error"}`),
        ),
        Match.orElse(() => Effect.succeed(result)),
      ),
    ),
  )
})

function appendSlackQueryParam(params: URLSearchParams, key: string, value: unknown) {
  Match.value(value).pipe(
    Match.when(Match.string, (stringValue) => params.set(key, stringValue)),
    Match.when(Match.number, (numberValue) => params.set(key, String(numberValue))),
    Match.when(Match.boolean, (booleanValue) => params.set(key, String(booleanValue))),
    Match.orElse(() => undefined),
  )
}

function slackApiUrl(method: string, query: Record<string, unknown>) {
  const url = new URL(`https://slack.com/api/${method}`)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    appendSlackQueryParam(params, key, value)
  }
  url.search = params.toString()
  return url
}

const callSlackApiGet = Effect.fn("workflows.callSlackApiGet")(function* (
  token: string,
  method: string,
  query: Record<string, unknown>,
) {
  const url = slackApiUrl(method, query)
  const response = yield* Effect.tryPromise({
    try: () =>
      // oxlint-disable-next-line effect/avoid-native-fetch -- External HTTP boundary (Slack Web API) inside a workflow node executor; native fetch is required at this external API edge.
      fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    catch: toError,
  })
  const result = (yield* Effect.tryPromise({
    try: () => response.json().catch(() => ({})) as Promise<SlackApiResponse>,
    catch: toError,
  })) as SlackApiResponse
  return yield* Match.value(response.ok).pipe(
    Match.when(false, () =>
      workflowNodeFail(`Slack API ${method} failed with HTTP ${response.status}`),
    ),
    Match.orElse(() =>
      Match.value(result.ok).pipe(
        Match.when(false, () =>
          workflowNodeFail(`Slack API ${method} failed: ${result.error ?? "unknown_error"}`),
        ),
        Match.orElse(() => Effect.succeed(result)),
      ),
    ),
  )
})

interface ChannelSearchState {
  cursor: Option.Option<string>
  found: Option.Option<string>
  exhausted: boolean
}

function isMatchingChannel(normalized: string) {
  return (item: unknown): boolean =>
    typeof item === "object" &&
    item !== null &&
    (item as Record<string, unknown>).name === normalized &&
    typeof (item as Record<string, unknown>).id === "string"
}

const searchSlackChannelsPage = Effect.fn("workflows.searchSlackChannelsPage")(function* (
  token: string,
  normalized: string,
  state: ChannelSearchState,
) {
  const cursorParams = Option.match(state.cursor, {
    onNone: () => ({}),
    onSome: (cursor) => ({ cursor }),
  })
  const result = yield* callSlackApi(token, "conversations.list", {
    exclude_archived: true,
    limit: 200,
    types: "public_channel,private_channel",
    ...cursorParams,
  })
  const channels = asArray(result.channels)
  const foundId = Option.map(
    Arr.findFirst(channels, isMatchingChannel(normalized)),
    (item) => (item as Record<string, unknown>).id as string,
  )
  const nextCursor = Option.flatMap(getRecord(result.response_metadata), (metadata) =>
    getString(metadata.next_cursor),
  )
  return {
    cursor: nextCursor,
    found: foundId,
    exhausted: Option.isNone(nextCursor),
  } satisfies ChannelSearchState
})

const findSlackChannelIdByName = Effect.fn("workflows.findSlackChannelId")(function* (
  token: string,
  normalized: string,
) {
  let state: ChannelSearchState = {
    cursor: Option.none<string>(),
    found: Option.none<string>(),
    exhausted: false,
  }
  yield* Effect.whileLoop({
    while: () => Option.isNone(state.found) && !state.exhausted,
    body: () => searchSlackChannelsPage(token, normalized, state),
    step: (next) => {
      state = next
    },
  })
  return state.found
})

const resolveNamedChannel = Effect.fn("workflows.resolveNamedChannel")(function* (
  token: string,
  normalized: string,
  channel: string,
) {
  const found = yield* findSlackChannelIdByName(token, normalized)
  return yield* Option.match(found, {
    onNone: () => workflowNodeFail(`Slack channel '${channel}' was not found`),
    onSome: (channelId) => Effect.succeed(channelId),
  })
})

const resolveChannelIdForJoin = Effect.fn("workflows.resolveChannelIdForJoin")(function* (
  token: string,
  channel: string,
) {
  const normalized = channel.trim().replace(/^#/, "")
  return yield* Match.value(normalized.length === 0 || /^[CGD][A-Z0-9]+$/.test(normalized)).pipe(
    Match.when(true, () => Effect.succeed(channel)),
    Match.orElse(() => resolveNamedChannel(token, normalized, channel)),
  )
})

const parseSlackBlocks = Effect.fn("workflows.parseSlackBlocks")(function* (rendered: string) {
  const parsed = parseJson(rendered)
  return yield* Match.value(Array.isArray(parsed)).pipe(
    Match.when(true, () => Effect.succeed(Option.some(parsed as unknown[]))),
    Match.orElse(() => workflowNodeFail("Slack blocks must be a JSON array")),
  )
})

const renderBlocksFromString = Effect.fn("workflows.renderSlackBlocksFromString")(function* (
  input: WorkflowSlackNodeExecutionInput,
  stringValue: string,
) {
  const rendered = Match.value(stringValue.trim().length > 0).pipe(
    Match.when(true, () => renderJsonTemplate(stringValue, createNodeContext(input)).trim()),
    Match.orElse(() => ""),
  )
  return yield* Match.value(rendered.length > 0).pipe(
    Match.when(false, () => Effect.succeed(Option.none<unknown[]>())),
    Match.orElse(() => parseSlackBlocks(rendered)),
  )
})

const renderBlocks = Effect.fn("workflows.renderSlackBlocks")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  const value = input.inputs.blocks ?? input.node.options?.blocks
  return yield* Match.value(value).pipe(
    Match.when(
      (candidate: unknown): candidate is unknown[] => Array.isArray(candidate),
      (blocks) => Effect.succeed(Option.some(blocks)),
    ),
    Match.when(Match.string, (stringValue) => renderBlocksFromString(input, stringValue)),
    Match.orElse(() => Effect.succeed(Option.none<unknown[]>())),
  )
})

const sendSlackMessage = Effect.fn("workflows.sendSlackMessage")(function* (
  input: WorkflowSlackNodeExecutionInput,
  token: string,
  context: Record<string, unknown>,
  channelTemplate: string,
) {
  const options = input.node.options ?? {}
  const textTemplate = Option.getOrElse(
    Option.orElse(getString(input.inputs.text), () => getString(options.text)),
    () => "{{inputs}}",
  )
  const threadTs = Option.map(
    Option.orElse(getString(input.inputs.threadTs), () => getString(options.threadTs)),
    (template) => renderTemplate(template, context),
  )
  const channel = renderTemplate(channelTemplate, context)
  const text = renderTemplate(textTemplate, context)
  const blocks = yield* renderBlocks(input)
  const threadParams = Option.match(threadTs, {
    onNone: () => ({}),
    onSome: (ts) => ({ thread_ts: ts }),
  })
  const blocksParams = Option.match(blocks, {
    onNone: () => ({}),
    onSome: (resolved) => ({ blocks: resolved }),
  })
  const result = yield* callSlackApi(token, "chat.postMessage", {
    channel,
    text,
    ...threadParams,
    ...blocksParams,
    unfurl_links: false,
    unfurl_media: false,
  })
  const resultChannel = Option.getOrElse(getString(result.channel), () => channel)
  const resultTs = Option.getOrNull(getString(result.ts))
  return {
    outputs: {
      ok: true,
      channel: resultChannel,
      ts: resultTs,
      message: result.message ?? null,
    },
  }
})

const runSlackSendMessageNode = Effect.fn("workflows.runSlackSendMessageNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const context = createNodeContext(input)
  const token = yield* resolveWorkflowSlackToken(input)
  const channelTemplate = Option.orElse(getString(input.inputs.channel), () =>
    getString(options.channel),
  )
  return yield* Option.match(channelTemplate, {
    onNone: () => workflowNodeFail("Slack channel is required"),
    onSome: (resolvedChannelTemplate) =>
      sendSlackMessage(input, token, context, resolvedChannelTemplate),
  })
})

const joinSlackChannel = Effect.fn("workflows.joinSlackChannel")(function* (
  token: string,
  context: Record<string, unknown>,
  channelTemplate: string,
) {
  const channel = yield* resolveChannelIdForJoin(token, renderTemplate(channelTemplate, context))
  const result = yield* callSlackApi(token, "conversations.join", { channel })
  const joinedChannelId = Option.getOrElse(
    Option.flatMap(getRecord(result.channel), (record) => getString(record.id)),
    () => channel,
  )
  return {
    outputs: {
      ok: true,
      channel: joinedChannelId,
    },
  }
})

const runSlackJoinChannelNode = Effect.fn("workflows.runSlackJoinChannelNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const context = createNodeContext(input)
  const token = yield* resolveWorkflowSlackToken(input)
  const channelTemplate = Option.orElse(getString(input.inputs.channel), () =>
    getString(options.channel),
  )
  return yield* Option.match(channelTemplate, {
    onNone: () => workflowNodeFail("Slack channel is required"),
    onSome: (resolvedChannelTemplate) => joinSlackChannel(token, context, resolvedChannelTemplate),
  })
})

function formatSlackMessageLine(record: Record<string, unknown>): string {
  const author = Option.getOrElse(
    Option.orElse(
      Option.orElse(getString(record.user), () => getString(record.username)),
      () => getString(record.bot_id),
    ),
    () => "unknown",
  )
  const text = Option.getOrElse(getString(record.text), () => "")
  return Match.value(text.length > 0).pipe(
    Match.when(true, () => `- ${author}: ${text.replace(/\s+/g, " ")}`),
    Match.orElse(() => ""),
  )
}

function formatOptionalSlackMessage(message: unknown): string {
  return Match.value(typeof message === "object" && message !== null).pipe(
    Match.when(true, () => formatSlackMessageLine(message as Record<string, unknown>)),
    Match.orElse(() => ""),
  )
}

function formatSlackThreadMessages(messages: unknown): string {
  return Arr.join(
    Arr.filter(
      Arr.map(asArray(messages), (message) => formatOptionalSlackMessage(message)),
      (item) => item.length > 0,
    ),
    "\n",
  )
}

const fetchSlackThread = Effect.fn("workflows.fetchSlackThread")(function* (
  input: WorkflowSlackNodeExecutionInput,
  token: string,
  context: Record<string, unknown>,
  channelTemplate: string,
  threadTsTemplate: string,
) {
  const options = input.node.options ?? {}
  const channel = renderTemplate(channelTemplate, context)
  const threadTs = renderTemplate(threadTsTemplate, context)
  const limit = Math.max(
    1,
    Math.min(
      100,
      Option.getOrElse(
        Option.orElse(getPositiveInteger(input.inputs.limit), () =>
          getPositiveInteger(options.limit),
        ),
        () => 20,
      ),
    ),
  )
  const result = yield* callSlackApiGet(token, "conversations.replies", {
    channel,
    ts: threadTs,
    limit,
    inclusive: true,
  })
  const messages = asArray(result.messages)
  return {
    outputs: {
      ok: true,
      channel,
      threadTs,
      messages,
      text: formatSlackThreadMessages(messages),
    },
  }
})

const runSlackFetchThreadNode = Effect.fn("workflows.runSlackFetchThreadNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const context = createNodeContext(input)
  const token = yield* resolveWorkflowSlackToken(input)
  const channelTemplate = Option.orElse(getString(input.inputs.channel), () =>
    getString(options.channel),
  )
  const threadTsTemplate = Option.orElse(getString(input.inputs.threadTs), () =>
    getString(options.threadTs),
  )
  const fallbackChannel = Option.getOrNull(
    Option.map(channelTemplate, (template) => renderTemplate(template, context)),
  )
  return yield* Option.match(Option.all([channelTemplate, threadTsTemplate]), {
    onNone: () =>
      Effect.succeed({
        outputs: {
          ok: false,
          channel: fallbackChannel,
          threadTs: null,
          messages: [],
          text: "",
        },
      }),
    onSome: ([channel, threadTs]) => fetchSlackThread(input, token, context, channel, threadTs),
  })
})

const updateSlackReaction = Effect.fn("workflows.updateSlackReaction")(function* (
  token: string,
  method: "reactions.add" | "reactions.remove",
  context: Record<string, unknown>,
  channelTemplate: string,
  timestampTemplate: string,
  nameTemplate: string,
) {
  const channel = renderTemplate(channelTemplate, context)
  const timestamp = renderTemplate(timestampTemplate, context)
  const name = renderTemplate(nameTemplate, context).replace(/^:/, "").replace(/:$/, "")
  yield* callSlackApi(token, method, {
    channel,
    timestamp,
    name,
  })
  return {
    outputs: {
      ok: true,
      channel,
      ts: timestamp,
      name,
    },
  }
})

const runSlackReactionNode = Effect.fn("workflows.runSlackReactionNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
  method: "reactions.add" | "reactions.remove",
) {
  const options = input.node.options ?? {}
  const context = createNodeContext(input)
  const token = yield* resolveWorkflowSlackToken(input)
  const channelTemplate = Option.orElse(getString(input.inputs.channel), () =>
    getString(options.channel),
  )
  const timestampTemplate = Option.orElse(getString(input.inputs.timestamp), () =>
    getString(options.timestamp),
  )
  const nameTemplate = Option.orElse(getString(input.inputs.name), () => getString(options.name))
  return yield* Option.match(Option.all([channelTemplate, timestampTemplate, nameTemplate]), {
    onNone: () => workflowNodeFail("Slack channel, timestamp, and reaction name are required"),
    onSome: ([channel, timestamp, name]) =>
      updateSlackReaction(token, method, context, channel, timestamp, name),
  })
})

const runSlackAddReactionNode = Effect.fn("workflows.runSlackAddReactionNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  return yield* runSlackReactionNode(input, "reactions.add")
})

const runSlackRemoveReactionNode = Effect.fn("workflows.runSlackRemoveReactionNode")(function* (
  input: WorkflowSlackNodeExecutionInput,
) {
  return yield* runSlackReactionNode(input, "reactions.remove")
})
