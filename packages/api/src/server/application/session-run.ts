import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { ApiEnv } from "infra/types/env"
import type { AgentRuntime, AuthPrincipal, RunSessionPayload, SessionKind } from "@c0/api"
import { resolveAgentRuntime, sessionKindForAgentRuntime } from "@c0-agent/shared"
import {
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  summarizeSessionTools,
  type OpenCodeMcpServers,
  type SessionInitiationSource,
  type SessionToolSpec,
  type WorkflowCallbackContext,
} from "@c0-agent/shared"
import { EffectRequestLogger } from "../effect/services/observability"
import type { RunSessionPromptResponse } from "../effect/handlers/shared/control-plane"
import {
  ControlPlaneFailure,
  createSessionWithIdentity,
  enqueuePromptForSession,
  failWhen,
  getSessionStub,
  json,
  parsePromptExecutionMode,
  requireOption,
  requireSessionAccessForUser,
  resolveRequestedCustomMcpServers,
  resolveRequestedSessionTools,
  resolveUserIdentityByUserId,
  runControlPlane,
  validateRequestedAiSearchSessionTools,
  validateRequestedMcpcfSessionTools,
  validateRequestedSecretKeys,
  waitForPromptResult,
} from "../effect/handlers/shared/control-plane"

export type { RunSessionPayload }

type PromptExecutionMode = ReturnType<typeof parsePromptExecutionMode>

interface ResolvedRunSession {
  sessionId: string
  actorUserId: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  createdSession: boolean
  sessionToolsForLog: SessionToolSpec[]
  customMcpServersForLog: OpenCodeMcpServers
}

interface RunSessionContext {
  request: Request
  env: ApiEnv
  actorUserId: string
  initiationSource: SessionInitiationSource
  identityProvider: Parameters<typeof resolveUserIdentityByUserId>[2]
  githubProvider: Parameters<typeof createSessionWithIdentity>[0]["githubProvider"]
  payload: RunSessionPayload
  /** Trusted workflow runtime metadata; never populated from a public request payload. */
  trustedWorkflowCallbackContext?: WorkflowCallbackContext
  forcedKind: SessionKind | undefined
  executionMode: PromptExecutionMode
}

function invalidToolsMessage(cause: unknown): string {
  return Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (errorValue) => errorValue.message),
    Match.orElse(() => "Invalid session tools"),
  )
}

function resolveRunSource(
  principal: AuthPrincipal | null,
  source: string | undefined,
): SessionInitiationSource {
  return Match.value({ isApiKey: principal?.kind === "api_key", isSlack: source === "slack" }).pipe(
    Match.when({ isApiKey: true }, () => "api" as const),
    Match.when({ isSlack: true }, () => "slack" as const),
    Match.orElse(() => "web" as const),
  )
}

function booleanFlag(value: boolean): string {
  return Match.value(value).pipe(
    Match.when(true, () => "1"),
    Match.orElse(() => "0"),
  )
}

const errorField = (error: string | undefined) =>
  Option.match(Option.fromNullishOr(error), {
    onNone: () => ({}) as { error?: string },
    onSome: (value) => ({ error: value }),
  })

