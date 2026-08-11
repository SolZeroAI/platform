// @ts-nocheck
import { DurableObject, tracing as workerTracing } from "cloudflare:workers"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  getGitHubRepoTool,
  getSelectedMcpcfServerIds,
  getStageMetadataSync,
  humanizeCloudflareAiGatewayError,
  normalizeIsolateStepLimit,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  type OpenCodeInteractionRequest,
  type OpenCodeInteractionResponse,
  type RuntimeActivityEvent,
  type SessionKind,
  type SessionRuntimeCapabilities,
  type OpenCodeMcpServers,
  type SessionToolSpec,
} from "@solzero/shared"
import { generateId, hashToken } from "../../auth/crypto"
import {
  resolveGitHubCloneCredentials,
  type GitHubCloneCredentials,
} from "../../auth/github-clone-auth"
import {
  type IsolateSessionConfig,
  type IsolateWarmResult,
  IsolateSessionRuntime,
} from "../../isolate/runtime"
import {
  createSandboxLifecycleManager,
  type SandboxLifecycleManager,
} from "../../sandbox/lifecycle/manager"
import type {
  Attachment,
  ClientInfo,
  ClientMessage,
  Env,
  PromptExecutionMode,
  SandboxEvent,
  ServerMessage,
  SessionState,
} from "../.../types"
import { getGitHubAppUserAccessTokenForUserId } from "../../../lib/better-auth"
import { createApiRequestObserver } from "../../../effect/services/observability"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  BackgroundTracing,
  localSpanContextFromHeaders,
  makeBackgroundTracingLayer,
  type LocalSpanContext,
} from "../../observability/tracing"
import { createGlobalSecretsStoreFromD1 } from "../../db/repo-secrets"
import {
  decodeJson,
  decodeJsonRecord,
  parseJson,
  parseJsonArray,
  stringifyJson,
} from "../../../lib/json"
import { toError, toErrorWithFallback } from "../../../lib/effect-errors"
import { SessionRepository, toSessionRuntimeRepository } from "../repository"
import { buildResolvedSessionMcpServers } from "../runtime-mcp"
import { initSchema } from "../schema"
import { handleResumePromptRequest } from "../resume"
import { runIsolatePromptWithEvents } from "../isolate-prompt-bridge"
import { mirrorSubagentWorkflowEvent } from "../subagent-workflow-mirror"
import {
  getSandboxEventMessageId,
  isStoppedByUserMessage,
  shouldProcessSandboxEventForMessage,
  STOPPED_BY_USER_ERROR,
} from "../event-gating"
import type {
  ArtifactRow,
  MessageRow,
  ParticipantRow,
  RuntimeActivityRow,
  SandboxRow,
  SessionRow,
} from "../types"
import {
  type ParsedTags,
  type SessionWebSocketManager,
  SessionWebSocketManagerImpl,
  toSessionRuntimeWebSocket,
} from "../websocket-manager"
import {
  IsolateRuntimeUnavailableError,
  WS_AUTH_TIMEOUT_MS,
  WS_TOKEN_TTL_MS,
  getSessionCapabilities,
  getSessionCustomMcpServers,
  getSessionTools,
  parseArtifactMetadata,
  parseAttachments,
  parseStoredSecretKeys,
  promiseEffect,
  summarizeCustomMcpServersForLog,
  summarizeToolsForLog,
  type ExecutionCompleteSandboxEvent,
  type IsolateStreamState,
  type QueuedMessageContext,
  type TokenSandboxEvent,
  type UpdateToolsBody,
  type WsTokenBody,
} from "../durable-object"

type SessionDODelegate = any
const INTERACTION_REPLY_TIMEOUT_MS = 30 * 60_000

function resolvedModel(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((model) => model.length > 0),
  )
}

export async function processMessageQueue(
  host: SessionDODelegate,
  parentContext?: LocalSpanContext,
): Promise<void> {
  await Option.match(host.nextQueuedMessage(), {
    onNone: () => Promise.resolve(),
    onSome: (message) => host.runQueuedMessage(message, parentContext),
  })
}

