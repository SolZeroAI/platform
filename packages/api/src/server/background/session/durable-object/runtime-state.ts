// @ts-nocheck
import { DurableObject, tracing as workerTracing } from "cloudflare:workers"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  DEFAULT_SUBAGENT_MODE,
  getGitHubRepoTool,
  getSelectedMcpcfServerIds,
  getStageMetadataSync,
  normalizeIsolateStepLimit,
  normalizeSubagentMode,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  resolveAgentRuntime,
  sessionSubagentModeField,
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
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- session Durable Object runtime-state is a composition root. It builds the tracing layer at Effect.runPromise edges.
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

export function getSessionState(host: SessionDODelegate): SessionState {
  const session = Option.getOrNull(host.repository.getSession())
  host.reconcileSandboxStatusIfSandbox(session)
  const runtime = Option.getOrNull(host.repository.getRuntimeLifecycle())
  return {
    id: session?.session_name || session?.id || host.ctx.id.toString(),
    sessionKind: session?.session_kind ?? "isolate",
    agentRuntime: resolveAgentRuntime({
      agentRuntime: session?.agent_runtime,
      sessionKind: session?.session_kind,
    }),
    title: session?.title ?? null,
    repoOwner: session?.repo_owner ?? "",
    repoName: session?.repo_name ?? "",
    tools: getSessionTools(session),
    customMcpServers: getSessionCustomMcpServers(session),
    secretKeys: parseStoredSecretKeys(session?.secret_keys_json),
    isolateStepLimit: normalizeIsolateStepLimit(
      session?.isolate_step_limit,
      DEFAULT_ISOLATE_STEP_LIMIT,
    ),
    ...sessionSubagentModeField(session?.session_kind, session?.subagents),
    status: session?.status ?? "created",
    sandboxStatus: runtime?.status ?? "pending",
    runtimeStatus: runtime?.status ?? "pending",
    runtimeError: runtime?.lastSpawnError ?? undefined,
    capabilities: getSessionCapabilities(session),
    messageCount: host.repository.getMessageCount(),
    createdAt: session?.created_at ?? Date.now(),
    updatedAt: session?.updated_at ?? Date.now(),
    model: session?.model,
    reasoningEffort: session?.reasoning_effort ?? undefined,
    isProcessing: Option.isSome(host.repository.getProcessingMessage()),
  }
}

export function reconcileSandboxStatusIfSandbox(
  host: SessionDODelegate,
  session: SessionRow | null,
): void {
  Option.match(
    Option.liftPredicate(session, (resolved) => resolved?.session_kind === "sandbox"),
    {
      onNone: () => undefined,
      onSome: () => host.lifecycleManager.reconcileSandboxStatus(),
    },
  )
}

export function getSession(host: SessionDODelegate) {
  return Option.getOrNull(host.repository.getSession())
}

export function getSessionId(host: SessionDODelegate): string {
  const session = host.getSession()
  return session?.session_name || session?.id || host.ctx.id.toString()
}

export function getSessionKind(host: SessionDODelegate): SessionKind {
  return host.getSession()?.session_kind ?? "isolate"
}

export function getAgentRuntime(host: SessionDODelegate): AgentRuntime {
  const session = host.getSession()
  return resolveAgentRuntime({
    agentRuntime: session?.agent_runtime,
    sessionKind: session?.session_kind,
  })
}

export function getSessionOwner(host: SessionDODelegate) {
  return (
    host.repository.listParticipants().find((participant) => participant.role === "owner") ?? null
  )
}

export function buildIsolateSessionConfig(host: SessionDODelegate): Promise<IsolateSessionConfig> {
  const session = host.getSession()
  const owner = host.getSessionOwner()
  return Option.match(Option.all([Option.fromNullishOr(session), Option.fromNullishOr(owner)]), {
    onNone: () => Promise.reject(new Error("Isolate session is not initialized")),
    onSome: ([resolvedSession, resolvedOwner]) =>
      host.buildIsolateConfigFor(resolvedSession, resolvedOwner),
  })
}

export async function buildIsolateConfigFor(
  host: SessionDODelegate,
  session: SessionRow,
  owner: ParticipantRow,
): Promise<IsolateSessionConfig> {
  return {
    sessionId: host.getSessionId(),
    userId: owner.user_id,
    repoOwner: session.repo_owner,
    repoName: session.repo_name,
    repoDefaultBranch: session.repo_default_branch,
    branchName: session.branch_name,
    model: session.model,
    githubName: owner.github_name,
    githubEmail: owner.github_email,
    tools: getSessionTools(session),
    customMcpServers: getSessionCustomMcpServers(session),
    secretEnv: await host.resolveSecretEnv(owner.user_id, session.secret_keys_json),
    isolateStepLimit: normalizeIsolateStepLimit(
      session.isolate_step_limit,
      DEFAULT_ISOLATE_STEP_LIMIT,
    ),
    subagents: normalizeSubagentMode(session.subagents, DEFAULT_SUBAGENT_MODE),
  }
}