const createNewRunSession = Effect.fn("sessions.run.createNew")(function* (
  context: RunSessionContext,
) {
  const requestedKind = context.forcedKind ?? context.payload.sessionKind ?? "isolate"
  const requestedRuntime = resolveAgentRuntime({
    agentRuntime: context.payload.agentRuntime,
    sessionKind: requestedKind,
  })
  const sessionKind = sessionKindForAgentRuntime(requestedRuntime)
  yield* failWhen(
    context.executionMode === "stream" && sessionKind === "sandbox",
    "Prompt streaming is only supported for isolate sessions",
    409,
  )

  const resolved = yield* Effect.try({
    try: () => ({
      requestedTools: resolveRequestedSessionTools(context.request, context.payload),
      requestedCustomMcpServers: resolveRequestedCustomMcpServers(context.payload),
    }),
    catch: (cause) =>
      new ControlPlaneFailure({ payload: { error: invalidToolsMessage(cause) }, status: 400 }),
  })

  const identity = yield* resolveUserIdentityByUserId(
    context.env,
    context.actorUserId,
    context.identityProvider,
  )
  yield* validateRequestedAiSearchSessionTools(context.env, resolved.requestedTools)
  yield* validateRequestedMcpcfSessionTools(context.env, resolved.requestedTools, {
    userId: identity.userId,
  })
  const requestedSecretKeys = Array.from(new Set(context.payload.secretKeys ?? []))
  yield* validateRequestedSecretKeys(context.env, requestedSecretKeys, { userId: identity.userId })

  const sessionId = yield* createSessionWithIdentity({
    env: context.env,
    identity,
    githubProvider: context.githubProvider,
    requestedTools: resolved.requestedTools,
    requestedCustomMcpServers: resolved.requestedCustomMcpServers,
    requestedSecretKeys,
    sessionKind,
    agentRuntime: requestedRuntime,
    source: context.initiationSource,
    serverUrl: new URL(context.request.url).origin,
    title: context.payload.title ?? null,
    model: context.payload.model,
    reasoningEffort: context.payload.reasoningEffort ?? null,
    isolateStepLimit: context.payload.isolateStepLimit ?? null,
    subagents: context.payload.subagents ?? null,
    incognito: context.payload.incognito ?? false,
    githubLogin: context.payload.githubLogin ?? null,
    githubName: context.payload.githubName ?? null,
    githubEmail: context.payload.githubEmail ?? null,
  })

  return {
    sessionId,
    actorUserId: identity.userId,
    sessionKind,
    agentRuntime: requestedRuntime,
    createdSession: true,
    sessionToolsForLog: resolved.requestedTools,
    customMcpServersForLog: resolved.requestedCustomMcpServers,
  } satisfies ResolvedRunSession
})

const resolveExistingRunSession = Effect.fn("sessions.run.resolveExisting")(function* (
  context: RunSessionContext,
  sessionId: string,
) {
  const access = yield* requireSessionAccessForUser(context.env, context.actorUserId, sessionId)
  const sessionKind = access.session.session_kind
  const agentRuntime = access.session.agent_runtime
  yield* failWhen(
    context.executionMode === "stream" && sessionKind !== "isolate",
    "Prompt streaming is only supported for isolate sessions",
    409,
  )
  yield* failWhen(
    Boolean(context.forcedKind) && sessionKind !== context.forcedKind,
    `Session '${sessionId}' is not a ${context.forcedKind} session`,
    409,
  )
  yield* failWhen(
    Boolean(context.payload.sessionKind) && context.payload.sessionKind !== sessionKind,
    `sessionKind does not match existing session '${sessionId}'`,
    409,
  )
  yield* failWhen(
    Boolean(context.payload.agentRuntime) && context.payload.agentRuntime !== agentRuntime,
    `agentRuntime does not match existing session '${sessionId}'`,
    409,
  )

  return {
    sessionId,
    actorUserId: access.userId,
    sessionKind,
    agentRuntime,
    createdSession: false,
    sessionToolsForLog: parseStoredSessionTools(access.session.tools_json),
    customMcpServersForLog: parseStoredOpenCodeMcpServers(access.session.custom_mcp_json),
  } satisfies ResolvedRunSession
})

const resolveRunSession = Effect.fn("sessions.run.resolve")(function* (context: RunSessionContext) {
  const sessionId = Option.fromNullishOr(context.payload.sessionId?.trim()).pipe(
    Option.filter((value) => value.length > 0),
  )
  return yield* Option.match(sessionId, {
    onNone: () => createNewRunSession(context),
    onSome: (existingSessionId) => resolveExistingRunSession(context, existingSessionId),
  })
})

function buildStreamResponse(resolved: ResolvedRunSession, promptResponse: Response): Response {
  const headers = new Headers(promptResponse.headers)
  headers.set("x-session-id", resolved.sessionId)
  headers.set("x-session-kind", resolved.sessionKind)
  headers.set("x-agent-runtime", resolved.agentRuntime)
  headers.set("x-created-session", booleanFlag(resolved.createdSession))
  return new Response(promptResponse.body, {
    status: promptResponse.status,
    statusText: promptResponse.statusText,
    headers,
  })
}

