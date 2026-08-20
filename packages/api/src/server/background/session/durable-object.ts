import { DurableObject, tracing as workerTracing } from "cloudflare:workers"
import type { AgentToolEventMessage } from "agents"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  getGitHubRepoTool,
  getSelectedMcpcfServerIds,
  getStageMetadataSync,
  normalizeIsolateStepLimit,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  parseStoredOpenCodeMcpServers,
  parseSessionArtifactMetadata,
  parseStoredSessionTools,
  resolveAgentRuntime,
  type AgentRuntime,
  type OpenCodeInteractionRequest,
  type OpenCodeInteractionResponse,
  type RuntimeActivityEvent,
  type SessionArtifactMetadata,
  type SessionKind,
  type SessionRuntimeCapabilities,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
} from "@solzero/shared"
import { generateId, hashToken } from "../auth/crypto"
import {
  resolveGitHubCloneCredentials,
  type GitHubCloneCredentials,
} from "../auth/github-clone-auth"
import {
  type IsolateSessionConfig,
  type IsolateWarmResult,
  IsolateSessionRuntime,
} from "../isolate/runtime"
import {
  createSandboxLifecycleManager,
  type SandboxLifecycleManager,
} from "../sandbox/lifecycle/manager"
import type {
  Attachment,
  ClientInfo,
  ClientMessage,
  Env,
  PromptExecutionMode,
  SandboxEvent,
  ServerMessage,
  SessionState,
} from "../types"
import { getGitHubAppUserAccessTokenForUserId } from "../../lib/better-auth"
import { createApiRequestObserver } from "../../effect/services/observability"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  BackgroundTracing,
  localSpanContextFromHeaders,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- session Durable Object is a composition root. It builds the tracing layer at Effect.runPromise edges.
  makeBackgroundTracingLayer,
  type LocalSpanContext,
} from "../observability/tracing"
import { createGlobalSecretsStoreFromD1 } from "../db/repo-secrets"
import { decodeJson, parseJson, parseJsonArray, stringifyJson } from "../../lib/json"
import { toError, toErrorWithFallback } from "../../lib/effect-errors"
import { SessionRepository, toSessionRuntimeRepository } from "./repository"
import { buildResolvedSessionMcpServers } from "./runtime-mcp"
import { initSchema } from "./schema"
import { handleResumePromptRequest } from "./resume"
import { runIsolatePromptWithEvents } from "./isolate-prompt-bridge"
import { projectSubagentSessionEvent } from "../isolate/agent/subagent-event-projection"
import {
  getSandboxEventMessageId,
  isStoppedByUserMessage,
  shouldProcessSandboxEventForMessage,
  STOPPED_BY_USER_ERROR,
} from "./event-gating"
import type {
  ArtifactRow,
  MessageRow,
  ParticipantRow,
  RuntimeActivityRow,
  SandboxRow,
  SessionRow,
} from "./types"
import {
  type ParsedTags,
  type SessionWebSocketManager,
  SessionWebSocketManagerImpl,
  toSessionRuntimeWebSocket,
} from "./websocket-manager"
import {
  webSocketMessage,
  routeWebSocketMessage,
  webSocketClose,
  handleSandboxSocketClose,
  applySandboxSocketClose,
  handleClientSocketClose,
  broadcastClientLeft,
  webSocketError,
  handleWebSocketUpgrade,
  validateSandboxUpgrade,
  validateActiveSandboxUpgrade,
  acceptWebSocketUpgrade,
  acceptSandboxSocket,
  acceptClientSocketWithAuth,
  handleSandboxMessage,
  logSandboxMessageError,
  handleClientMessage,
  sendInvalidMessage,
  dispatchClientMessage,
  sendPong,
  applyPresence,
  updateClientPresence,
  clientWsId,
  clientWsIdOption,
  handleSubscribe,
  rejectSubscribeMissingToken,
  authorizeSubscribe,
  rejectSubscribeInvalidToken,
  completeSubscribe,
  sendSubscribeReplay,
  sendReplayEvent,
  replayCursor,
  handleTyping,
  getClientInfo,
  recoverClientInfo,
  buildAndCacheClientInfo,
  handlePromptMessage,
} from "./durable-object/websocket"
import {
  processMessageQueue,
  canProcessQueue,
  nextQueuedMessage,
  runQueuedMessage,
  buildQueuedMessageContext,
  messageSpanAttributes,
  processQueuedMessage,
  processQueuedMessageEffect,
  ensureRuntimeReady,
  ensureSandboxEffect,
  ensureIsolateReadySpan,
  runPromptExecution,
  runSandboxPrompt,
  runSandboxPromptEffect,
  runIsolatePrompt,
  runIsolatePromptEvents,
  maybeCompleteIsolatePrompt,
  completeIsolatePrompt,
  handlePromptFailure,
  clearTerminalDiscoveryEffect,
  promptFailureMessage,
  applyPromptFailure,
  reportPromptFailure,
  reportNonSandboxFailure,
  failNonSandboxRuntime,
  emitPromptErrorEvent,
  processSandboxEvent,
  recordHeartbeat,
  processNonHeartbeatEvent,
  droppedEventMessageStatus,
  dropStatusForMessage,
  persistSandboxEvent,
  maybeWriteStreamDelta,
  writeTokenDelta,
  streamForMessage,
  applyStreamDelta,
  maybeCompleteExecution,
  completeExecutionIfMessage,
  completionStatus,
  finalizeExecutionStream,
  completeExecution,
  stopExecution,
  stopProcessingMessage,
  resolveStopRuntimeId,
  stopRuntimeExecution,
  stopIsolateRuntime,
  stopIsolatePromptEffect,
  logIsolateStopFailureEffect,
  broadcast,
} from "./durable-object/processing"
import {
  getSessionState,
  reconcileSandboxStatusIfSandbox,
  getSession,
  getSessionId,
  getSessionKind,
  getAgentRuntime,
  getSessionOwner,
  buildIsolateSessionConfig,
  buildIsolateConfigFor,
  resolveSecretEnv,
  decryptSecretEnv,
  getIsolateCloneAuth,
  getIsolateCloneAuthEffect,
  getSandboxCloneCredentials,
  getSandboxCloneCredentialsEffect,
  repoBackedSessionOwner,
  resolveCloneCredentialsEffect,
  syncIsolateRuntime,
  syncIsolateRuntimeEffect,
  finalizeWarmFailure,
  maybeBroadcastSandboxError,
  finalizeWarmSuccess,
  isIsolateRuntimeReady,
  ensureIsolateReady,
  warmIsolateRuntime,
  registerIsolateStream,
  closeIsolateStream,
  closeStream,
  failIsolateStream,
} from "./durable-object/runtime-state"
import {
  handleInit,
  warmRuntimeForKind,
  handleGetState,
  serializeSessionState,
  serializeSandbox,
  handleEnqueuePrompt,
  enqueuePromptValidationError,
  enqueueValidatedPrompt,
  resolveParticipantByUserId,
  dispatchEnqueuedPrompt,
  startStreamedPrompt,
  startQueuedPrompt,
  startBackgroundQueuedPrompt,
  startAwaitedQueuedPrompt,
  logAsyncPromptQueueError,
  handleResumePrompt,
  handleUpdateTools,
  updateToolsForUser,
  updateToolsForSession,
  applyToolUpdate,
  repoChangeError,
  existingRepoChangeError,
  attachRepoError,
  commitToolUpdate,
  syncToolingRuntime,
  syncRuntimeForKind,
  broadcastSessionState,
} from "./durable-object/rpc"
import {
  createInternalRequestObserver,
  logMessageQueueFailure,
  logPromptStopped,
  logIsolateStopFailure,
  logDroppedSandboxEvent,
  emitDroppedSandboxEventLog,
  logClientWebSocketAuthFailure,
  ensureInitialized,
  initializeStorage,
  wsManager,
  lifecycleManager,
  isolateRuntime,
  routeRequest,
  alarm,
  handleIsolateInactivityAlarm,
  maybeStopInactiveSandbox,
  stopInactiveSandbox,
} from "./durable-object/core"
import {
  handleStop,
  handleListEvents,
  handleListRuntimeActivity,
  listSerializedRuntimeActivity,
  handleListMessages,
  handleListArtifacts,
  handleGenerateWsToken,
  generateWsTokenForUser,
  ensureWsParticipant,
  createWsParticipant,
  issueWsToken,
  handleVerifySandboxToken,
  verifySandboxToken,
  matchSandboxToken,
  matchSandboxAuthToken,
  serializeArtifact,
  serializeRuntimeActivity,
  handleArchive,
  archiveSession,
  archiveResolvedSession,
  teardownArchivedRuntime,
  revertArchive,
  finalizeArchive,
  broadcastArchivedProcessing,
  handleUnarchive,
  unarchiveSession,
  unarchiveResolvedSession,
} from "./durable-object/query-archive"
import { installSessionDOCoreBindings } from "./durable-object/core-bindings"
import { installSessionDOWebSocketBindings } from "./durable-object/websocket-bindings"
import { installSessionDOProcessingBindings } from "./durable-object/processing-bindings"
import { installSessionDORuntimeStateBindings } from "./durable-object/runtime-state-bindings"
import { installSessionDORpcBindings } from "./durable-object/rpc-bindings"
import { installSessionDOQueryArchiveBindings } from "./durable-object/query-archive-bindings"