export function resolveSecretEnv(
  host: SessionDODelegate,
  userId: string,
  secretKeysJson: string | null | undefined,
): Promise<Record<string, string>> {
  const secretKeys = parseStoredSecretKeys(secretKeysJson)
  return Option.match(
    Option.liftPredicate(secretKeys, (keys) => keys.length > 0),
    {
      onNone: () => Promise.resolve<Record<string, string>>({}),
      onSome: (keys) => host.decryptSecretEnv(userId, keys),
    },
  )
}

export async function decryptSecretEnv(
  host: SessionDODelegate,
  userId: string,
  secretKeys: string[],
): Promise<Record<string, string>> {
  const encryptionKey = Option.getOrThrowWith(
    Option.fromNullishOr(host.env.REPO_SECRETS_ENCRYPTION_KEY),
    () => new Error("Secret storage is not configured"),
  )
  const allSecrets = await createGlobalSecretsStoreFromD1(
    host.env.DB,
    encryptionKey,
  ).getDecryptedSecrets({
    userId,
  })
  return Object.fromEntries(
    secretKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(allSecrets, key))
      .map((key) => [key, allSecrets[key]]),
  )
}

export function getIsolateCloneAuth(host: SessionDODelegate): Promise<{
  githubAccessToken?: string | null
}> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise callback boundary for isolate prompt bridge getCloneAuth.
  return Effect.runPromise(host.getIsolateCloneAuthEffect())
}

export function getIsolateCloneAuthEffect(host: SessionDODelegate) {
  return Effect.map(host.getSandboxCloneCredentialsEffect(), (credentials) =>
    Option.match(Option.fromNullishOr(credentials), {
      onNone: () => ({}),
      onSome: (resolved) => ({ githubAccessToken: resolved.accessToken }),
    }),
  )
}

export function getSandboxCloneCredentials(
  host: SessionDODelegate,
): Promise<GitHubCloneCredentials | null> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object sandbox lifecycle boundary; the lifecycle manager is still Promise-shaped while GitHub clone auth is Effect-native.
  return Effect.runPromise(host.getSandboxCloneCredentialsEffect())
}

export function getSandboxCloneCredentialsEffect(host: SessionDODelegate) {
  return Option.match(host.repoBackedSessionOwner(), {
    onNone: () => Effect.succeed<GitHubCloneCredentials | null>(null),
    onSome: ({ session, owner }) => host.resolveCloneCredentialsEffect(session, owner),
  })
}

export function repoBackedSessionOwner(host: SessionDODelegate): Option.Option<{
  session: SessionRow
  owner: ParticipantRow
}> {
  return Option.flatMap(
    Option.liftPredicate(
      host.getSession(),
      (candidate): candidate is SessionRow =>
        isNonEmptyString(candidate?.repo_owner) && isNonEmptyString(candidate?.repo_name),
    ),
    (session) =>
      Option.map(Option.fromNullishOr(host.getSessionOwner()), (owner) => ({
        session,
        owner,
      })),
  )
}

export function resolveCloneCredentialsEffect(
  host: SessionDODelegate,
  session: SessionRow,
  owner: ParticipantRow,
) {
  return Effect.gen({ self: this }, function* () {
    const githubToken = yield* getGitHubAppUserAccessTokenForUserId(host.env, owner.user_id)
    const token = Option.getOrThrowWith(
      Option.flatMap(Option.fromNullishOr(githubToken), (resolved) =>
        Option.map(Option.liftPredicate(resolved.accessToken, isNonEmptyString), (accessToken) => ({
          githubUserId: resolved.githubUserId,
          accessToken,
        })),
      ),
      () => new Error("GitHub App is not authorized for this session owner"),
    )
    const credentials = yield* resolveGitHubCloneCredentials({
      env: host.env,
      session,
      owner,
      token,
    })
    return credentials
  })
}

export function syncIsolateRuntime(host: SessionDODelegate): Promise<IsolateWarmResult> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Durable Object background boundary; runs the isolate warm Effect from Promise-typed session handlers (typing/init/update-tools).
  return Effect.runPromise(host.syncIsolateRuntimeEffect())
}

