import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  DEFAULT_SUBAGENT_MODE,
  getInfraServerUrl,
  isSubagentMode,
  normalizeSubagentMode,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  WORKFLOW_SUBAGENTS_MANIFEST_VERSION,
} from "@solzero/shared"
import type {
  OpenCodeMcpServers,
  SessionKind,
  SessionToolSpec,
  SubagentMode,
  WorkflowNodeOptions,
  SubagentRunSummary,
} from "@solzero/shared"
import {
  createSessionIndexStoreFromD1,
  type SessionIndexStorePromise,
} from "../../db/session-index"
import { createWorkflowStoreFromD1 } from "../../db/workflows"
import { parseJsonOrText, stringifyJson } from "../../../lib/json"
import { toError } from "../../../lib/effect-errors"
import { runSessionApplication } from "../../../application/session-run"
import {
  EffectRequestLogger,
  type EffectRequestLoggerService,
} from "../../../effect/services/observability"
import { providerServicesForEnv } from "../../../effect/services/providers"
import {
  ControlPlaneFailure,
  InternalRequests,
  makeInternalRequests,
} from "../../../effect/handlers/shared/control-plane"
import {
  createNodeContext,
  getActionUserId,
  getPositiveInteger,
  getString,
  renderTemplate,
  type WorkflowNodeExecutionInput,
} from "./common"
import { workflowNodeFail, workflowNodeFailWhen } from "./errors"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

export type WorkflowSessionNodeExecutionInput = WorkflowNodeExecutionInput

const workflowSessionNodeTypes = new Set(["isolate-session", "sandbox-session"])
const MIN_WORKFLOW_SESSION_CACHE_TTL_SECONDS = 60

function runWorkflowLog(action: () => void) {
  action()
  return Effect.void
}

function workflowEffectLogger(
  log: WorkflowSessionNodeExecutionInput["log"],
): EffectRequestLoggerService {
  return {
    set: (fields) => Effect.suspend(() => runWorkflowLog(() => log?.set(fields))),
    emit: (fields) => Effect.suspend(() => runWorkflowLog(() => log?.emit(fields))),
    info: (event, fields) => Effect.suspend(() => runWorkflowLog(() => log?.info(event, fields))),
    warn: (event, fields) => Effect.suspend(() => runWorkflowLog(() => log?.warn(event, fields))),
    debug: (event, fields) => Effect.suspend(() => runWorkflowLog(() => log?.debug(event, fields))),
    error: (error, fields) => Effect.suspend(() => runWorkflowLog(() => log?.error(error, fields))),
  }
}

function controlPlaneFailureData(payload: unknown): Record<string, unknown> {
  return Match.value(payload).pipe(
    Match.when(Match.record, (record) => record),
    Match.orElse((value) => ({ error: String(value) })),
  )
}

interface RenderedWorkflowSessionKey {
  keyHash: string
  kvKey: string
}

interface WorkflowSessionCacheEntry {
  sessionId: string
  messageId: string
  output: string | null
  status: string
  error?: string
  subagentRuns?: SubagentRunSummary[]
}

interface WorkflowSessionRunResponse extends WorkflowSessionCacheEntry {
  createdSession?: boolean
}

export function isWorkflowSessionNodeType(nodeType: string): boolean {
  return workflowSessionNodeTypes.has(nodeType)
}

export const executeWorkflowSessionNode = Effect.fn("workflows.executeSessionNode")(function* (
  input: WorkflowSessionNodeExecutionInput,
) {
  return yield* Match.value(input.node.type).pipe(
    Match.when("isolate-session", () => runSessionNode(input, "isolate")),
    Match.when("sandbox-session", () => runSessionNode(input, "sandbox")),
    Match.orElse((nodeType) => workflowNodeFail(`Unsupported workflow session node '${nodeType}'`)),
  )
})

function getTools(value: unknown): Option.Option<SessionToolSpec[]> {
  return Match.value(value).pipe(
    Match.when(Match.undefined, () => Option.none<SessionToolSpec[]>()),
    Match.when(Match.null, () => Option.none<SessionToolSpec[]>()),
    Match.when(
      (candidate: unknown): candidate is readonly unknown[] => Array.isArray(candidate),
      (items) => Option.some(normalizeSessionTools(items as SessionToolSpec[])),
    ),
    Match.orElse(() => {
      throw new Error("Session tools must be an array")
    }),
  )
}

