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
  resolveSessionSubagentMode,
  sessionSubagentModeField,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  resolveAgentRuntime,
  sessionKindForAgentRuntime,
  type AgentRuntime,
  type RuntimeActivityEvent,
  type SessionCallbackContext,
  type SessionKind,
  type SessionRuntimeCapabilities,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
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
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- session Durable Object rpc is a composition root. It builds the tracing layer at Effect.runPromise edges.
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

type InitRequestBody = {
  sessionName: string
  sessionKind: "isolate" | "sandbox"
  agentRuntime?: AgentRuntime | string | null
  serverUrl?: string | null
  title: string | null
  repoOwner: string
  repoName: string
  githubInstallationId?: number | null
  githubRepoId?: number | null
  repoDefaultBranch?: string | null
  branchName?: string | null
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretKeys?: string[]
  isolateStepLimit?: number | null
  subagents?: SubagentMode | null
  model?: string
  reasoningEffort?: string | null
  userId: string
  githubLogin?: string | null
  githubName?: string | null
  githubEmail?: string | null
}

type EnqueuePromptBody = {
  content: string
  authorId: string
  source: string
  model?: string
  reasoningEffort?: string
  executionMode?: PromptExecutionMode
  attachments?: Array<{ type: string; name: string; url?: string }>
  callbackContext?: SessionCallbackContext
}

function resolvedModel(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((raw) => raw.trim()),
    Option.filter((model) => model.length > 0),
  )
}

export async function handleInit(host: SessionDODelegate, request: Request): Promise<Response> {
  const body = (await request.json()) as InitRequestBody

  return Option.match(resolvedModel(body.model), {
    onNone: () =>
      Response.json({ error: "Session creation requires a resolved model." }, { status: 400 }),
    onSome: (model) => initializeSession(host, body, model),
  })
}

function initializeSession(
  host: SessionDODelegate,
  body: InitRequestBody,
  model: string,
): Response {
  const now = Date.now()
  const sessionId = host.ctx.id.toString()
  const agentRuntime = resolveAgentRuntime({
    agentRuntime: body.agentRuntime,
    sessionKind: body.sessionKind,
  })
  const sessionKind = sessionKindForAgentRuntime(agentRuntime)
  host.repository.upsertSession({
    id: sessionId,
    sessionName: body.sessionName,
    sessionKind,
    agentRuntime,
    title: body.title ?? null,
    repoOwner: body.repoOwner,
    repoName: body.repoName,
    githubInstallationId: body.githubInstallationId ?? null,
    githubRepoId: body.githubRepoId ?? null,
    repoDefaultBranch: body.repoDefaultBranch ?? null,
    branchName: body.branchName ?? null,
    tools: normalizeSessionTools(body.tools),
    customMcpServers: normalizeOpenCodeMcpServers(body.customMcpServers),
    secretKeys: body.secretKeys ?? [],
    isolateStepLimit: normalizeIsolateStepLimit(body.isolateStepLimit, DEFAULT_ISOLATE_STEP_LIMIT),
    subagents: resolveSessionSubagentMode(sessionKind, body.subagents),
    model,
    reasoningEffort: body.reasoningEffort ?? null,
    status: "created",
    createdAt: now,
    updatedAt: now,
  })

  const sandboxId = generateId()
  host.repository.createSandbox({
    id: sandboxId,
    status: "pending",
    createdAt: 0,
  })

  const participantId = generateId()
  host.repository.createParticipant({
    id: participantId,
    userId: body.userId,
    githubLogin: body.githubLogin ?? null,
    githubName: body.githubName ?? null,
    githubEmail: body.githubEmail ?? null,
    role: "owner",
    joinedAt: now,
  })

  host.warmRuntimeForKind(sessionKind)

  return Response.json({
    sessionId: body.sessionName,
    sessionKind,
    agentRuntime,
    status: "created",
  })
}

export function warmRuntimeForKind(host: SessionDODelegate, sessionKind: SessionKind): void {
  Match.value(sessionKind).pipe(
    Match.when("sandbox", () =>
      // oxlint-disable-next-line effect/effect-run-in-body -- ctx.waitUntil requires a Promise at the Durable Object boundary.
      host.ctx.waitUntil(Effect.runPromise(host.lifecycleManager.warmSandbox())),
    ),
    Match.orElse(() => host.ctx.waitUntil(host.syncIsolateRuntime())),
  )
}

export function handleGetState(host: SessionDODelegate): Response {
  const state = host.getSessionState()
  return Option.match(Option.fromNullishOr(state.id), {
    onNone: () => new Response("Session not found", { status: 404 }),
    onSome: () => host.serializeSessionState(state),
  })
}