export function canProcessQueue(host: SessionDODelegate): boolean {
  return (
    host.getSession()?.status !== "archived" &&
    Option.isNone(host.repository.getProcessingMessage())
  )
}

export function nextQueuedMessage(host: SessionDODelegate): Option.Option<MessageRow> {
  return Match.value(host.canProcessQueue()).pipe(
    Match.when(true, () => host.repository.getNextPendingMessage()),
    Match.orElse(() => Option.none<MessageRow>()),
  )
}

export function runQueuedMessage(
  host: SessionDODelegate,
  message: MessageRow,
  parentContext?: LocalSpanContext,
): Promise<void> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object background queue boundary; runs the session.message.process span Effect from the Promise-typed message queue runner.
  return Effect.runPromise(
    host.processQueuedMessage(message, parentContext).pipe(
      Effect.provide(
        makeBackgroundTracingLayer({
          tracing: workerTracing,
        }),
      ),
    ),
  )
}

export function buildQueuedMessageContext(
  host: SessionDODelegate,
  message: MessageRow,
): QueuedMessageContext {
  const session = Option.getOrNull(host.repository.getSession())
  const model = Option.getOrThrowWith(
    Option.orElse(resolvedModel(message.model), () => resolvedModel(session?.model)),
    () => new Error("Session message is missing a resolved model."),
  )

  return {
    message,
    author: Option.getOrNull(host.repository.getParticipantById(message.author_id)),
    session,
    sessionKind: host.getSessionKind(),
    agentRuntime: host.getAgentRuntime(),
    sessionTools: getSessionTools(session),
    sessionCustomMcpServers: getSessionCustomMcpServers(session),
    resolvedModel: model,
    resolvedReasoningEffort: message.reasoning_effort ?? session?.reasoning_effort ?? null,
    attachments: parseAttachments(message.attachments),
  }
}

export function messageSpanAttributes(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
): Record<string, unknown> {
  return {
    "session.id": host.getSessionId(),
    "session.kind": ctx.sessionKind,
    "agent.runtime": ctx.agentRuntime,
    "message.id": ctx.message.id,
    "message.content_length": ctx.message.content.length,
    "message.execution_mode": ctx.message.execution_mode,
    "ai.model.requested": ctx.message.model ?? "",
    "ai.model.resolved": ctx.resolvedModel,
    "reasoning.effort": ctx.resolvedReasoningEffort ?? "",
    "attachment.count": ctx.attachments?.length ?? 0,
    "tool.count": ctx.sessionTools.length,
    "mcp.custom_server_count": Object.keys(ctx.sessionCustomMcpServers).length,
    "user.id": ctx.author?.user_id ?? "",
  }
}

export function processQueuedMessage(
  host: SessionDODelegate,
  message: MessageRow,
  parentContext?: LocalSpanContext,
) {
  const ctx = host.buildQueuedMessageContext(message)
  return Effect.gen({ self: this }, function* () {
    const backgroundTracing = yield* BackgroundTracing
    return yield* backgroundTracing.withSpan(
      "session.message.process",
      host.messageSpanAttributes(ctx),
      host.processQueuedMessageEffect(ctx),
      { parentContext },
    )
  })
}

export function processQueuedMessageEffect(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Effect.gen({ self: this }, function* () {
    yield* host.ensureRuntimeReady(ctx)
    host.repository.updateMessageToProcessing(ctx.message.id, Date.now())
    host.repository.updateSandboxLastActivity(Date.now())
    yield* promiseEffect(() => host.scheduleInactivityCheck())
    host.broadcast({ type: "processing_status", isProcessing: true })
    yield* host
      .runPromptExecution(ctx)
      .pipe(Effect.catchCause((cause) => host.handlePromptFailure(ctx, Cause.squash(cause))))
  })
}