function getCustomMcpServers(value: unknown): Option.Option<OpenCodeMcpServers> {
  return Match.value(value).pipe(
    Match.when(Match.undefined, () => Option.none<OpenCodeMcpServers>()),
    Match.when(Match.null, () => Option.none<OpenCodeMcpServers>()),
    Match.orElse((servers) => Option.some(normalizeOpenCodeMcpServers(servers))),
  )
}

function getSecretKeys(value: unknown): Option.Option<string[]> {
  return Match.value(Array.isArray(value)).pipe(
    Match.when(true, () =>
      Option.some((value as unknown[]).filter((key): key is string => typeof key === "string")),
    ),
    Match.orElse(() => Option.none<string[]>()),
  )
}

function matchBooleanString(normalized: string, fallback: boolean): boolean {
  return Match.value(normalized).pipe(
    Match.when("true", () => true),
    Match.when("1", () => true),
    Match.when("yes", () => true),
    Match.when("false", () => false),
    Match.when("0", () => false),
    Match.when("no", () => false),
    Match.orElse(() => fallback),
  )
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return Match.value(value).pipe(
    Match.when(Match.boolean, (bool) => bool),
    Match.when(Match.string, (stringValue) =>
      matchBooleanString(stringValue.trim().toLowerCase(), fallback),
    ),
    Match.orElse(() => fallback),
  )
}

function getSubagentMode(
  value: unknown,
  sessionKind: SessionKind,
  manifestVersion: number | undefined,
): Option.Option<SubagentMode> {
  const defaultMode = Match.value(
    manifestVersion !== undefined && manifestVersion < WORKFLOW_SUBAGENTS_MANIFEST_VERSION,
  ).pipe(
    Match.when(true, () => "disabled" as const),
    Match.orElse(() => DEFAULT_SUBAGENT_MODE),
  )
  return Match.value(sessionKind).pipe(
    Match.when("sandbox", () => Option.none<SubagentMode>()),
    Match.orElse(
      (): Option.Option<SubagentMode> =>
        Match.value(value).pipe(
          Match.when(Match.undefined, () => Option.some(defaultMode)),
          Match.when(isSubagentMode, (mode) => Option.some<SubagentMode>(mode)),
          Match.orElse(() => {
            throw new Error("Isolate session subagents must be 'enabled' or 'disabled'")
          }),
        ),
    ),
  )
}

function getSessionRunOutputs(
  data: WorkflowSessionRunResponse,
  options: { cacheHit: boolean; createdSession?: boolean },
): Record<string, unknown> {
  const subagentRuns = Match.value(data.subagentRuns).pipe(
    Match.when(Match.undefined, () => ({})),
    Match.orElse((runs) => ({ subagentRuns: runs })),
  )
  return {
    outputs: {
      sessionId: data.sessionId,
      messageId: data.messageId,
      output: data.output,
      status: data.status,
      error: data.error,
      cacheHit: options.cacheHit,
      createdSession: options.createdSession ?? Boolean(data.createdSession),
      ...subagentRuns,
    },
  }
}

function isValidCacheEntry(entry: Partial<WorkflowSessionCacheEntry>): boolean {
  return (
    typeof entry.sessionId === "string" &&
    typeof entry.messageId === "string" &&
    typeof entry.status === "string" &&
    (typeof entry.output === "string" || entry.output === null)
  )
}

function buildCacheEntry(entry: Partial<WorkflowSessionCacheEntry>): WorkflowSessionCacheEntry {
  const errorField = Match.value(typeof entry.error === "string").pipe(
    Match.when(true, () => ({ error: entry.error as string })),
    Match.orElse(() => ({})),
  )
  const subagentRuns = Match.value(Array.isArray(entry.subagentRuns)).pipe(
    Match.when(true, () => ({ subagentRuns: entry.subagentRuns as SubagentRunSummary[] })),
    Match.orElse(() => ({})),
  )
  return {
    sessionId: entry.sessionId as string,
    messageId: entry.messageId as string,
    output: entry.output as string | null,
    status: entry.status as string,
    ...errorField,
    ...subagentRuns,
  }
}

