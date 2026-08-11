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
  isNonEmptyString,
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

export async function webSocketMessage(
  host: SessionDODelegate,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
  host.ensureInitialized()
  await Match.value(typeof message === "string").pipe(
    Match.when(false, () => Promise.resolve()),
    Match.orElse(() => host.routeWebSocketMessage(ws, message as string)),
  )
}

export function routeWebSocketMessage(
  host: SessionDODelegate,
  ws: WebSocket,
  message: string,
): Promise<void> {
  return Match.value(host.wsManager.classify(ws).kind).pipe(
    Match.when("sandbox", () => host.handleSandboxMessage(message)),
    Match.orElse(() => host.handleClientMessage(ws, message)),
  )
}

export async function webSocketClose(
  host: SessionDODelegate,
  ws: WebSocket,
  code: number,
): Promise<void> {
  host.ensureInitialized()
  Match.value(host.wsManager.classify(ws).kind).pipe(
    Match.when("sandbox", () => host.handleSandboxSocketClose(ws, code)),
    Match.orElse(() => host.handleClientSocketClose(ws)),
  )
}

export function handleSandboxSocketClose(
  host: SessionDODelegate,
  ws: WebSocket,
  code: number,
): void {
  Match.value(host.wsManager.clearSandboxSocketIfMatch(ws)).pipe(
    Match.when(false, () => undefined),
    Match.orElse(() => host.applySandboxSocketClose(code)),
  )
}

export function applySandboxSocketClose(host: SessionDODelegate, code: number): void {
  const status = Match.value(code === 1000 || code === 1001).pipe(
    Match.when(true, () => "stopped" as const),
    Match.orElse(() => "stale" as const),
  )
  host.repository.updateSandboxStatus(status)
  host.broadcast({ type: "sandbox_status", status: host.getSandboxStatus() })
}

export function handleClientSocketClose(host: SessionDODelegate, ws: WebSocket): void {
  Option.match(host.wsManager.removeClient(ws), {
    onNone: () => undefined,
    onSome: (client) => host.broadcastClientLeft(client),
  })
}

export function broadcastClientLeft(host: SessionDODelegate, client: ClientInfo): void {
  host.broadcast({
    type: "sandbox_event",
    event: {
      type: "user_message",
      content: `${client.name} left the session`,
      messageId: generateId(),
      timestamp: Date.now() / 1000,
      author: {
        participantId: client.participantId,
        name: client.name,
      },
    },
  })
}

export async function webSocketError(host: SessionDODelegate, ws: WebSocket): Promise<void> {
  host.ensureInitialized()
  host.wsManager.close(ws, 1011, "internal websocket error")
}

export async function handleWebSocketUpgrade(
  host: SessionDODelegate,
  request: Request,
  url: URL,
): Promise<Response> {
  const isSandbox = url.searchParams.get("type") === "sandbox"
  const validationError = Match.value(isSandbox).pipe(
    Match.when(true, () => host.validateSandboxUpgrade(request)),
    Match.orElse(() => Option.none<Response>()),
  )
  return Option.match(validationError, {
    onNone: () => host.acceptWebSocketUpgrade(request, isSandbox),
    onSome: (response) => Promise.resolve(response),
  })
}

export function validateSandboxUpgrade(
  host: SessionDODelegate,
  request: Request,
): Option.Option<Response> {
  return Option.match(host.repository.getSandbox(), {
    onNone: () => Option.some(new Response("No sandbox", { status: 404 })),
    onSome: (sandbox) => host.validateActiveSandboxUpgrade(request, sandbox),
  })
}

export function validateActiveSandboxUpgrade(
  host: SessionDODelegate,
  request: Request,
  sandbox: SandboxRow,
): Option.Option<Response> {
  const authHeader = request.headers.get("Authorization")
  const sandboxId = request.headers.get("X-Sandbox-ID")
  const checks: ReadonlyArray<{ failed: boolean; respond: () => Response }> = [
    {
      failed:
        sandbox.status === "stopped" || sandbox.status === "stale" || sandbox.status === "failed",
      respond: () => new Response("Sandbox is not active", { status: 410 }),
    },
    {
      failed: !authHeader || authHeader !== `Bearer ${sandbox.auth_token}`,
      respond: () => new Response("Unauthorized", { status: 401 }),
    },
    {
      failed: Boolean(sandbox.sandbox_id && sandboxId && sandboxId !== sandbox.sandbox_id),
      respond: () => new Response("Forbidden: sandbox mismatch", { status: 403 }),
    },
  ]
  return Option.map(
    Arr.findFirst(checks, (check) => check.failed),
    (check) => check.respond(),
  )
}