const collectSyncPrompt = Effect.fn("sessions.run.collectSync")(function* (input: {
  env: ApiEnv
  resolved: ResolvedRunSession
  promptResponse: Response
}) {
  const promptData = yield* Effect.tryPromise(
    () => input.promptResponse.json() as Promise<{ messageId: string }>,
  )
  const stub = getSessionStub(input.env, input.resolved.sessionId)
  const promptResult = yield* waitForPromptResult(stub, promptData.messageId)
  const log = yield* EffectRequestLogger
  yield* log.set({
    sessionId: input.resolved.sessionId,
    sessionKind: input.resolved.sessionKind,
    agentRuntime: input.resolved.agentRuntime,
    createdSession: input.resolved.createdSession,
    messageId: promptData.messageId,
    promptStatus: promptResult.status,
    outputLength: promptResult.output?.length ?? 0,
    hasError: Boolean(promptResult.error),
    errorMessage: promptResult.error ?? null,
  })
  const subagentRunField = Match.value(promptResult.subagentRuns).pipe(
    Match.when(Match.undefined, () => ({})),
    Match.orElse((subagentRuns) => ({ subagentRuns })),
  )
  const response: RunSessionPromptResponse = {
    sessionId: input.resolved.sessionId,
    sessionKind: input.resolved.sessionKind,
    agentRuntime: input.resolved.agentRuntime,
    createdSession: input.resolved.createdSession,
    messageId: promptData.messageId,
    status: promptResult.status,
    output: promptResult.output,
    ...subagentRunField,
    ...errorField(promptResult.error),
  }
  return json(response)
})

const finishPrompt = Effect.fn("sessions.run.finish")(function* (input: {
  env: ApiEnv
  executionMode: PromptExecutionMode
  resolved: ResolvedRunSession
  promptResponse: Response
}) {
  return yield* Match.value(input.executionMode === "stream").pipe(
    Match.when(true, () =>
      Effect.succeed(buildStreamResponse(input.resolved, input.promptResponse)),
    ),
    Match.orElse(() =>
      collectSyncPrompt({
        env: input.env,
        resolved: input.resolved,
        promptResponse: input.promptResponse,
      }),
    ),
  )
})

export const runSessionApplication = Effect.fn("sessions.run.application")(function* (
  context: RunSessionContext,
) {
  const resolved = yield* resolveRunSession(context)

  const log = yield* EffectRequestLogger
  yield* log.set({
    sessionId: resolved.sessionId,
    sessionKind: resolved.sessionKind,
    agentRuntime: resolved.agentRuntime,
    createdSession: resolved.createdSession,
    promptLength: context.payload.content.length,
    model: context.payload.model ?? null,
    reasoningEffort: context.payload.reasoningEffort ?? null,
    executionMode: context.executionMode,
    tools: resolved.sessionToolsForLog,
    toolsSummary: summarizeSessionTools(resolved.sessionToolsForLog, {
      customMcpServers: resolved.customMcpServersForLog,
    }),
    customMcpServers: Object.keys(resolved.customMcpServersForLog),
  })

  const promptResponse = yield* enqueuePromptForSession({
    env: context.env,
    sessionId: resolved.sessionId,
    actorUserId: resolved.actorUserId,
    content: context.payload.content,
    source: context.payload.source,
    agentRuntime: resolved.agentRuntime,
    model: context.payload.model,
    reasoningEffort: context.payload.reasoningEffort,
    executionMode: context.executionMode,
    attachments: context.payload.attachments,
    callbackContext: context.trustedWorkflowCallbackContext ?? context.payload.callbackContext,
  })

  return yield* Match.value(promptResponse.ok).pipe(
    Match.when(false, () => Effect.succeed(promptResponse)),
    Match.orElse(() =>
      finishPrompt({
        env: context.env,
        executionMode: context.executionMode,
        resolved,
        promptResponse,
      }),
    ),
  )
})

export function runSessionHttp(payload: RunSessionPayload, forcedKind?: SessionKind) {
  return runControlPlane(
    Effect.fn("sessions.run.http")(function* ({
      request,
      env,
      principal,
      identityProvider,
      githubProvider,
    }) {
      const actorUserId = yield* requireOption(
        Option.fromNullishOr(principal?.userId),
        "Unauthorized",
        401,
      )
      return yield* runSessionApplication({
        request,
        env,
        actorUserId,
        initiationSource: resolveRunSource(principal, payload.source),
        identityProvider,
        githubProvider,
        payload,
        forcedKind,
        executionMode: parsePromptExecutionMode(new URL(request.url)),
      })
    }),
  )
}