function parseWorkflowSessionCacheEntry(
  value: string | null,
): Option.Option<WorkflowSessionCacheEntry> {
  return Option.fromNullishOr(value).pipe(
    Option.map((resolved) => parseJsonOrText(resolved)),
    Option.filter(
      (parsed): parsed is Record<string, unknown> => typeof parsed === "object" && parsed !== null,
    ),
    Option.filter((parsed) => isValidCacheEntry(parsed as Partial<WorkflowSessionCacheEntry>)),
    Option.map((parsed) => buildCacheEntry(parsed as Partial<WorkflowSessionCacheEntry>)),
  )
}

const sha256Hex = Effect.fn("workflows.sha256Hex")(function* (value: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    catch: toError,
  })
  return Arr.join(
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")),
    "",
  )
})

const buildSessionKey = Effect.fn("workflows.buildSessionKey")(function* (params: {
  input: WorkflowSessionNodeExecutionInput
  renderedKey: string
  sessionKind: SessionKind
  subagents: Option.Option<SubagentMode>
}) {
  const keyHash = yield* sha256Hex(params.renderedKey)
  const baseScope = [
    params.input.userId,
    params.input.workflowId,
    params.input.node.id,
    params.sessionKind,
    keyHash,
  ]
  const scope = Option.match(params.subagents, {
    onNone: () => baseScope,
    onSome: (mode) => [...baseScope, mode],
  })
  const scopedHash = yield* sha256Hex(scope.join("\0"))
  return {
    keyHash,
    kvKey: `workflow-session-response-cache/v1/${scopedHash}`,
  } satisfies RenderedWorkflowSessionKey
})

const buildSessionKeySome = Effect.fn("workflows.buildSessionKeySome")(function* (params: {
  input: WorkflowSessionNodeExecutionInput
  renderedKey: string
  sessionKind: SessionKind
  subagents: Option.Option<SubagentMode>
}) {
  const key = yield* buildSessionKey(params)
  return Option.some(key)
})

const buildSessionKeyIfPresent = Effect.fn("workflows.buildSessionKeyIfPresent")(
  function* (params: {
    input: WorkflowSessionNodeExecutionInput
    renderedKey: string
    sessionKind: SessionKind
    subagents: Option.Option<SubagentMode>
  }) {
    return yield* Match.value(params.renderedKey.length > 0).pipe(
      Match.when(true, () => buildSessionKeySome(params)),
      Match.orElse(() => Effect.succeed(Option.none<RenderedWorkflowSessionKey>())),
    )
  },
)

const renderSessionKey = Effect.fn("workflows.renderSessionKey")(function* (
  input: WorkflowSessionNodeExecutionInput,
  optionKey: "sessionKey" | "cacheKey",
  sessionKind: SessionKind,
  subagents: Option.Option<SubagentMode>,
) {
  const options = input.node.options ?? {}
  const keyTemplate = Option.getOrUndefined(
    Option.orElse(getString(input.inputs[optionKey]), () => getString(options[optionKey])),
  )
  return yield* Match.value(keyTemplate).pipe(
    Match.when(Match.undefined, () => Effect.succeed(Option.none<RenderedWorkflowSessionKey>())),
    Match.orElse((resolvedKeyTemplate) =>
      buildSessionKeyIfPresent({
        input,
        renderedKey: renderTemplate(resolvedKeyTemplate, createNodeContext(input)).trim(),
        sessionKind,
        subagents,
      }),
    ),
  )
})

const checkSessionReusable = Effect.fn("workflows.checkSessionReusable")(function* (params: {
  store: SessionIndexStorePromise
  sessionId: string
  userId: string
  sessionKind: SessionKind
  incognito: boolean
  subagents: Option.Option<SubagentMode>
}) {
  const session = yield* Effect.tryPromise({
    try: () => params.store.getById(params.sessionId),
    catch: toError,
  })
  const matchesSubagents = Option.match(params.subagents, {
    onNone: () => true,
    onSome: (mode) => normalizeSubagentMode(session?.subagents) === mode,
  })
  const reusable = Boolean(
    session &&
    session.user_id === params.userId &&
    session.session_kind === params.sessionKind &&
    session.incognito === params.incognito &&
    matchesSubagents &&
    session.status !== "archived",
  )
  return Match.value(reusable).pipe(
    Match.when(false, () => Option.none<string>()),
    Match.orElse(() => Option.some(params.sessionId)),
  )
})