export function ensureRuntimeReady(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Match.value(ctx.agentRuntime).pipe(
    Match.when("isolate", () => host.ensureIsolateReadySpan(ctx)),
    Match.orElse(() => host.ensureSandboxEffect()),
  )
}

export function ensureSandboxEffect(host: SessionDODelegate) {
  return host.lifecycleManager.ensureSandbox()
}

export function ensureIsolateReadySpan(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Effect.gen({ self: this }, function* () {
    const backgroundTracing = yield* BackgroundTracing
    return yield* backgroundTracing.withSpan(
      "session.isolate.ensure_ready",
      {
        "session.id": host.getSessionId(),
        "session.kind": ctx.sessionKind,
        "runtime.kind": "isolate",
      },
      host.ensureIsolateReady(),
    )
  })
}

export function runPromptExecution(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Match.value(ctx.agentRuntime).pipe(
    Match.when("isolate", () => host.runIsolatePrompt(ctx)),
    Match.orElse(() => host.runSandboxPrompt(ctx)),
  )
}

export function runSandboxPrompt(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Effect.gen({ self: this }, function* () {
    const backgroundTracing = yield* BackgroundTracing
    return yield* backgroundTracing.withSpan(
      "session.prompt.sandbox",
      host.messageSpanAttributes(ctx),
      host.runSandboxPromptEffect(ctx),
    )
  })
}

export function runSandboxPromptEffect(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Effect.gen({ self: this }, function* () {
    const mcpServers = yield* buildResolvedSessionMcpServers({
      env: host.env,
      tools: ctx.sessionTools,
      customMcpServers: ctx.sessionCustomMcpServers,
      sessionId: ctx.session?.session_name ?? ctx.session?.id ?? host.ctx.id.toString(),
      stage: host.env,
    })
    yield* host.lifecycleManager.runPrompt({
      messageId: ctx.message.id,
      content: ctx.message.content,
      model: ctx.resolvedModel,
      reasoningEffort: ctx.resolvedReasoningEffort ?? undefined,
      author: {
        userId: ctx.author?.user_id ?? "unknown",
        githubName: ctx.author?.github_name ?? null,
        githubEmail: ctx.author?.github_email ?? null,
      },
      attachments: ctx.attachments,
      mcpServers,
      requestInteraction: (request: OpenCodeInteractionRequest) =>
        host.requestRuntimeInteraction(request),
    })
  })
}

export function requestRuntimeInteraction(
  host: SessionDODelegate,
  request: OpenCodeInteractionRequest,
): Promise<OpenCodeInteractionResponse> {
  return new Promise<OpenCodeInteractionResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.pendingRuntimeInteractions.delete(request.interactionId)
      reject(new Error(`Agent ${request.kind} request timed out waiting for user response`))
    }, INTERACTION_REPLY_TIMEOUT_MS)

    host.pendingRuntimeInteractions.set(request.interactionId, {
      request,
      resolve,
      reject,
      timeout,
    })

    host
      .processSandboxEvent({
        type: "interaction_request",
        ...request,
      })
      .catch((errorValue: unknown) => {
        clearTimeout(timeout)
        host.pendingRuntimeInteractions.delete(request.interactionId)
        reject(toError(errorValue))
      })
  })
}

export function resolveRuntimeInteraction(
  host: SessionDODelegate,
  client: ClientInfo,
  response: OpenCodeInteractionResponse,
): Promise<void> {
  return Option.match(
    Option.fromNullishOr(host.pendingRuntimeInteractions.get(response.interactionId)),
    {
      onNone: () => Promise.reject(new Error("Interaction request is no longer pending")),
      onSome: (pending) =>
        Match.value(pending.request.kind === response.kind).pipe(
          Match.when(false, () =>
            Promise.reject(new Error("Interaction response kind does not match pending request")),
          ),
          Match.orElse(() => resolveMatchedRuntimeInteraction(host, client, response, pending)),
        ),
    },
  )
}

