import { RpcTarget } from "cloudflare:workers"
import type { ChatStartEvent, StreamCallback } from "@cloudflare/think"
import type { AgentToolEventMessage } from "agents"
import type { UIMessageChunk } from "ai"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  getGitHubRepoTool,
  isMcpDiscoveryErrorReason,
  normalizeIsolateStepLimit,
  type SessionToolSpec,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { BackgroundTracing } from "../observability/tracing"
import type { IsolateSessionRuntime } from "../isolate/runtime"
import { parseAgentToolEventMessage, sanitizeParentToolCallArgs } from "../isolate/agent/delegation"
import { projectSubagentSessionEvent } from "../isolate/agent/subagent-event-projection"
import type { PromptExecutionMode, SandboxEvent } from "../types"
import { decodeJsonRecord } from "../../lib/json"

class IsolatePromptStreamCallback extends RpcTarget implements StreamCallback {
  constructor(
    private readonly handlers: {
      onStart(event: ChatStartEvent): Promise<void>
      onEvent(json: string): Promise<void>
      onDone(): Promise<void>
      onError(error: string): Promise<void>
      onInterrupted(): Promise<void>
    },
  ) {
    super()
  }

  onStart(event: ChatStartEvent): Promise<void> {
    return this.handlers.onStart(event)
  }

  onEvent(json: string): Promise<void> {
    return this.handlers.onEvent(json)
  }

  onDone(): Promise<void> {
    return this.handlers.onDone()
  }

  onError(error: string): Promise<void> {
    return this.handlers.onError(error)
  }