const getReusableSessionId = Effect.fn("workflows.getReusableSessionId")(function* (input: {
  store: SessionIndexStorePromise
  userId: string
  workflowId: string
  nodeId: string
  sessionKind: SessionKind
  keyHash: string
  incognito: boolean
  subagents: Option.Option<SubagentMode>
}) {
  const scope = {
    userId: input.userId,
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    sessionKind: input.sessionKind,
    keyHash: input.keyHash,
  }
  const sessionId = yield* Effect.tryPromise({
    try: () => input.store.getWorkflowSessionReuseSessionId(scope),
    catch: toError,
  })
  return yield* Match.value(sessionId).pipe(
    Match.when(Match.null, () => Effect.succeed(Option.none<string>())),
    Match.orElse((resolvedSessionId) =>
      checkSessionReusable({
        store: input.store,
        sessionId: resolvedSessionId,
        userId: input.userId,
        sessionKind: input.sessionKind,
        incognito: input.incognito,
        subagents: input.subagents,
      }),
    ),
  )
})

function resolveCacheTtl(configured: number | undefined): Option.Option<number> {
  return Match.value(
    configured !== undefined && configured >= MIN_WORKFLOW_SESSION_CACHE_TTL_SECONDS,
  ).pipe(
    Match.when(true, () => Option.some(configured as number)),
    Match.orElse(() => Option.none<number>()),
  )
}

const getString_ = (value: unknown, fallback: string): string =>
  Match.value(typeof value === "string").pipe(
    Match.when(true, () => value as string),
    Match.orElse(() => fallback),
  )

const getOutput = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(Match.string, (resolved) => resolved),
    Match.when(Match.null, () => null),
    Match.orElse(() => null),
  )

function buildRunData(data: Record<string, unknown>): WorkflowSessionRunResponse {
  const errorField = Match.value(typeof data.error === "string").pipe(
    Match.when(true, () => ({ error: data.error as string })),
    Match.orElse(() => ({})),
  )
  const subagentRuns = Match.value(Array.isArray(data.subagentRuns)).pipe(
    Match.when(true, () => ({ subagentRuns: data.subagentRuns as SubagentRunSummary[] })),
    Match.orElse(() => ({})),
  )
  return {
    sessionId: getString_(data.sessionId, ""),
    messageId: getString_(data.messageId, ""),
    output: getOutput(data.output),
    status: getString_(data.status, "completed"),
    ...errorField,
    ...subagentRuns,
    createdSession: data.createdSession === true,
  }
}

function sessionErrorMessage(data: Record<string, unknown>, status: number): string {
  return Match.value(typeof data.error === "string").pipe(
    Match.when(true, () => data.error as string),
    Match.orElse(() => `Session action failed with status ${status}`),
  )
}

const readSessionCache = Effect.fn("workflows.readSessionCache")(function* (params: {
  input: WorkflowSessionNodeExecutionInput
  key: RenderedWorkflowSessionKey
}) {
  const cachedValue = yield* Effect.tryPromise({
    try: () => params.input.env.WORKFLOW_SESSION_RESPONSE_CACHE.get(params.key.kvKey),
    catch: toError,
  })
  return parseWorkflowSessionCacheEntry(cachedValue)
})

const persistReuseKeyIfNeeded = Effect.fn("workflows.persistReuseKey")(function* (params: {
  key: RenderedWorkflowSessionKey
  runData: WorkflowSessionRunResponse
  reusableSessionId: Option.Option<string>
  sessionIndexStore: SessionIndexStorePromise
  userId: string
  input: WorkflowSessionNodeExecutionInput
  sessionKind: SessionKind
}) {
  const shouldPersist = Effect.succeed(
    params.runData.sessionId.length > 0 &&
      params.runData.sessionId !== Option.getOrNull(params.reusableSessionId),
  )
  yield* Effect.tryPromise({
    try: () =>
      params.sessionIndexStore.upsertWorkflowSessionReuseKey({
        userId: params.userId,
        workflowId: params.input.workflowId,
        nodeId: params.input.node.id,
        sessionKind: params.sessionKind,
        keyHash: params.key.keyHash,
        sessionId: params.runData.sessionId,
        now: Date.now(),
      }),
    catch: toError,
  }).pipe(Effect.when(shouldPersist))
})