function resolveMatchedRuntimeInteraction(
  host: SessionDODelegate,
  client: ClientInfo,
  response: OpenCodeInteractionResponse,
  pending: PendingRuntimeInteraction,
): Promise<void> {
  clearTimeout(pending.timeout)
  host.pendingRuntimeInteractions.delete(response.interactionId)

  const responseEvent: SandboxEvent = {
    type: "interaction_response",
    ...response,
    messageId: pending.request.messageId,
    sandboxId: pending.request.sandboxId,
    timestamp: Date.now() / 1000,
    author: {
      participantId: client.participantId,
      name: client.name,
      avatar: client.avatar,
    },
  }
  return host.processSandboxEvent(responseEvent).then(
    () => {
      pending.resolve(response)
    },
    (errorValue: unknown) => {
      const error = toError(errorValue)
      pending.reject(error)
      throw error
    },
  )
}

export function rejectPendingRuntimeInteractionsForMessage(
  host: SessionDODelegate,
  messageId: string,
  reason: string,
): void {
  Array.from(host.pendingRuntimeInteractions.entries())
    .filter(([, pending]) => pending.request.messageId === messageId)
    .forEach(([interactionId, pending]) => {
      clearTimeout(pending.timeout)
      host.pendingRuntimeInteractions.delete(interactionId)
      pending.reject(new Error(reason))
    })
}

export function runIsolatePrompt(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return Effect.gen({ self: this }, function* () {
    host.repository.updateSandboxStatus("running")
    host.broadcast({ type: "sandbox_status", status: "running" })
    host.terminalMcpDiscoveryErrorMessageIds.delete(ctx.message.id)

    const backgroundTracing = yield* BackgroundTracing
    const result = yield* backgroundTracing.withSpan(
      "session.prompt.isolate",
      host.messageSpanAttributes(ctx),
      host.runIsolatePromptEvents(ctx),
    )

    yield* host.maybeCompleteIsolatePrompt(ctx, result)
    host.terminalMcpDiscoveryErrorMessageIds.delete(ctx.message.id)
  })
}

export function runIsolatePromptEvents(host: SessionDODelegate, ctx: QueuedMessageContext) {
  return runIsolatePromptWithEvents({
    isolateRuntime: host.isolateRuntime,
    sessionId: host.getSessionId(),
    selectedTools: ctx.sessionTools,
    getSandboxId: () =>
      Option.getOrNull(host.repository.getRuntimeLifecycle())?.runtimeId ?? host.getSessionId(),
    getCloneAuth: () => host.getIsolateCloneAuth(),
    processEvent: (event) => host.processSandboxEvent(event),
    onTerminalMcpDiscoveryError: (messageId) => {
      host.terminalMcpDiscoveryErrorMessageIds.add(messageId)
    },
    prompt: {
      messageId: ctx.message.id,
      content: ctx.message.content,
      model: ctx.resolvedModel,
      reasoningEffort: ctx.resolvedReasoningEffort ?? undefined,
      executionMode: ctx.message.execution_mode,
    },
  })
}

export function maybeCompleteIsolatePrompt(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  result: { runtimeId: string },
) {
  return Option.match(
    Option.liftPredicate(
      result,
      () =>
        isStoppedByUserMessage(Option.getOrNull(host.repository.getMessageById(ctx.message.id))) ===
        false,
    ),
    {
      onNone: () => Effect.void,
      onSome: (resolved) => host.completeIsolatePrompt(ctx, resolved),
    },
  )
}

export function completeIsolatePrompt(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  result: { runtimeId: string },
) {
  return Effect.gen({ self: this }, function* () {
    const eventTimestamp = Date.now() / 1000
    host.repository.updateSandboxStatus("ready")
    host.broadcast({ type: "sandbox_status", status: "ready" })
    yield* promiseEffect(() =>
      host.processSandboxEvent({
        type: "execution_complete",
        messageId: ctx.message.id,
        success: true,
        sandboxId: result.runtimeId,
        timestamp: eventTimestamp,
      }),
    )
  })
}

