// @ts-nocheck
import { DurableObject, tracing as workerTracing } from "cloudflare:workers"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  getGitHubRepoTool,
  getSelectedMcpcfServerIds,
  getStageMetadataSync,
  normalizeIsolateStepLimit,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  type AgentRuntime,
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

export function createInternalRequestObserver(
  host: SessionDODelegate,
  path: string,
  routeBranch: string,
) {
  const observer = createApiRequestObserver(
    new Request(`http://internal/session/${path}`, { method: "POST" }),
    host.env,
    {
      waitUntil: host.ctx.waitUntil.bind(host.ctx),
      passThroughOnException() {},
      props: {},
      tracing: workerTracing,
    },
  )
  observer.setRouteBranch(routeBranch)
  return observer
}

export function logMessageQueueFailure(
  host: SessionDODelegate,
  input: {
    errorValue: unknown
    errorMessage: string
    sessionKind: SessionKind
    session: SessionRow | null
    userId: string | null
    message: {
      id: string
      content: string
      model: string | null
      reasoning_effort: string | null
      execution_mode: PromptExecutionMode
    }
    resolvedModel: string
    resolvedReasoningEffort: string | null
    attachments: Attachment[] | undefined
    tools: readonly SessionToolSpec[]
    customMcpServers: OpenCodeMcpServers
  },
): void {
  const error = toErrorWithFallback(input.errorValue, input.errorMessage)
  const observer = host.createInternalRequestObserver("message_queue", "session-message-queue")
  observer.setUserId(input.userId)
  observer.log.error(error, {
    event: "session.message_queue.failed",
    boundary: "session.message_queue",
    session: {
      id: input.session?.id ?? host.getSessionId(),
      kind: input.sessionKind,
      status: input.session?.status ?? null,
    },
    repo: {
      owner: input.session?.repo_owner ?? null,
      name: input.session?.repo_name ?? null,
      branchName: input.session?.branch_name ?? null,
    },
    runtime: {
      sandboxStatus: Option.getOrNull(host.repository.getRuntimeLifecycle())?.status ?? null,
    },
    message: {
      id: input.message.id,
      contentLength: input.message.content.length,
      executionMode: input.message.execution_mode,
      requestedModel: input.message.model,
      resolvedModel: input.resolvedModel,
      requestedReasoningEffort: input.message.reasoning_effort,
      resolvedReasoningEffort: input.resolvedReasoningEffort,
      attachmentCount: input.attachments?.length ?? 0,
      attachmentTypes: input.attachments?.map((attachment) => attachment.type) ?? [],
    },
    tools: summarizeToolsForLog(input.tools),
    customMcpServers: summarizeCustomMcpServersForLog(input.customMcpServers),
  })
}

export function logPromptStopped(
  host: SessionDODelegate,
  input: {
    sessionKind: SessionKind
    agentRuntime: AgentRuntime
    userId: string | null
    messageId: string
    runtimeId: string
  },
): void {
  const observer = host.createInternalRequestObserver("stop", "session-stop")
  observer.setUserId(input.userId)
  observer.log.emit({
    event: "session.prompt.stopped",
    status: 200,
    boundary: "session.stop",
    sessionId: host.getSessionId(),
    sessionKind: input.sessionKind,
    agentRuntime: input.agentRuntime,
    messageId: input.messageId,
    runtimeId: input.runtimeId,
    _forceKeep: true,
  })
}

export function logIsolateStopFailure(
  host: SessionDODelegate,
  input: {
    errorValue: unknown
    userId: string | null
    messageId: string
    runtimeId: string
  },
): void {
  const error = toError(input.errorValue)
  const observer = host.createInternalRequestObserver("stop", "session-stop")
  observer.setUserId(input.userId)
  observer.log.error(error, {
    event: "session.isolate.stop_failed",
    boundary: "session.stop.isolate_runtime",
    sessionId: host.getSessionId(),
    messageId: input.messageId,
    runtimeId: input.runtimeId,
  })
}

export function logDroppedSandboxEvent(
  host: SessionDODelegate,
  input: {
    event: SandboxEvent
    messageStatus: string | null
  },
): void {
  Match.value(input.event.type).pipe(
    Match.when("token", () => undefined),
    Match.orElse(() => host.emitDroppedSandboxEventLog(input)),
  )
}

export function emitDroppedSandboxEventLog(
  host: SessionDODelegate,
  input: {
    event: SandboxEvent
    messageStatus: string | null
  },
): void {
  const observer = host.createInternalRequestObserver("sandbox_event", "session-sandbox-event")
  observer.log.emit({
    event: "session.sandbox_event.dropped_after_terminal_message",
    status: 200,
    boundary: "session.sandbox_event",
    sessionId: host.getSessionId(),
    messageId: getSandboxEventMessageId(input.event),
    messageStatus: input.messageStatus,
    eventType: input.event.type,
  })
}

export function logClientWebSocketAuthFailure(
  host: SessionDODelegate,
  input: {
    reason: "missing_token" | "invalid_or_expired_token"
    clientId?: string | null
    tokenPresent: boolean
    wsId?: string | null
  },
): void {
  const now = Date.now()
  const session = host.getSession()
  const observer = host.createInternalRequestObserver("websocket_auth", "session-websocket-auth")
  observer.log.emit({
    event: "session.websocket.auth_failed",
    status: 401,
    boundary: "session.websocket.subscribe",
    session: {
      id: session?.id ?? host.getSessionId(),
      kind: session?.session_kind ?? null,
      status: session?.status ?? null,
    },
    websocket: {
      reason: input.reason,
      tokenPresent: input.tokenPresent,
      clientId: input.clientId ?? null,
      wsId: input.wsId ?? null,
    },
    tokenDiagnostics: host.repository.getWsTokenDiagnostics(now),
    _forceKeep: true,
  })
}