const persistSessionCacheEntry = Effect.fn("workflows.persistSessionCacheEntry")(
  function* (params: {
    key: RenderedWorkflowSessionKey
    cacheTtl: Option.Option<number>
    runData: WorkflowSessionRunResponse
    input: WorkflowSessionNodeExecutionInput
  }) {
    const errorField = Match.value(Option.fromNullishOr(params.runData.error)).pipe(
      Match.tag("Some", (some) => ({ error: some.value })),
      Match.orElse(() => ({})),
    )
    const subagentRuns = Match.value(params.runData.subagentRuns).pipe(
      Match.when(Match.undefined, () => ({})),
      Match.orElse((runs) => ({ subagentRuns: runs })),
    )
    const payload = stringifyJson({
      sessionId: params.runData.sessionId,
      messageId: params.runData.messageId,
      output: params.runData.output,
      status: params.runData.status,
      ...errorField,
      ...subagentRuns,
    } satisfies WorkflowSessionCacheEntry)
    const shouldPersistCache = Effect.succeed(params.runData.status === "completed")
    yield* Option.match(params.cacheTtl, {
      onNone: () => Effect.void,
      onSome: (ttl) =>
        Effect.tryPromise({
          try: () =>
            params.input.env.WORKFLOW_SESSION_RESPONSE_CACHE.put(params.key.kvKey, payload, {
              expirationTtl: ttl,
            }),
          catch: toError,
        }).pipe(Effect.when(shouldPersistCache)),
    })
  },
)

const runSessionRequest = Effect.fn("workflows.runSessionRequest")(function* (params: {
  input: WorkflowSessionNodeExecutionInput
  sessionKind: SessionKind
  resolvedWorkflow: { name: string; user_id: string }
  options: WorkflowNodeOptions
  content: string
  cacheKey: Option.Option<RenderedWorkflowSessionKey>
  cacheTtl: Option.Option<number>
  subagents: Option.Option<SubagentMode>
}) {
  const userId = getActionUserId(params.input)
  const model = yield* Option.match(getString(params.options.model), {
    onNone: () => workflowNodeFail("Workflow agent node requires an AI Provider model"),
    onSome: Effect.succeed,
  })
  const sessionIndexStore = createSessionIndexStoreFromD1(params.input.env.DB)
  const sessionKey = yield* renderSessionKey(
    params.input,
    "sessionKey",
    params.sessionKind,
    params.subagents,
  )
  const incognito = getBoolean(params.options.incognito, true)
  const reusableSessionId = yield* Option.match(sessionKey, {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: (key) =>
      getReusableSessionId({
        store: sessionIndexStore,
        userId,
        workflowId: params.input.workflowId,
        nodeId: params.input.node.id,
        sessionKind: params.sessionKind,
        keyHash: key.keyHash,
        incognito,
        subagents: params.subagents,
      }),
  })
  const subagents = Option.match(params.subagents, {
    onNone: () => ({}),
    onSome: (mode) => ({ subagents: mode }),
  })
  // Workflow automation needs a deterministic budget and must not inherit a mutable chat default.
  const isolateStepLimit = Match.value(params.sessionKind).pipe(
    Match.when("isolate", () => ({ isolateStepLimit: DEFAULT_ISOLATE_STEP_LIMIT })),
    Match.orElse(() => ({})),
  )
  const payload = {
    title: `${params.resolvedWorkflow.name}: ${params.input.node.label}`,
    sessionId: Option.getOrUndefined(reusableSessionId),
    content: params.content,
    sessionKind: params.sessionKind,
    model,
    reasoningEffort: Option.getOrUndefined(getString(params.options.reasoningEffort)),
    incognito,
    ...isolateStepLimit,
    ...subagents,
    tools: Option.getOrUndefined(getTools(params.options.tools)),
    customMcpServers: Option.getOrUndefined(getCustomMcpServers(params.options.customMcpServers)),
    secretKeys: Option.getOrUndefined(getSecretKeys(params.options.secretKeys)),
    repoOwner: Option.getOrUndefined(getString(params.options.repoOwner)),
    repoName: Option.getOrUndefined(getString(params.options.repoName)),
  }
  const providers = providerServicesForEnv(params.input.env)
  const response = yield* runSessionApplication({
    request: new Request(new URL("/sessions/run", getInfraServerUrl(params.input.env))),
    env: params.input.env,
    actorUserId: userId,
    initiationSource: "web",
    identityProvider: providers.identityProvider,
    githubProvider: providers.githubProvider,
    payload,
    trustedWorkflowCallbackContext: {
      type: "workflow",
      workflowId: params.input.workflowId,
      runId: params.input.runId,
      nodeId: params.input.node.id,
    },
    forcedKind: params.sessionKind,
    executionMode: "sync",
  }).pipe(
    Effect.provideService(EffectRequestLogger, workflowEffectLogger(params.input.log)),
    Effect.provideService(InternalRequests, makeInternalRequests()),
    Effect.catchIf(
      (cause): cause is ControlPlaneFailure => cause instanceof ControlPlaneFailure,
      (failure) =>
        workflowNodeFail(
          sessionErrorMessage(controlPlaneFailureData(failure.payload), failure.status),
        ),
    ),
    Effect.mapError(toError),
  )
  const data = yield* Effect.tryPromise({
    try: () => response.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    catch: toError,
  })
  yield* workflowNodeFailWhen(!response.ok, sessionErrorMessage(data, response.status))
  const runData = buildRunData(data)
  yield* Option.match(sessionKey, {
    onNone: () => Effect.void,
    onSome: (key) =>
      persistReuseKeyIfNeeded({
        key,
        runData,
        reusableSessionId,
        sessionIndexStore,
        userId,
        input: params.input,
        sessionKind: params.sessionKind,
      }),
  })
  yield* Option.match(params.cacheKey, {
    onNone: () => Effect.void,
    onSome: (key) =>
      persistSessionCacheEntry({ key, cacheTtl: params.cacheTtl, runData, input: params.input }),
  })
  return getSessionRunOutputs(runData, { cacheHit: false })
})