export function serializeSessionState(host: SessionDODelegate, state: SessionState): Response {
  return Response.json({
    id: state.id,
    sessionKind: state.sessionKind,
    agentRuntime: state.agentRuntime,
    title: state.title,
    repoOwner: state.repoOwner,
    repoName: state.repoName,
    tools: state.tools ?? [],
    customMcpServers: state.customMcpServers ?? {},
    isolateStepLimit: state.isolateStepLimit,
    ...sessionSubagentModeField(state.sessionKind, state.subagents),
    status: state.status,
    sandboxStatus: state.sandboxStatus,
    runtimeStatus: state.runtimeStatus,
    runtimeError: state.runtimeError,
    capabilities: state.capabilities,
    model: state.model,
    reasoningEffort: state.reasoningEffort,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    sandbox: host.serializeSandbox(),
  })
}

export function serializeSandbox(host: SessionDODelegate) {
  return Option.match(host.repository.getSandbox(), {
    onNone: () => null,
    onSome: (sandbox) => ({
      id: sandbox.id,
      sandboxId: sandbox.sandbox_id,
      status: sandbox.status,
      lastHeartbeat: sandbox.last_heartbeat,
      lastSpawnError: sandbox.last_spawn_error,
      lastSpawnErrorAt: sandbox.last_spawn_error_at,
    }),
  })
}

export async function handleEnqueuePrompt(
  host: SessionDODelegate,
  request: Request,
  options: { waitForCompletion?: boolean } = {},
): Promise<Response> {
  const body = (await request.json()) as {
    content: string
    authorId: string
    source: string
    model?: string
    reasoningEffort?: string
    executionMode?: PromptExecutionMode
    attachments?: Array<{ type: string; name: string; url?: string }>
    callbackContext?: SessionCallbackContext
  }

  const executionMode = body.executionMode ?? "sync"
  return Option.match(host.enqueuePromptValidationError(executionMode), {
    onNone: () => host.enqueueValidatedPrompt(request, body, executionMode, options),
    onSome: (response) => Promise.resolve(response),
  })
}

export function enqueuePromptValidationError(
  host: SessionDODelegate,
  executionMode: PromptExecutionMode,
): Option.Option<Response> {
  const checks = [
    {
      when: host.getSession()?.status === "archived",
      response: () =>
        Response.json({ error: "Session is archived. Unarchive it to continue." }, { status: 409 }),
    },
    {
      when: executionMode === "stream" && host.getSessionKind() !== "isolate",
      response: () =>
        Response.json(
          {
            error: "Prompt streaming is only supported for isolate sessions.",
          },
          { status: 409 },
        ),
    },
    {
      when: executionMode === "stream" && host.repository.getPendingOrProcessingCount() > 0,
      response: () =>
        Response.json(
          {
            error: "Cannot start a streamed prompt while another prompt is pending.",
          },
          { status: 409 },
        ),
    },
  ]
  return Option.map(
    Arr.findFirst(checks, (check) => check.when),
    (check) => check.response(),
  )
}

export function enqueueValidatedPrompt(
  host: SessionDODelegate,
  request: Request,
  body: EnqueuePromptBody,
  executionMode: PromptExecutionMode,
  options: { waitForCompletion?: boolean },
): Promise<Response> {
  const now = Date.now()
  const participant = host.resolveParticipantByUserId(body.authorId)
  const model = Option.orElse(resolvedModel(body.model), () =>
    resolvedModel(host.getSession()?.model),
  )

  return Option.match(model, {
    onNone: () =>
      Promise.resolve(
        Response.json({ error: "Prompt enqueue requires a resolved model." }, { status: 400 }),
      ),
    onSome: (resolvedModel) =>
      enqueuePromptWithResolvedModel(
        host,
        request,
        body,
        executionMode,
        options,
        now,
        participant,
        resolvedModel,
      ),
  })
}