export async function acceptWebSocketUpgrade(
  host: SessionDODelegate,
  request: Request,
  isSandbox: boolean,
): Promise<Response> {
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)

  await Match.value(isSandbox).pipe(
    Match.when(true, () => host.acceptSandboxSocket(request, server)),
    Match.orElse(() => host.acceptClientSocketWithAuth(server)),
  )

  return new Response(null, { status: 101, webSocket: client })
}

export async function acceptSandboxSocket(
  host: SessionDODelegate,
  request: Request,
  server: WebSocket,
): Promise<void> {
  const sandboxId = request.headers.get("X-Sandbox-ID") ?? undefined
  host.wsManager.acceptAndSetSandboxSocket(server, sandboxId)
  host.repository.updateSandboxStatus("ready")
  host.repository.updateSandboxLastActivity(Date.now())
  await host.scheduleInactivityCheck()
  host.broadcast({ type: "sandbox_status", status: "ready" })
  host.ctx.waitUntil(host.processMessageQueue())
}

export function acceptClientSocketWithAuth(
  host: SessionDODelegate,
  server: WebSocket,
): Promise<void> {
  const wsId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  host.wsManager.acceptClientSocket(server, wsId)
  host.ctx.waitUntil(host.wsManager.enforceAuthTimeout(server, wsId))
  return Promise.resolve()
}

export function handleSandboxMessage(host: SessionDODelegate, message: string): Promise<void> {
  return Option.match(decodeJson(message), {
    onNone: () => host.logSandboxMessageError("invalid sandbox event payload"),
    onSome: (value) =>
      host
        .processSandboxEvent(value as SandboxEvent)
        .catch((errorValue) => host.logSandboxMessageError(errorValue)),
  })
}

export function logSandboxMessageError(
  host: SessionDODelegate,
  errorValue: unknown,
): Promise<void> {
  const observer = host.createInternalRequestObserver("sandbox_message", "session-sandbox-message")
  observer.log.error(toError(errorValue), {
    event: "session.sandbox_message.processing_failed",
    boundary: "session.sandbox_message",
    sessionId: host.getSessionId(),
  })
  return Promise.resolve()
}

export function handleClientMessage(
  host: SessionDODelegate,
  ws: WebSocket,
  message: string,
): Promise<void> {
  return Option.match(decodeJson(message), {
    onNone: () => host.sendInvalidMessage(ws),
    onSome: (value) => host.dispatchClientMessage(ws, value as ClientMessage),
  })
}

export function sendInvalidMessage(host: SessionDODelegate, ws: WebSocket): Promise<void> {
  host.wsManager.send(ws, {
    type: "error",
    code: "INVALID_MESSAGE",
    message: "invalid payload",
  })
  return Promise.resolve()
}

export function dispatchClientMessage(
  host: SessionDODelegate,
  ws: WebSocket,
  data: ClientMessage,
): Promise<void> {
  return Match.value(data).pipe(
    Match.when({ type: "ping" }, () => host.sendPong(ws)),
    Match.when({ type: "subscribe" }, (message) => host.handleSubscribe(ws, message)),
    Match.when({ type: "typing" }, () => host.handleTyping()),
    Match.when({ type: "prompt" }, (message) => host.handlePromptMessage(ws, message)),
    Match.when({ type: "stop" }, () => host.stopExecution()),
    Match.when({ type: "interaction_reply" }, (message) =>
      host.handleInteractionReply(ws, message),
    ),
    Match.when({ type: "fetch_history" }, (message) =>
      Promise.resolve(host.handleFetchHistory(ws, message)),
    ),
    Match.when({ type: "presence" }, (message) => host.applyPresence(ws, message.status)),
    Match.orElse(() => Promise.resolve()),
  )
}