const runSessionNode = Effect.fn("workflows.runSessionNode")(function* (
  input: WorkflowSessionNodeExecutionInput,
  sessionKind: SessionKind,
) {
  const workflow = yield* Effect.tryPromise({
    try: () => createWorkflowStoreFromD1(input.env.DB).getWorkflow(input.workflowId),
    catch: toError,
  })
  const resolvedWorkflow = yield* Option.match(Option.fromNullishOr(workflow), {
    onNone: () => workflowNodeFail(`Workflow '${input.workflowId}' was not found`),
    onSome: (resolved) => Effect.succeed(resolved),
  })
  const options = input.node.options ?? {}
  const subagents = getSubagentMode(options.subagents, sessionKind, input.manifestVersion)
  const promptTemplate = Option.getOrElse(
    Option.orElse(getString(input.inputs.context), () => getString(options.prompt)),
    () => "Run the workflow action with this input: {{inputs}}",
  )
  const content = renderTemplate(promptTemplate, createNodeContext(input))
  const cacheTtl = resolveCacheTtl(
    Option.getOrUndefined(getPositiveInteger(options.cacheTtlSeconds)),
  )
  const cacheKey = yield* Match.value(Option.isSome(cacheTtl)).pipe(
    Match.when(true, () => renderSessionKey(input, "cacheKey", sessionKind, subagents)),
    Match.orElse(() => Effect.succeed(Option.none<RenderedWorkflowSessionKey>())),
  )
  const cached = yield* Option.match(cacheKey, {
    onNone: () => Effect.succeed(Option.none<WorkflowSessionCacheEntry>()),
    onSome: (key) => readSessionCache({ input, key }),
  })
  return yield* Option.match(cached, {
    onSome: (entry) =>
      Effect.succeed(getSessionRunOutputs(entry, { cacheHit: true, createdSession: false })),
    onNone: () =>
      runSessionRequest({
        input,
        sessionKind,
        resolvedWorkflow,
        options,
        content,
        cacheKey,
        cacheTtl,
        subagents,
      }),
  })
})