export const WS_AUTH_TIMEOUT_MS = 30_000
export const WS_TOKEN_TTL_MS = 5 * 60_000

export class IsolateRuntimeUnavailableError extends Schema.TaggedError<IsolateRuntimeUnavailableError>()(
  "IsolateRuntimeUnavailableError",
  { message: Schema.String },
) {}

export function promiseEffect<A>(thunk: () => Promise<A>) {
  return Effect.tryPromise({ try: thunk, catch: toError })
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function parseAttachmentsJson(json: string): Attachment[] {
  const parsed = parseJson(json) as Array<{
    type: string
    name: string
    url?: string
    content?: string
    mimeType?: string
  }>

  return parsed
    .filter((item) => item.type === "file" || item.type === "image" || item.type === "url")
    .map((item) => ({
      type: item.type as Attachment["type"],
      name: item.name,
      url: item.url,
      content: item.content,
      mimeType: item.mimeType,
    }))
}

export function parseAttachments(attachmentsJson: string | null) {
  return Option.getOrUndefined(
    Option.map(Option.liftPredicate(attachmentsJson, isNonEmptyString), parseAttachmentsJson),
  )
}

// oxlint-disable-next-line s0-lint/prefer-option-over-null -- Promise-side Durable Object artifact reader; callers still branch on null until those surfaces convert to Effect.
export function parseArtifactMetadata(value: string | null): SessionArtifactMetadata | null {
  return Option.getOrNull(Option.flatMap(decodeJson(value), parseSessionArtifactMetadata))
}

export function getSessionTools(session: SessionRow | null) {
  return parseStoredSessionTools(session?.tools_json)
}

export function getSessionCustomMcpServers(session: SessionRow | null): OpenCodeMcpServers {
  return parseStoredOpenCodeMcpServers(session?.custom_mcp_json)
}

export function parseStoredSecretKeys(value: string | null | undefined): string[] {
  return parseJsonArray(value).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
}

export function getSessionCapabilities(session: SessionRow | null): SessionRuntimeCapabilities {
  const tools = getSessionTools(session)
  return {
    agentRuntime: resolveAgentRuntime({
      agentRuntime: session?.agent_runtime,
      sessionKind: session?.session_kind,
    }),
    supportsWorkspace: true,
    supportsGit: true,
    supportsDocs: tools.some((tool) => tool.kind === "ai_search"),
    supportsRepoWorkspace: Boolean(getGitHubRepoTool(tools)),
  }
}

export function summarizeToolsForLog(tools: readonly SessionToolSpec[]) {
  const kinds = tools.reduce<Record<string, number>>(
    (counts, tool) => ({
      ...counts,
      [tool.kind]: (counts[tool.kind] ?? 0) + 1,
    }),
    {},
  )
  const mcpcfServers = getSelectedMcpcfServerIds(tools).map((id) => ({ id }))

  return {
    count: tools.length,
    kinds,
    mcpcfServers,
  }
}

export function summarizeCustomMcpServersForLog(customMcpServers: OpenCodeMcpServers) {
  return {
    count: Object.keys(customMcpServers).length,
    enabledServerNames: Object.entries(customMcpServers)
      .filter(([, server]) => server.enabled !== false)
      .map(([name]) => name),
  }
}

export type QueuedMessageContext = {
  message: MessageRow
  author: ParticipantRow | null
  session: SessionRow | null
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  sessionTools: ReturnType<typeof getSessionTools>
  sessionCustomMcpServers: OpenCodeMcpServers
  resolvedModel: string
  resolvedReasoningEffort: string | null
  attachments: ReturnType<typeof parseAttachments>
}

export type TokenSandboxEvent = Extract<SandboxEvent, { type: "token" }>
export type ExecutionCompleteSandboxEvent = Extract<SandboxEvent, { type: "execution_complete" }>
export type IsolateStreamState = {
  writer: WritableStreamDefaultWriter<Uint8Array>
  text: string
}
export type PendingRuntimeInteraction = {
  request: OpenCodeInteractionRequest
  resolve: (response: OpenCodeInteractionResponse) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}
export type WsTokenBody = {
  userId: string
  githubLogin?: string
  githubName?: string
  githubEmail?: string
}
export type UpdateToolsBody = {
  userId?: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number | null
  subagents?: SubagentMode | null
}

function resolvedModel(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((model) => model.length > 0),
  )
}