export async function handleInteractionReply(
  host: SessionDODelegate,
  ws: WebSocket,
  data: OpenCodeInteractionResponse,
): Promise<void> {
  await Option.match(host.getClientInfo(ws), {
    onNone: () => Promise.resolve(host.sendNotSubscribed(ws, "must subscribe before replying")),
    onSome: async (client) => {
      try {
        await host.resolveRuntimeInteraction(client, data)
      } catch (errorValue) {
        host.wsManager.send(ws, {
          type: "error",
          code: "INTERACTION_REPLY_FAILED",
          message: toError(errorValue).message,
        })
      }
    },
  })
}

export function sendPong(host: SessionDODelegate, ws: WebSocket): Promise<void> {
  host.wsManager.send(ws, { type: "pong", timestamp: Date.now() })
  return Promise.resolve()
}

export function applyPresence(
  host: SessionDODelegate,
  ws: WebSocket,
  status: ClientInfo["status"],
): Promise<void> {
  Option.match(host.getClientInfo(ws), {
    onNone: () => undefined,
    onSome: (client) => host.updateClientPresence(client, status),
  })
  return Promise.resolve()
}

export function updateClientPresence(
  host: SessionDODelegate,
  client: ClientInfo,
  status: ClientInfo["status"],
): void {
  client.status = status
  client.lastSeen = Date.now()
}

export function clientWsId(host: SessionDODelegate, parsed: ParsedTags) {
  return Option.getOrNull(host.clientWsIdOption(parsed))
}

export function clientWsIdOption(
  host: SessionDODelegate,
  parsed: ParsedTags,
): Option.Option<string> {
  return Match.value(parsed).pipe(
    Match.when({ kind: "client" }, (client) => Option.fromNullishOr(client.wsId)),
    Match.orElse(() => Option.none<string>()),
  )
}

export async function handleSubscribe(
  host: SessionDODelegate,
  ws: WebSocket,
  data: { token: string; clientId: string },
): Promise<void> {
  const parsed = host.wsManager.classify(ws)
  await Match.value(isNonEmptyString(data.token)).pipe(
    Match.when(false, () =>
      Promise.resolve(host.rejectSubscribeMissingToken(ws, parsed, data.clientId)),
    ),
    Match.orElse(() => host.authorizeSubscribe(ws, parsed, data)),
  )
}

export function rejectSubscribeMissingToken(
  host: SessionDODelegate,
  ws: WebSocket,
  parsed: ParsedTags,
  clientId: string,
): void {
  host.logClientWebSocketAuthFailure({
    reason: "missing_token",
    clientId,
    tokenPresent: false,
    wsId: host.clientWsId(parsed),
  })
  host.wsManager.close(ws, 4001, "Missing session websocket token")
}

export async function authorizeSubscribe(
  host: SessionDODelegate,
  ws: WebSocket,
  parsed: ParsedTags,
  data: { token: string; clientId: string },
): Promise<void> {
  const now = Date.now()
  // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object websocket auth handler remains a Promise boundary.
  const tokenHash = await Effect.runPromise(hashToken(data.token))
  const participant = host.repository.getParticipantByWsTokenHash(tokenHash, now, WS_TOKEN_TTL_MS)
  Option.match(participant, {
    onNone: () => host.rejectSubscribeInvalidToken(ws, parsed, data.clientId),
    onSome: (resolved) => host.completeSubscribe(ws, parsed, data, resolved),
  })
}

export function rejectSubscribeInvalidToken(
  host: SessionDODelegate,
  ws: WebSocket,
  parsed: ParsedTags,
  clientId: string,
): void {
  host.logClientWebSocketAuthFailure({
    reason: "invalid_or_expired_token",
    clientId,
    tokenPresent: true,
    wsId: host.clientWsId(parsed),
  })
  host.wsManager.close(ws, 4001, "Invalid or expired session websocket token")
}