function enqueuePromptWithResolvedModel(
  host: SessionDODelegate,
  request: Request,
  body: EnqueuePromptBody,
  executionMode: PromptExecutionMode,
  options: { waitForCompletion?: boolean },
  now: number,
  participant: ParticipantRow,
  model: string,
): Promise<Response> {
  const messageId = generateId()
  host.repository.createMessage({
    id: messageId,
    authorId: participant.id,
    content: body.content,
    source: (body.source || "web") as "web" | "slack" | "extension" | "github",
    model,
    reasoningEffort: body.reasoningEffort ?? null,
    executionMode,
    attachments: host.stringifyOptionalJson(body.attachments),
    callbackContext: host.stringifyOptionalJson(body.callbackContext),
    status: "pending",
    createdAt: now,
  })

  const userEvent: SandboxEvent = {
    type: "user_message",
    content: body.content,
    messageId,
    timestamp: now / 1000,
    author: {
      participantId: participant.id,
      name: participant.github_name || participant.github_login || participant.user_id,
    },
  }
  host.repository.events.createEvent({
    id: generateId(),
    type: "user_message",
    data: stringifyJson(userEvent),
    messageId,
    createdAt: now,
  })
  host.broadcast({ type: "sandbox_event", event: userEvent })

  const localParentContext = localSpanContextFromHeaders(request.headers)
  return host.dispatchEnqueuedPrompt(executionMode, options, messageId, localParentContext)
}

export function resolveParticipantByUserId(
  host: SessionDODelegate,
  userId: string,
): ParticipantRow {
  return Option.getOrElse(host.repository.getParticipantByUserId(userId), () =>
    host.createParticipant(userId, userId),
  )
}

export function dispatchEnqueuedPrompt(
  host: SessionDODelegate,
  executionMode: PromptExecutionMode,
  options: { waitForCompletion?: boolean },
  messageId: string,
  localParentContext: LocalSpanContext | undefined,
): Promise<Response> {
  return Match.value(executionMode === "stream").pipe(
    Match.when(true, () =>
      Promise.resolve(host.startStreamedPrompt(messageId, localParentContext)),
    ),
    Match.orElse(() => host.startQueuedPrompt(options, messageId, localParentContext)),
  )
}

export function startStreamedPrompt(
  host: SessionDODelegate,
  messageId: string,
  localParentContext: LocalSpanContext | undefined,
): Response {
  const stream = host.registerIsolateStream(messageId)
  host.ctx.waitUntil(host.processMessageQueue(localParentContext))
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-message-id": messageId,
    },
  })
}

export function startQueuedPrompt(
  host: SessionDODelegate,
  options: { waitForCompletion?: boolean },
  messageId: string,
  localParentContext: LocalSpanContext | undefined,
): Promise<Response> {
  return Match.value(options.waitForCompletion === false).pipe(
    Match.when(true, () =>
      Promise.resolve(host.startBackgroundQueuedPrompt(messageId, localParentContext)),
    ),
    Match.orElse(() => host.startAwaitedQueuedPrompt(messageId, localParentContext)),
  )
}

export function startBackgroundQueuedPrompt(
  host: SessionDODelegate,
  messageId: string,
  localParentContext: LocalSpanContext | undefined,
): Response {
  host.ctx.waitUntil(
    host
      .processMessageQueue(localParentContext)
      .catch((errorValue) => host.logAsyncPromptQueueError(errorValue)),
  )
  return Response.json({
    messageId,
    status: "queued",
  })
}

export async function startAwaitedQueuedPrompt(
  host: SessionDODelegate,
  messageId: string,
  localParentContext: LocalSpanContext | undefined,
): Promise<Response> {
  await host.processMessageQueue(localParentContext)
  return Response.json({
    messageId,
    status: "queued",
  })
}

export function logAsyncPromptQueueError(host: SessionDODelegate, errorValue: unknown): void {
  const observer = host.createInternalRequestObserver("message_queue", "session-message-queue")
  observer.log.error(toError(errorValue), {
    event: "session.message_queue.async_failed",
    boundary: "session.message_queue.async",
    sessionId: host.getSessionId(),
  })
}

export async function handleResumePrompt(
  host: SessionDODelegate,
  request: Request,
): Promise<Response> {
  return handleResumePromptRequest({
    request,
    repository: host.repository,
    getSession: () => host.getSession(),
    getSessionId: () => host.getSessionId(),
    broadcast: (message) => host.broadcast(message),
    runQueue: () => host.ctx.waitUntil(host.processMessageQueue()),
  })
}

export async function handleUpdateTools(
  host: SessionDODelegate,
  request: Request,
): Promise<Response> {
  const body = (await request.json()) as UpdateToolsBody
  return Option.match(Option.fromNullishOr(body.userId), {
    onNone: () => Promise.resolve(Response.json({ error: "userId is required" }, { status: 400 })),
    onSome: (userId) => host.updateToolsForUser(userId, body),
  })
}

export function updateToolsForUser(
  host: SessionDODelegate,
  userId: string,
  body: UpdateToolsBody,
): Promise<Response> {
  return Option.match(Option.fromNullishOr(host.repository.getParticipantByUserId(userId)), {
    onNone: () => Promise.resolve(Response.json({ error: "Not authorized" }, { status: 403 })),
    onSome: () => host.updateToolsForSession(body),
  })
}