export function handlePromptFailure(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorValue: unknown,
) {
  return Effect.gen({ self: this }, function* () {
    const isArchived = host.getSession()?.status === "archived"
    yield* Option.match(
      Option.liftPredicate(
        errorValue,
        () =>
          isStoppedByUserMessage(
            Option.getOrNull(host.repository.getMessageById(ctx.message.id)),
          ) === false,
      ),
      {
        onNone: () => host.clearTerminalDiscoveryEffect(ctx.message.id),
        onSome: () => host.applyPromptFailure(ctx, errorValue, isArchived),
      },
    )
  })
}

export function clearTerminalDiscoveryEffect(host: SessionDODelegate, messageId: string) {
  return Effect.sync(() => {
    host.terminalMcpDiscoveryErrorMessageIds.delete(messageId)
  })
}

export function promptFailureMessage(
  host: SessionDODelegate,
  errorValue: unknown,
  isArchived: boolean,
): string {
  return Match.value(isArchived).pipe(
    Match.when(true, () => "Session archived"),
    Match.orElse(() => humanizeCloudflareAiGatewayError(toError(errorValue).message)),
  )
}

export function applyPromptFailure(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorValue: unknown,
  isArchived: boolean,
) {
  return Effect.gen({ self: this }, function* () {
    const errorMessage = host.promptFailureMessage(errorValue, isArchived)
    host.repository.updateMessageCompletion(ctx.message.id, "failed", Date.now(), errorMessage)
    yield* Option.match(
      Option.liftPredicate(errorMessage, () => isArchived === false),
      {
        onNone: () => Effect.void,
        onSome: () => host.reportPromptFailure(ctx, errorValue, errorMessage),
      },
    )
    host.terminalMcpDiscoveryErrorMessageIds.delete(ctx.message.id)
    yield* promiseEffect(() => host.failIsolateStream(ctx.message.id, errorMessage))
    host.broadcast({ type: "processing_status", isProcessing: false })
    yield* promiseEffect(() => host.processMessageQueue())
  })
}

export function reportPromptFailure(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorValue: unknown,
  errorMessage: string,
) {
  return Effect.gen({ self: this }, function* () {
    host.logMessageQueueFailure({
      errorValue,
      errorMessage,
      sessionKind: ctx.sessionKind,
      session: ctx.session,
      userId: ctx.author?.user_id ?? null,
      message: ctx.message,
      resolvedModel: ctx.resolvedModel,
      resolvedReasoningEffort: ctx.resolvedReasoningEffort,
      attachments: ctx.attachments,
      tools: ctx.sessionTools,
      customMcpServers: ctx.sessionCustomMcpServers,
    })
    yield* host.reportNonSandboxFailure(ctx, errorMessage)
    host.broadcast({ type: "sandbox_error", error: errorMessage })
  })
}

export function reportNonSandboxFailure(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorMessage: string,
) {
  return Option.match(
    Option.liftPredicate(ctx.agentRuntime, (runtime) => runtime === "isolate"),
    {
      onNone: () => Effect.void,
      onSome: () => host.failNonSandboxRuntime(ctx, errorMessage),
    },
  )
}

export function failNonSandboxRuntime(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorMessage: string,
) {
  return Effect.gen({ self: this }, function* () {
    host.repository.updateSandboxStatus("failed")
    yield* Option.match(
      Option.liftPredicate(
        errorMessage,
        () => host.terminalMcpDiscoveryErrorMessageIds.has(ctx.message.id) === false,
      ),
      {
        onNone: () => Effect.void,
        onSome: () => host.emitPromptErrorEvent(ctx, errorMessage),
      },
    )
  })
}

export function emitPromptErrorEvent(
  host: SessionDODelegate,
  ctx: QueuedMessageContext,
  errorMessage: string,
) {
  return promiseEffect(() =>
    host.processSandboxEvent({
      type: "error",
      error: errorMessage,
      messageId: ctx.message.id,
      sandboxId: host.getSessionId(),
      timestamp: Date.now() / 1000,
    }),
  )
}