export function completeSubscribe(
  host: SessionDODelegate,
  ws: WebSocket,
  parsed: ParsedTags,
  data: { token: string; clientId: string },
  participant: ParticipantRow,
): void {
  const clientInfo: ClientInfo = {
    participantId: participant.id,
    userId: participant.user_id,
    name: participant.github_name || participant.github_login || participant.user_id,
    status: "active",
    lastSeen: Date.now(),
    clientId: data.clientId,
    ws,
  }
  host.wsManager.setClient(ws, clientInfo)
  Option.match(host.clientWsIdOption(parsed), {
    onNone: () => undefined,
    onSome: (wsId) => host.wsManager.persistClientMapping(wsId, participant.id, data.clientId),
  })

  host.wsManager.send(ws, {
    type: "subscribed",
    sessionId: host.getSessionId(),
    state: host.getSessionState(),
    participantId: participant.id,
    participant: {
      participantId: participant.id,
      name: clientInfo.name,
    },
  } satisfies ServerMessage)

  host.wsManager.send(ws, {
    type: "runtime_activity_snapshot",
    activity: host.listSerializedRuntimeActivity(100),
  })

  host.sendSubscribeReplay(ws)
}

export function sendSubscribeReplay(host: SessionDODelegate, ws: WebSocket): void {
  const paginationWindow = host.repository.events.getEventsForReplay(500)
  const replay = host.repository.events.getEventsForReplayWithSubagentHistory(500)
  replay.forEach((row) => host.sendReplayEvent(ws, row))

  host.wsManager.send(ws, {
    type: "replay_complete",
    hasMore: paginationWindow.length >= 500,
    cursor: host.replayCursor(paginationWindow[0]),
  })

  host.repository.listArtifacts().forEach((artifact) =>
    host.wsManager.send(ws, {
      type: "artifact_created",
      artifact: host.serializeArtifact(artifact),
    }),
  )

  host.wsManager.send(ws, {
    type: "processing_status",
    isProcessing: host.repository.getProcessingMessage() !== null,
  })
}

export function sendReplayEvent(
  host: SessionDODelegate,
  ws: WebSocket,
  row: { data: string },
): void {
  Option.match(decodeJson(row.data), {
    onNone: () => undefined,
    onSome: (event) =>
      host.wsManager.send(ws, {
        type: "sandbox_event",
        event: event as SandboxEvent,
      }),
  })
}

export function replayCursor(
  host: SessionDODelegate,
  oldest: { created_at: number; id: string } | undefined,
) {
  return Option.match(Option.fromNullishOr(oldest), {
    onNone: () => null,
    onSome: (row) => ({ timestamp: row.created_at, id: row.id }),
  })
}

export async function handleTyping(host: SessionDODelegate): Promise<void> {
  await Match.value(host.getSessionKind()).pipe(
    // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object websocket handler is a platform Promise boundary.
    Match.when("sandbox", () => Effect.runPromise(host.lifecycleManager.warmSandbox())),
    Match.orElse(() => host.syncIsolateRuntime()),
  )
}

export function getClientInfo(host: SessionDODelegate, ws: WebSocket): Option.Option<ClientInfo> {
  return Option.orElse(host.wsManager.getClient(ws), () => host.recoverClientInfo(ws))
}

export function recoverClientInfo(
  host: SessionDODelegate,
  ws: WebSocket,
): Option.Option<ClientInfo> {
  return Option.map(host.wsManager.recoverClientMapping(ws), (mapping) =>
    host.buildAndCacheClientInfo(ws, mapping),
  )
}

export function buildAndCacheClientInfo(
  host: SessionDODelegate,
  ws: WebSocket,
  mapping: {
    participant_id: string
    user_id: string
    github_name: string | null
    github_login: string | null
    client_id: string
  },
): ClientInfo {
  const info: ClientInfo = {
    participantId: mapping.participant_id,
    userId: mapping.user_id,
    name: mapping.github_name || mapping.github_login || mapping.user_id,
    status: "active",
    lastSeen: Date.now(),
    clientId: mapping.client_id,
    ws,
  }
  host.wsManager.setClient(ws, info)
  return info
}

export async function handlePromptMessage(
  host: SessionDODelegate,
  ws: WebSocket,
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
  await Option.match(host.getClientInfo(ws), {
    onNone: () => Promise.resolve(host.sendNotSubscribed(ws, "must subscribe before prompting")),
    onSome: (client) => host.enqueueClientPrompt(ws, client, data),
  })
}