export function updateToolsForSession(
  host: SessionDODelegate,
  body: UpdateToolsBody,
): Promise<Response> {
  return Option.match(Option.fromNullishOr(host.getSession()), {
    onNone: () => Promise.resolve(Response.json({ error: "Session not found" }, { status: 404 })),
    onSome: (session) => host.applyToolUpdate(session, body),
  })
}

export function applyToolUpdate(
  host: SessionDODelegate,
  session: SessionRow,
  body: UpdateToolsBody,
): Promise<Response> {
  const requestedTools = normalizeSessionTools(body.tools)
  const requestedCustomMcpServers = normalizeOpenCodeMcpServers(body.customMcpServers)
  const requestedRepo = getGitHubRepoTool(requestedTools)
  return Option.match(host.repoChangeError(session, requestedRepo), {
    onSome: (response) => Promise.resolve(response),
    onNone: () => host.commitToolUpdate(session, body, requestedTools, requestedCustomMcpServers),
  })
}

export function repoChangeError(
  host: SessionDODelegate,
  session: SessionRow,
  requestedRepo: ReturnType<typeof getGitHubRepoTool>,
): Option.Option<Response> {
  const currentRepo = Option.liftPredicate(
    { repoOwner: session.repo_owner, repoName: session.repo_name },
    (repo): repo is { repoOwner: string; repoName: string } =>
      Boolean(repo.repoOwner) && Boolean(repo.repoName),
  )
  return Option.match(currentRepo, {
    onSome: (current) => host.existingRepoChangeError(current, requestedRepo),
    onNone: () => host.attachRepoError(requestedRepo),
  })
}

export function existingRepoChangeError(
  host: SessionDODelegate,
  current: { repoOwner: string; repoName: string },
  requestedRepo: ReturnType<typeof getGitHubRepoTool>,
): Option.Option<Response> {
  const matches = Option.match(Option.fromNullishOr(requestedRepo), {
    onNone: () => false,
    onSome: (repo) => repo.repoOwner === current.repoOwner && repo.repoName === current.repoName,
  })
  return Match.value(matches).pipe(
    Match.when(true, () => Option.none<Response>()),
    Match.orElse(() =>
      Option.some(
        Response.json(
          {
            error: "Changing the repository for an existing session is not supported",
          },
          { status: 400 },
        ),
      ),
    ),
  )
}

export function attachRepoError(
  host: SessionDODelegate,
  requestedRepo: ReturnType<typeof getGitHubRepoTool>,
): Option.Option<Response> {
  return Option.match(Option.fromNullishOr(requestedRepo), {
    onNone: () => Option.none<Response>(),
    onSome: () =>
      Option.some(
        Response.json(
          {
            error: "Attaching a repository after session creation is not supported",
          },
          { status: 400 },
        ),
      ),
  })
}

export function commitToolUpdate(
  host: SessionDODelegate,
  session: SessionRow,
  body: UpdateToolsBody,
  requestedTools: ReturnType<typeof normalizeSessionTools>,
  requestedCustomMcpServers: OpenCodeMcpServers,
): Promise<Response> {
  host.repository.updateSessionTooling({
    sessionId: session.id,
    repoOwner: session.repo_owner,
    repoName: session.repo_name,
    tools: requestedTools,
    customMcpServers: requestedCustomMcpServers,
    isolateStepLimit: normalizeIsolateStepLimit(
      body.isolateStepLimit,
      session.isolate_step_limit ?? DEFAULT_ISOLATE_STEP_LIMIT,
    ),
    subagents: resolveSessionSubagentMode(session.session_kind, body.subagents, session.subagents),
    updatedAt: Date.now(),
  })
  return host.syncToolingRuntime(session).then(() => host.broadcastSessionState())
}

export function syncToolingRuntime(host: SessionDODelegate, session: SessionRow): Promise<unknown> {
  return Match.value(session.status).pipe(
    Match.when("archived", () => Promise.resolve()),
    Match.orElse(() => host.syncRuntimeForKind(session)),
  )
}

export function syncRuntimeForKind(host: SessionDODelegate, session: SessionRow): Promise<unknown> {
  return Match.value(session.session_kind).pipe(
    // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object sync entrypoint returns Promise.
    Match.when("sandbox", () => Effect.runPromise(host.lifecycleManager.syncRuntimeConfig())),
    Match.orElse(() => host.syncIsolateRuntime()),
  )
}

export function broadcastSessionState(host: SessionDODelegate): Response {
  const state = host.getSessionState()
  host.broadcast({ type: "session_state", state })
  return Response.json(state)
}