export function processSandboxEvent(host: SessionDODelegate, event: SandboxEvent): Promise<void> {
  const now = Date.now()
  return Match.value(event.type).pipe(
    Match.when("heartbeat", () => Promise.resolve(host.recordHeartbeat(now))),
    Match.orElse(() => host.processNonHeartbeatEvent(event, now)),
  )
}

export function recordHeartbeat(host: SessionDODelegate, now: number): void {
  host.repository.updateSandboxHeartbeat(now)
}

export function processNonHeartbeatEvent(
  host: SessionDODelegate,
  event: SandboxEvent,
  now: number,
): Promise<void> {
  return Option.match(host.droppedEventMessageStatus(event), {
    onNone: () => host.persistSandboxEvent(event, now),
    onSome: (messageStatus) =>
      Promise.resolve(host.logDroppedSandboxEvent({ event, messageStatus })),
  })
}

export function droppedEventMessageStatus(
  host: SessionDODelegate,
  event: SandboxEvent,
): Option.Option<string | null> {
  return Option.flatMap(Option.fromNullishOr(getSandboxEventMessageId(event)), (messageId) =>
    host.dropStatusForMessage(event, Option.getOrNull(host.repository.getMessageById(messageId))),
  )
}

export function dropStatusForMessage(
  host: SessionDODelegate,
  event: SandboxEvent,
  message: MessageRow | null,
): Option.Option<string | null> {
  return Option.liftPredicate(
    message?.status ?? null,
    () => shouldProcessSandboxEventForMessage({ event, message }) === false,
  )
}

export async function persistSandboxEvent(
  host: SessionDODelegate,
  event: SandboxEvent,
  now: number,
): Promise<void> {
  await host.maybeWriteStreamDelta(event)
  const messageId = event.messageId ?? null
  const inserted = Match.value(event).pipe(
    Match.when({ type: "subagent_event" }, (subagentEvent) =>
      host.repository.events.createEventIfAbsent({
        id: subagentEvent.eventId,
        type: subagentEvent.type,
        data: stringifyJson(subagentEvent),
        messageId,
        createdAt: now,
      }),
    ),
    Match.orElse((ordinaryEvent) =>
      persistOrdinarySandboxEvent(host, ordinaryEvent, messageId, now),
    ),
  )
  await maybeMirrorPersistedSubagentEvent(host, event)
  await Match.value(inserted).pipe(
    Match.when(false, () => Promise.resolve()),
    Match.orElse(async () => {
      await host.maybeCompleteExecution(event, messageId, now)
      host.broadcast({ type: "sandbox_event", event })
    }),
  )
}

export function maybeMirrorPersistedSubagentEvent(
  host: SessionDODelegate,
  event: SandboxEvent,
): Promise<void> {
  return Match.value(event).pipe(
    Match.when({ type: "subagent_event" }, (subagentEvent) =>
      mirrorSubagentWorkflowEvent({
        env: host.env,
        repository: host.repository,
        sessionId: host.getSessionId(),
        event: subagentEvent,
      }).catch((cause) => logSubagentMirrorFailure(host, subagentEvent, cause)),
    ),
    Match.orElse(() => Promise.resolve()),
  )
}

function logSubagentMirrorFailure(
  host: SessionDODelegate,
  event: Extract<SandboxEvent, { type: "subagent_event" }>,
  cause: unknown,
): void {
  host
    .createInternalRequestObserver("subagent_workflow_mirror", "session-subagent-workflow-mirror")
    .log.error(toError(cause), {
      sessionId: host.getSessionId(),
      runId: event.runId,
      sequence: event.sequence,
      kind: event.kind,
    })
}

function persistOrdinarySandboxEvent(
  host: SessionDODelegate,
  event: SandboxEvent,
  messageId: string | null,
  now: number,
): true {
  host.repository.events.createEvent({
    id: generateId(),
    type: event.type,
    data: stringifyJson(event),
    messageId,
    createdAt: now,
  })
  return true
}