export function ensureInitialized(host: SessionDODelegate): void {
  Match.value(host.initialized).pipe(
    Match.when(false, () => host.initializeStorage()),
    Match.orElse(() => undefined),
  )
}

export function initializeStorage(host: SessionDODelegate): void {
  initSchema(host.sql)
  host.initialized = true
  host.wsManager.enableAutoPingPong()
}

export function wsManager(host: SessionDODelegate): SessionWebSocketManager {
  host._wsManager ??= new SessionWebSocketManagerImpl(host.ctx, host.repository, WS_AUTH_TIMEOUT_MS)
  return host._wsManager
}

export function lifecycleManager(host: SessionDODelegate): SandboxLifecycleManager {
  host._lifecycleManager ??= createSandboxLifecycleManager({
    env: host.env,
    repository: toSessionRuntimeRepository(host.repository),
    wsManager: toSessionRuntimeWebSocket(host.wsManager),
    broadcast: (message) => host.broadcast(message),
    onEvent: (event) => host.processSandboxEvent(event),
    getGitHubCloneCredentials: () => host.getSandboxCloneCredentials(),
  })
  return host._lifecycleManager
}

export function isolateRuntime(host: SessionDODelegate): IsolateSessionRuntime {
  host._isolateRuntime ??= new IsolateSessionRuntime(host.env, workerTracing)
  return host._isolateRuntime
}

export function routeRequest(
  host: SessionDODelegate,
  request: Request,
  url: URL,
): Promise<Response> | Response {
  const isWebSocketUpgrade = request.headers.get("Upgrade") === "websocket"
  const routeKey = `${request.method} ${url.pathname}`
  const routes: ReadonlyArray<{
    match: boolean
    run: () => Promise<Response> | Response
  }> = [
    {
      match: isWebSocketUpgrade,
      run: () => host.handleWebSocketUpgrade(request, url),
    },
    {
      match: routeKey === "POST /internal/init",
      run: () => host.handleInit(request),
    },
    {
      match: routeKey === "GET /internal/state",
      run: () => host.handleGetState(),
    },
    {
      match: routeKey === "POST /internal/prompt",
      run: () => host.handleEnqueuePrompt(request),
    },
    {
      match: routeKey === "POST /internal/prompt-async",
      run: () => host.handleEnqueuePrompt(request, { waitForCompletion: false }),
    },
    {
      match: routeKey === "POST /internal/resume",
      run: () => host.handleResumePrompt(request),
    },
    {
      match: routeKey === "PATCH /internal/tools",
      run: () => host.handleUpdateTools(request),
    },
    {
      match: routeKey === "POST /internal/stop",
      run: () => host.handleStop(),
    },
    {
      match: routeKey === "GET /internal/events",
      run: () => host.handleListEvents(url),
    },
    {
      match: routeKey === "GET /internal/sandbox/activity",
      run: () => host.handleListRuntimeActivity(url),
    },
    {
      match: routeKey === "GET /internal/messages",
      run: () => host.handleListMessages(url),
    },
    {
      match: routeKey === "GET /internal/artifacts",
      run: () => host.handleListArtifacts(),
    },
    {
      match: routeKey === "POST /internal/ws-token",
      run: () => host.handleGenerateWsToken(request),
    },
    {
      match: routeKey === "POST /internal/verify-sandbox-token",
      run: () => host.handleVerifySandboxToken(request),
    },
    {
      match: routeKey === "POST /internal/archive",
      run: () => host.handleArchive(request),
    },
    {
      match: routeKey === "POST /internal/unarchive",
      run: () => host.handleUnarchive(request),
    },
  ]
  return Option.match(
    Arr.findFirst(routes, (route) => route.match),
    {
      onNone: () => new Response("Not Found", { status: 404 }),
      onSome: (route) => route.run(),
    },
  )
}

export async function alarm(host: SessionDODelegate): Promise<void> {
  host.ensureInitialized()
  await Match.value(host.getSessionKind()).pipe(
    // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object alarm is a platform Promise boundary.
    Match.when("sandbox", () => Effect.runPromise(host.lifecycleManager.handleAlarm())),
    Match.orElse(() => host.handleIsolateInactivityAlarm()),
  )
}

export async function handleIsolateInactivityAlarm(host: SessionDODelegate): Promise<void> {
  const isActiveOrIdle = host.repository
    .getSandbox()
    .pipe(
      Option.filter((current) => current.status !== "running" && Boolean(current.last_activity)),
    )
  Option.match(isActiveOrIdle, {
    onNone: () => undefined,
    onSome: (current) => host.maybeStopInactiveSandbox(current.last_activity),
  })
}

export function maybeStopInactiveSandbox(
  host: SessionDODelegate,
  lastActivity: number | null,
): void {
  const stageMetadata = getStageMetadataSync(host.env)
  const timeoutMs = stageMetadata.app.sandboxInactivityTimeoutMs
  Match.value(Date.now() - (lastActivity ?? 0) >= timeoutMs).pipe(
    Match.when(true, () => host.stopInactiveSandbox()),
    Match.orElse(() => undefined),
  )
}

export function stopInactiveSandbox(host: SessionDODelegate): void {
  host.repository.updateSandboxStatus("stopped")
  host.broadcast({ type: "sandbox_status", status: "stopped" })
}