export class SessionDO extends DurableObject<Env> {
  private initialized = false
  private readonly sql: SqlStorage
  private readonly repository: SessionRepository
  private _wsManager: SessionWebSocketManager | null = null
  private _lifecycleManager: SandboxLifecycleManager | null = null
  private _isolateRuntime: IsolateSessionRuntime | null = null
  private readonly terminalMcpDiscoveryErrorMessageIds = new Set<string>()
  private readonly pendingRuntimeInteractions = new Map<string, PendingRuntimeInteraction>()
  private readonly isolateStreamState = new Map<
    string,
    { writer: WritableStreamDefaultWriter<Uint8Array>; text: string }
  >()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.repository = new SessionRepository(this.sql, (row, previousCreatedAt) => {
      this.broadcastRuntimeActivity(row, previousCreatedAt)
    })
  }

  private get wsManager(): SessionWebSocketManager {
    return wsManager(this)
  }
  private get lifecycleManager(): SandboxLifecycleManager {
    return lifecycleManager(this)
  }
  private get isolateRuntime(): IsolateSessionRuntime {
    return isolateRuntime(this)
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureInitialized()
    const url = new URL(request.url)
    return this.routeRequest(request, url)
  }

  async persistIsolateSubagentToolEvent(
    messageId: string,
    message: AgentToolEventMessage,
    lifecycleTimestampMs?: number,
  ): Promise<void> {
    this.ensureInitialized()
    const now = Option.getOrElse(Option.fromNullishOr(lifecycleTimestampMs), () => Date.now())
    const sandboxId =
      Option.getOrNull(this.repository.getRuntimeLifecycle())?.runtimeId ?? this.getSessionId()
    await this.persistSandboxEvent(
      projectSubagentSessionEvent({
        message,
        messageId,
        sandboxId,
        timestamp: now / 1000,
      }),
      now,
    )
  }

  private sendNotSubscribed(ws: WebSocket, message: string): void {
    this.wsManager.send(ws, {
      type: "error",
      code: "NOT_SUBSCRIBED",
      message,
    })
  }

  private enqueueClientPrompt(
    ws: WebSocket,
    client: ClientInfo,
    data: {
      content: string
      model?: string
      reasoningEffort?: string
      attachments?: Array<{
        type: string
        name: string
        url?: string
        content?: string
      }>
    },
  ): Promise<void> {
    return Match.value(this.getSession()?.status === "archived").pipe(
      Match.when(true, () => Promise.resolve(this.sendSessionArchivedError(ws))),
      Match.orElse(() => this.createAndQueueClientPrompt(ws, client, data)),
    )
  }

  private sendSessionArchivedError(ws: WebSocket): void {
    this.wsManager.send(ws, {
      type: "error",
      code: "SESSION_ARCHIVED",
      message: "Unarchive this session to continue.",
    })
  }

  private async createAndQueueClientPrompt(
    ws: WebSocket,
    client: ClientInfo,
    data: {
      content: string
      model?: string
      reasoningEffort?: string
      attachments?: Array<{
        type: string
        name: string
        url?: string
        content?: string
      }>
    },
  ): Promise<void> {
    const model = Option.orElse(resolvedModel(data.model), () =>
      resolvedModel(this.getSession()?.model),
    )

    return Option.match(model, {
      onNone: () => Promise.resolve(this.sendModelRequiredError(ws)),
      onSome: async (resolvedModel) => {
        const messageId = generateId()
        const now = Date.now()
        const participant = this.resolveParticipant(client)

        this.repository.createMessage({
          id: messageId,
          authorId: participant.id,
          content: data.content,
          source: "web",
          model: resolvedModel,
          reasoningEffort: data.reasoningEffort ?? null,
          executionMode: "sync",
          attachments: this.stringifyOptionalJson(data.attachments),
          status: "pending",
          createdAt: now,
        })

        const userEvent: SandboxEvent = {
          type: "user_message",
          content: data.content,
          messageId,
          timestamp: now / 1000,
          author: {
            participantId: participant.id,
            name: participant.github_name || participant.github_login || participant.user_id,
          },
        }
        this.repository.events.createEvent({
          id: generateId(),
          type: "user_message",
          data: stringifyJson(userEvent),
          messageId,
          createdAt: now,
        })
        this.broadcast({ type: "sandbox_event", event: userEvent })

        this.wsManager.send(ws, {
          type: "prompt_queued",
          messageId,
          position: this.repository.getPendingOrProcessingCount(),
        })

        await this.processMessageQueue()
      },
    })
  }

  private sendModelRequiredError(ws: WebSocket): void {
    this.wsManager.send(ws, {
      type: "error",
      code: "MODEL_REQUIRED",
      message: "Choose a model or set a default model before sending a prompt.",
    })
  }

  private resolveParticipant(client: ClientInfo): ParticipantRow {
    return Option.getOrElse(this.repository.getParticipantByUserId(client.userId), () =>
      this.createParticipant(client.userId, client.name),
    )
  }

  private stringifyOptionalJson(value: unknown) {
    return Option.getOrNull(
      Option.map(Option.fromNullishOr(value), (resolved) => stringifyJson(resolved)),
    )
  }

  private handleFetchHistory(
    ws: WebSocket,
    data: {
      cursor: { timestamp: number; id: string }
      limit?: number
    },
  ): void {
    Option.match(this.getClientInfo(ws), {
      onNone: () => this.sendNotSubscribed(ws, "must subscribe first"),
      onSome: () => this.sendHistoryPage(ws, data),
    })
  }

  private sendHistoryPage(
    ws: WebSocket,
    data: { cursor: { timestamp: number; id: string }; limit?: number },
  ): void {
    const limit = Math.min(Math.max(data.limit ?? 200, 1), 500)
    const page = this.repository.events.getEventsHistoryPage(
      data.cursor.timestamp,
      data.cursor.id,
      limit,
    )
    this.wsManager.send(ws, {
      type: "history_page",
      items: page.events.map((row) => parseJson(row.data) as SandboxEvent),
      hasMore: page.hasMore,
      cursor: this.replayCursor(page.events[0]),
    })
  }

  private broadcastRuntimeActivity(
    row: RuntimeActivityRow,
    previousCreatedAt: number | null,
  ): void {
    this.broadcast({
      type: "runtime_activity",
      activity: this.serializeRuntimeActivity(row, previousCreatedAt),
    })
  }

  private getSession() {
    return getSession(this) as SessionRow | null
  }

  private abortStream(
    messageId: string,
    stream: IsolateStreamState,
    errorMessage: string,
  ): Promise<void> {
    this.isolateStreamState.delete(messageId)
    return stream.writer.abort(new Error(errorMessage))
  }

  private getSandboxStatus(): string {
    return Option.getOrNull(this.repository.getSandbox())?.status ?? "pending"
  }

  private createParticipant(userId: string, name: string): ParticipantRow {
    const id = generateId()
    const now = Date.now()
    this.repository.createParticipant({
      id,
      userId,
      githubName: name,
      role: "member",
      joinedAt: now,
    })
    return Option.getOrThrowWith(
      this.repository.getParticipantById(id),
      () => new Error("Participant not found after creation"),
    )
  }

  private async scheduleInactivityCheck(): Promise<void> {
    const stageMetadata = getStageMetadataSync(this.env)
    const timeout = stageMetadata.app.sandboxInactivityTimeoutMs
    await this.ctx.storage.setAlarm(Date.now() + timeout)
  }
}
export interface SessionDO {
  [key: string]: any
}
installSessionDOCoreBindings(SessionDO)
installSessionDOWebSocketBindings(SessionDO)
installSessionDOProcessingBindings(SessionDO)
installSessionDORuntimeStateBindings(SessionDO)
installSessionDORpcBindings(SessionDO)
installSessionDOQueryArchiveBindings(SessionDO)