export function maybeWriteStreamDelta(host: SessionDODelegate, event: SandboxEvent): Promise<void> {
  return Match.value(event).pipe(
    Match.when({ type: "token" }, (tokenEvent) => host.writeTokenDelta(tokenEvent)),
    Match.orElse(() => Promise.resolve()),
  )
}

export function writeTokenDelta(host: SessionDODelegate, event: TokenSandboxEvent): Promise<void> {
  return Option.match(host.streamForMessage(event.messageId), {
    onNone: () => Promise.resolve(),
    onSome: (stream) => host.applyStreamDelta(stream, event.content),
  })
}

export function streamForMessage(
  host: SessionDODelegate,
  messageId: string | undefined,
): Option.Option<IsolateStreamState> {
  return Option.flatMap(Option.fromNullishOr(messageId), (id) =>
    Option.fromNullishOr(host.isolateStreamState.get(id)),
  )
}

export function applyStreamDelta(
  host: SessionDODelegate,
  stream: IsolateStreamState,
  nextText: string,
): Promise<void> {
  const delta = Match.value(nextText.startsWith(stream.text)).pipe(
    Match.when(true, () => nextText.slice(stream.text.length)),
    Match.orElse(() => nextText),
  )
  stream.text = nextText
  return Option.match(
    Option.liftPredicate(delta, (value) => value.length > 0),
    {
      onNone: () => Promise.resolve(),
      onSome: (value) => stream.writer.write(new TextEncoder().encode(value)),
    },
  )
}

export function maybeCompleteExecution(
  host: SessionDODelegate,
  event: SandboxEvent,
  messageId: string | null,
  now: number,
): Promise<void> {
  return Match.value(event).pipe(
    Match.when({ type: "execution_complete" }, (completeEvent) =>
      host.completeExecutionIfMessage(completeEvent, messageId, now),
    ),
    Match.orElse(() => Promise.resolve()),
  )
}

export function completeExecutionIfMessage(
  host: SessionDODelegate,
  event: ExecutionCompleteSandboxEvent,
  messageId: string | null,
  now: number,
): Promise<void> {
  return Option.match(Option.fromNullishOr(messageId), {
    onNone: () => Promise.resolve(),
    onSome: (id) => host.completeExecution(event, id, now),
  })
}

export function completionStatus(
  host: SessionDODelegate,
  success: boolean,
): "completed" | "failed" {
  return Match.value(success).pipe(
    Match.when(true, () => "completed" as const),
    Match.orElse(() => "failed" as const),
  )
}

export function finalizeExecutionStream(
  host: SessionDODelegate,
  event: ExecutionCompleteSandboxEvent,
  messageId: string,
): Promise<void> {
  return Match.value(event.success).pipe(
    Match.when(true, () => host.closeIsolateStream(messageId)),
    Match.orElse(() => host.failIsolateStream(messageId, event.error ?? "Execution failed")),
  )
}

export async function completeExecution(
  host: SessionDODelegate,
  event: ExecutionCompleteSandboxEvent,
  messageId: string,
  now: number,
): Promise<void> {
  host.repository.updateMessageCompletion(
    messageId,
    host.completionStatus(event.success),
    now,
    event.error,
  )
  host.broadcast({ type: "processing_status", isProcessing: false })
  host.repository.updateSandboxLastActivity(now)
  await host.scheduleInactivityCheck()
  await host.finalizeExecutionStream(event, messageId)
  host.ctx.waitUntil(host.processMessageQueue())
}

export function stopExecution(host: SessionDODelegate): Promise<void> {
  return Option.match(host.repository.getProcessingMessage(), {
    onNone: () => Promise.resolve(),
    onSome: (processing) => host.stopProcessingMessage(processing),
  })
}