export function syncIsolateRuntimeEffect(host: SessionDODelegate) {
  return Effect.gen({ self: this }, function* () {
    const config = yield* promiseEffect(() => host.buildIsolateSessionConfig())
    yield* host.isolateRuntime.initializeSession(config)

    host.repository.updateSandboxStatus("pending")
    host.broadcast({ type: "sandbox_warming" })

    const auth = yield* host.getIsolateCloneAuthEffect()
    const result = yield* host.isolateRuntime.warm(config.sessionId, auth)
    const now = Date.now()

    return yield* Option.match(
      Option.liftPredicate(result, (resolved) => resolved.status === "failed"),
      {
        onNone: () => host.finalizeWarmSuccess(result, now),
        onSome: (resolved) => host.finalizeWarmFailure(resolved, now),
      },
    )
  })
}

export function finalizeWarmFailure(
  host: SessionDODelegate,
  result: IsolateWarmResult,
  now: number,
) {
  return Effect.gen({ self: this }, function* () {
    yield* Effect.sync(() => {
      host.repository.updateSandboxStatus("failed")
      host.repository.updateSandboxSpawnError(
        result.lastError ?? "Isolate runtime failed to warm",
        now,
      )
      host.maybeBroadcastSandboxError(result.lastError)
    })
    return result
  })
}

export function maybeBroadcastSandboxError(
  host: SessionDODelegate,
  lastError: string | null | undefined,
): void {
  Option.match(Option.fromNullishOr(lastError), {
    onNone: () => undefined,
    onSome: (error) => host.broadcast({ type: "sandbox_error", error }),
  })
}

export function finalizeWarmSuccess(
  host: SessionDODelegate,
  result: IsolateWarmResult,
  now: number,
) {
  return Effect.gen({ self: this }, function* () {
    host.repository.updateRuntimeForSpawn({
      status: "ready",
      runtimeId: result.runtimeId,
      authToken: "isolate",
      createdAt: now,
    })
    host.repository.updateSandboxLastActivity(now)
    host.repository.updateSandboxSpawnError(null, null)
    host.broadcast({ type: "sandbox_status", status: "ready" })
    yield* promiseEffect(() => host.scheduleInactivityCheck())
    return result
  })
}

export function isIsolateRuntimeReady(host: SessionDODelegate): boolean {
  const runtime = Option.getOrNull(host.repository.getRuntimeLifecycle())
  return (
    isNonEmptyString(runtime?.runtimeId) &&
    (runtime?.status === "ready" || runtime?.status === "running")
  )
}

export function ensureIsolateReady(host: SessionDODelegate) {
  return Option.match(
    Option.liftPredicate(host.isIsolateRuntimeReady(), (ready) => ready === false),
    {
      onNone: () => Effect.void,
      onSome: () => host.warmIsolateRuntime(),
    },
  )
}

export function warmIsolateRuntime(host: SessionDODelegate) {
  return Effect.gen({ self: this }, function* () {
    const warmResult = yield* host.syncIsolateRuntimeEffect()
    yield* Option.match(
      Option.liftPredicate(warmResult, (resolved) => resolved.status === "failed"),
      {
        onNone: () => Effect.void,
        onSome: (resolved) =>
          Effect.fail(
            new IsolateRuntimeUnavailableError({
              message: resolved.lastError ?? "Isolate runtime is unavailable",
            }),
          ),
      },
    )
  })
}

export function registerIsolateStream(
  host: SessionDODelegate,
  messageId: string,
): ReadableStream<Uint8Array> {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  host.isolateStreamState.set(messageId, {
    writer: stream.writable.getWriter(),
    text: "",
  })
  return stream.readable
}

export function closeIsolateStream(host: SessionDODelegate, messageId: string): Promise<void> {
  return Option.match(Option.fromNullishOr(host.isolateStreamState.get(messageId)), {
    onNone: () => Promise.resolve(),
    onSome: (stream) => host.closeStream(messageId, stream),
  })
}

export function closeStream(
  host: SessionDODelegate,
  messageId: string,
  stream: IsolateStreamState,
): Promise<void> {
  host.isolateStreamState.delete(messageId)
  return stream.writer.close()
}

export function failIsolateStream(
  host: SessionDODelegate,
  messageId: string,
  errorMessage: string,
): Promise<void> {
  return Option.match(Option.fromNullishOr(host.isolateStreamState.get(messageId)), {
    onNone: () => Promise.resolve(),
    onSome: (stream) => host.abortStream(messageId, stream, errorMessage),
  })
}