  onInterrupted(): Promise<void> {
    return this.handlers.onInterrupted()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function buildError(message: string): Error {
  return new Error(message)
}

function toErrorMessage(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse((other) => String(other)),
  )
}

function isMcpDiscoveryErrorChunk(value: Record<string, unknown>): value is {
  type: "mcp_discovery_error"
  serverName: string
  error: string
  terminal?: boolean
  discoveryReason?: unknown
} {
  return (
    value.type === "mcp_discovery_error" &&
    typeof value.serverName === "string" &&
    typeof value.error === "string" &&
    (value.terminal === undefined || typeof value.terminal === "boolean")
  )
}

function isStepLimitWarningChunk(value: Record<string, unknown>): value is {
  type: "step_limit_warning"
  stepLimit?: number
  message?: string
} {
  return (
    value.type === "step_limit_warning" &&
    (value.stepLimit === undefined || typeof value.stepLimit === "number") &&
    (value.message === undefined || typeof value.message === "string")
  )
}

async function emitIsolateToolCall(input: {
  processEvent(event: SandboxEvent): Promise<void>
  messageId: string
  sandboxId: string
  toolCallId: string
  toolName: string
  args: unknown
}): Promise<void> {
  const args = Option.match(Option.liftPredicate(input.args, isRecord), {
    onNone: () => ({ value: input.args }),
    onSome: (record) => record,
  })
  await input.processEvent({
    type: "tool_call",
    tool: input.toolName,
    args,
    callId: input.toolCallId,
    messageId: input.messageId,
    sandboxId: input.sandboxId,
    timestamp: Date.now() / 1000,
  })
}

async function emitIsolateToolResult(input: {
  processEvent(event: SandboxEvent): Promise<void>
  messageId: string
  sandboxId: string
  toolCallId: string
  result?: unknown
  error?: unknown
}): Promise<void> {
  const resultText = Match.value(input.result).pipe(
    Match.when(Match.undefined, () => ""),
    Match.when(Match.string, (value) => value),
    // oxlint-disable-next-line effect/avoid-direct-json -- AI-SDK tool-result rendering boundary: 2-space pretty-printed JSON is the established displayed/persisted tool output; the compact Schema JSON helper would change it.
    Match.orElse((value) => JSON.stringify(value, null, 2)),
  )
  const errorText = Match.value(input.error).pipe(
    Match.when(Match.undefined, () => undefined),
    Match.orElse((value) => toErrorMessage(value)),
  )
  await input.processEvent({
    type: "tool_result",
    callId: input.toolCallId,
    result: resultText,
    error: errorText,
    messageId: input.messageId,
    sandboxId: input.sandboxId,
    timestamp: Date.now() / 1000,
  })
}

export function runIsolatePromptWithEvents(input: {
  isolateRuntime: IsolateSessionRuntime
  sessionId: string
  selectedTools: readonly SessionToolSpec[]
  getSandboxId(): string
  getCloneAuth(): Promise<{ githubAccessToken?: string | null }>
  processEvent(event: SandboxEvent): Promise<void>
  onTerminalMcpDiscoveryError?(messageId: string): void
  prompt: {
    messageId: string
    content: string
    model: string
    reasoningEffort?: string
    executionMode: PromptExecutionMode
  }
}) {
  const emittedToolCalls = new Set<string>()
  const emittedToolResults = new Set<string>()
  const textState = { value: "" }
  const callbackErrorRef = { value: Option.none<string>() }
  const streamRequestIdRef = { value: Option.none<string>() }

  function emitStepLimitEvent(
    chunk: { type: "step_limit_warning"; stepLimit?: number; message?: string },
    sandboxId: string,
  ): Promise<void> {
    const contentField = Option.match(Option.liftPredicate(chunk.message, isNonEmptyString), {
      onNone: (): Record<string, never> => ({}),
      onSome: (content) => ({ content }),
    })
    return input.processEvent({
      type: "step_limit_warning",
      stepLimit: normalizeIsolateStepLimit(chunk.stepLimit, DEFAULT_ISOLATE_STEP_LIMIT),
      ...contentField,
      messageId: input.prompt.messageId,
      sandboxId,
      timestamp: Date.now() / 1000,
    })
  }

  function emitMcpDiscoveryEvent(chunk: {
    type: "mcp_discovery_error"
    serverName: string
    error: string
    terminal?: boolean
    discoveryReason?: unknown
  }): Promise<void> {
    Option.match(Option.liftPredicate(chunk.terminal, Boolean), {
      onNone: () => undefined,
      onSome: () => input.onTerminalMcpDiscoveryError?.(input.prompt.messageId),
    })
    const discoveryReason = Option.getOrUndefined(
      Option.liftPredicate(chunk.discoveryReason, isMcpDiscoveryErrorReason),
    )
    const terminalField = Option.match(Option.liftPredicate(chunk.terminal, Boolean), {
      onNone: (): Record<string, never> => ({}),
      onSome: () => ({ terminal: true as const }),
    })
    const discoveryReasonField = Option.match(Option.fromNullishOr(discoveryReason), {
      onNone: (): Record<string, never> => ({}),
      onSome: (reason) => ({ discoveryReason: reason }),
    })
    return input.processEvent({
      type: "mcp_discovery_error",
      serverName: chunk.serverName,
      error: chunk.error,
      ...terminalField,
      ...discoveryReasonField,
      messageId: input.prompt.messageId,
      sandboxId: input.sessionId,
      timestamp: Date.now() / 1000,
    })
  }

  function emitTextDelta(chunk: { type: "text-delta"; delta: string }): Promise<void> {
    textState.value += chunk.delta
    return input.processEvent({
      type: "token",
      content: textState.value,
      messageId: input.prompt.messageId,
      sandboxId: input.sessionId,
      timestamp: Date.now() / 1000,
    })
  }

  function emitToolCallNow(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    emittedToolCalls.add(toolCallId)
    return emitIsolateToolCall({
      processEvent: input.processEvent,
      messageId: input.prompt.messageId,
      sandboxId: input.sessionId,
      toolCallId,
      toolName,
      args: sanitizeParentToolCallArgs(toolName, args),
    })
  }

  function maybeEmitToolCall(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    return Match.value(emittedToolCalls.has(toolCallId)).pipe(
      Match.when(true, () => Promise.resolve()),
      Match.orElse(() => emitToolCallNow(toolCallId, toolName, args)),
    )
  }

  function emitToolResultErrorNow(toolCallId: string, error: unknown): Promise<void> {
    emittedToolResults.add(toolCallId)
    return emitIsolateToolResult({
      processEvent: input.processEvent,
      messageId: input.prompt.messageId,
      sandboxId: input.sessionId,
      toolCallId,
      error,
    })
  }

  function maybeEmitToolResultError(toolCallId: string, error: unknown): Promise<void> {
    return Match.value(emittedToolResults.has(toolCallId)).pipe(
      Match.when(true, () => Promise.resolve()),
      Match.orElse(() => emitToolResultErrorNow(toolCallId, error)),
    )
  }

  function emitToolResultOutputNow(toolCallId: string, result: unknown): Promise<void> {
    emittedToolResults.add(toolCallId)
    return emitIsolateToolResult({
      processEvent: input.processEvent,
      messageId: input.prompt.messageId,
      sandboxId: input.sessionId,
      toolCallId,
      result,
    })
  }

  function maybeEmitToolResultOutput(toolCallId: string, result: unknown): Promise<void> {
    return Match.value(emittedToolResults.has(toolCallId)).pipe(
      Match.when(true, () => Promise.resolve()),
      Match.orElse(() => emitToolResultOutputNow(toolCallId, result)),
    )
  }

  function emitToolInputAvailable(chunk: {
    toolCallId: string
    toolName: string
    input: unknown
  }): Promise<void> {
    return maybeEmitToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
  }

  async function emitToolInputError(chunk: {
    toolCallId: string
    toolName: string
    input: unknown
    errorText: string
  }): Promise<void> {
    await maybeEmitToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
    await maybeEmitToolResultError(chunk.toolCallId, chunk.errorText)
  }

  function emitUiChunkEvent(chunk: UIMessageChunk): Promise<void> {
    return Match.value(chunk).pipe(
      Match.when({ type: "text-delta" }, (textChunk) => emitTextDelta(textChunk)),
      Match.when({ type: "tool-input-available" }, (toolChunk) =>
        emitToolInputAvailable(toolChunk),
      ),
      Match.when({ type: "tool-input-error" }, (toolChunk) => emitToolInputError(toolChunk)),
      Match.when({ type: "tool-output-available" }, (toolChunk) =>
        maybeEmitToolResultOutput(toolChunk.toolCallId, toolChunk.output),
      ),
      Match.when({ type: "tool-output-error" }, (toolChunk) =>
        maybeEmitToolResultError(toolChunk.toolCallId, toolChunk.errorText),
      ),
      Match.orElse(() => Promise.resolve()),
    )
  }

  function handleParsedRecord(parsedEvent: Record<string, unknown>): Promise<void> {
    const sandboxId = input.getSandboxId()
    return Match.value(parsedEvent).pipe(
      Match.when(isStepLimitWarningChunk, (chunk) => emitStepLimitEvent(chunk, sandboxId)),
      Match.when(isMcpDiscoveryErrorChunk, (chunk) => emitMcpDiscoveryEvent(chunk)),
      Match.orElse((chunk) => emitUiChunkEvent(chunk as UIMessageChunk)),
    )
  }

  function emitSubagentEvent(message: AgentToolEventMessage): Promise<void> {
    return input.processEvent(
      projectSubagentSessionEvent({
        message,
        messageId: input.prompt.messageId,
        sandboxId: input.getSandboxId(),
        timestamp: Date.now() / 1000,
      }),
    )
  }

  function handleStreamEvent(json: string): Promise<void> {
    return Option.match(Option.fromNullishOr(parseAgentToolEventMessage(json)), {
      onNone: () =>
        Option.match(decodeJsonRecord(json), {
          onNone: () => Promise.resolve(),
          onSome: (parsedEvent) => handleParsedRecord(parsedEvent),
        }),
      onSome: emitSubagentEvent,
    })
  }

  function recordStreamStart(event: ChatStartEvent): Promise<void> {
    streamRequestIdRef.value = Option.some(event.requestId)
    return Promise.resolve()
  }

  function recordCallbackError(error: string): Promise<void> {
    callbackErrorRef.value = Option.some(error)
    return Promise.resolve()
  }

  function recordStreamInterrupted(): Promise<void> {
    const requestIdSuffix = Option.match(streamRequestIdRef.value, {
      onNone: () => "",
      onSome: (requestId) => ` requestId=${requestId}`,
    })
    callbackErrorRef.value = Option.some(
      `Isolate stream interrupted before completion; recovery continuation owns the final response.${requestIdSuffix}`,
    )
    return Promise.resolve()
  }

  const callback = new IsolatePromptStreamCallback({
    onStart: recordStreamStart,
    onEvent: handleStreamEvent,
    onDone: () => Promise.resolve(),
    onError: recordCallbackError,
    onInterrupted: recordStreamInterrupted,
  })

  return Effect.gen(function* () {
    const backgroundTracing = yield* BackgroundTracing
    const cloneAuth = yield* backgroundTracing.withSpan(
      "isolate.clone_auth.resolve",
      {
        "session.id": input.sessionId,
        "message.id": input.prompt.messageId,
      },
      Effect.tryPromise({
        try: () => input.getCloneAuth(),
        catch: (cause) => cause,
      }),
    )

    const observabilityTrace = yield* backgroundTracing.currentContext
    const result = yield* backgroundTracing.withSpan(
      "isolate.runtime.run_prompt",
      {
        "session.id": input.sessionId,
        "message.id": input.prompt.messageId,
        "message.content_length": input.prompt.content.length,
        "message.execution_mode": input.prompt.executionMode,
        "ai.model": input.prompt.model,
        "reasoning.effort": input.prompt.reasoningEffort ?? "",
        "tool.count": input.selectedTools.length,
      },
      input.isolateRuntime.runPrompt(
        input.sessionId,
        {
          messageId: input.prompt.messageId,
          githubAccessToken: cloneAuth.githubAccessToken,
          content: input.prompt.content,
          model: input.prompt.model,
          observabilityTrace: Option.getOrUndefined(observabilityTrace),
          reasoningEffort: input.prompt.reasoningEffort,
        },
        callback,
      ),
    )

    yield* Option.match(callbackErrorRef.value, {
      onNone: () => Effect.void,
      onSome: (message) => Effect.fail(buildError(message)),
    })

    const fallbackOutput = Option.liftPredicate(
      result.output,
      (output) => textState.value.length === 0 && output.trim().length > 0,
    )
    yield* Option.match(fallbackOutput, {
      onNone: () => Effect.void,
      onSome: (output) =>
        Effect.tryPromise({
          try: () =>
            input.processEvent({
              type: "token",
              content: output,
              messageId: input.prompt.messageId,
              sandboxId: result.runtimeId,
              timestamp: Date.now() / 1000,
            }),
          catch: (cause) => cause,
        }),
    })

    return {
      ...result,
      capabilities: {
        agentRuntime: "isolate",
        supportsWorkspace: true,
        supportsGit: true,
        supportsDocs: input.selectedTools.some((tool) => tool.kind === "ai_search"),
        supportsRepoWorkspace: Boolean(getGitHubRepoTool(input.selectedTools)),
      },
    }
  })
}