export async function stopProcessingMessage(
  host: SessionDODelegate,
  processing: MessageRow,
): Promise<void> {
  const now = Date.now()
  const sessionKind = host.getSessionKind()
  const agentRuntime = host.getAgentRuntime()
  const participant = Option.getOrNull(host.repository.getParticipantById(processing.author_id))
  const runtimeId = host.resolveStopRuntimeId(agentRuntime)
  host.rejectPendingRuntimeInteractionsForMessage(processing.id, STOPPED_BY_USER_ERROR)

  const stoppedEvent: SandboxEvent = {
    type: "execution_complete",
    messageId: processing.id,
    success: false,
    error: STOPPED_BY_USER_ERROR,
    sandboxId: runtimeId,
    timestamp: now / 1000,
  }

  host.repository.updateMessageCompletion(processing.id, "failed", now, STOPPED_BY_USER_ERROR)
  host.repository.events.createEvent({
    id: generateId(),
    type: stoppedEvent.type,
    data: stringifyJson(stoppedEvent),
    messageId: processing.id,
    createdAt: now,
  })
  host.broadcast({ type: "sandbox_event", event: stoppedEvent })
  host.broadcast({ type: "processing_status", isProcessing: false })
  await host.failIsolateStream(processing.id, STOPPED_BY_USER_ERROR)
  host.logPromptStopped({
    sessionKind,
    agentRuntime,
    userId: participant?.user_id ?? null,
    messageId: processing.id,
    runtimeId,
  })
  await host.stopRuntimeExecution(agentRuntime, processing, participant, runtimeId)
  await host.processMessageQueue()
}

export function resolveStopRuntimeId(
  host: SessionDODelegate,
  agentRuntime: QueuedMessageContext["agentRuntime"],
): string {
  return Match.value(agentRuntime).pipe(
    Match.when(
      "isolate",
      () =>
        Option.getOrNull(host.repository.getRuntimeLifecycle())?.runtimeId ?? host.getSessionId(),
    ),
    Match.orElse(() => Option.getOrElse(host.lifecycleManager.getSandboxId(), () => "unknown")),
  )
}

export function stopRuntimeExecution(
  host: SessionDODelegate,
  agentRuntime: QueuedMessageContext["agentRuntime"],
  processing: MessageRow,
  participant: ParticipantRow | null,
  runtimeId: string,
) {
  return Match.value(agentRuntime).pipe(
    Match.when("isolate", () => host.stopIsolateRuntime(processing, participant, runtimeId)),
    // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object stop handler is a platform Promise boundary.
    Match.orElse(() => Effect.runPromise(host.lifecycleManager.stopCurrentExecution())),
  )
}

export function stopIsolateRuntime(
  host: SessionDODelegate,
  processing: MessageRow,
  participant: ParticipantRow | null,
  runtimeId: string,
): Promise<unknown> {
  host.repository.updateSandboxStatus("ready")
  host.broadcast({ type: "sandbox_status", status: "ready" })
  // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object stop boundary; runs the isolate stopPrompt span Effect with failure logging at the Promise edge.
  return Effect.runPromise(host.stopIsolatePromptEffect(processing, participant, runtimeId))
}

export function stopIsolatePromptEffect(
  host: SessionDODelegate,
  processing: MessageRow,
  participant: ParticipantRow | null,
  runtimeId: string,
) {
  return host.isolateRuntime
    .stopPrompt(host.getSessionId())
    .pipe(
      Effect.catchCause((cause) =>
        host.logIsolateStopFailureEffect(Cause.squash(cause), participant, processing, runtimeId),
      ),
    )
}

export function logIsolateStopFailureEffect(
  host: SessionDODelegate,
  errorValue: unknown,
  participant: ParticipantRow | null,
  processing: MessageRow,
  runtimeId: string,
) {
  return Effect.sync(() => {
    host.logIsolateStopFailure({
      errorValue,
      userId: participant?.user_id ?? null,
      messageId: processing.id,
      runtimeId,
    })
  })
}

export function broadcast(host: SessionDODelegate, message: ServerMessage): void {
  host.wsManager.forEachClientSocket("authenticated_only", (ws) => {
    host.wsManager.send(ws, message)
  })
}
