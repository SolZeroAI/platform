import type { ApiEnv } from "infra/types/env"
import type {
  AgentRuntime,
  OpenCodeMcpServers,
  SessionInitiationSource,
  SessionCallbackContext,
  SessionKind,
  SessionToolSpec,
  StoredSessionToolResolution,
  SubagentMode,
} from "@c0-agent/shared"
import {
  createGitUser,
  generateBranchName,
  getGitHubRepoTool,
  getSelectedAiSearchSourceIds,
  getSelectedMcpcfServerIds,
  isAgentRuntimeCompatibleWithProvider,
  normalizeIsolateStepLimit,
  normalizeModelId,
  normalizeOpenCodeMcpServers,
  resolveSessionSubagentMode,
  sessionSubagentModeField,
  parseSessionToolsFromSearchParams,
  parseStoredOpenCodeMcpServers,
  resolveStoredSessionTools,
  resolveAgentRuntime,
  resolveSessionTools,
  sessionKindForAgentRuntime,
  splitModelId,
  summarizeSubagentRuns,
} from "@c0-agent/shared"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { generateId } from "../../../../background/auth/crypto"
import { McpcfRegistryStore } from "../../../../background/db/mcpcf"
import { AiSearchRegistryStore } from "../../../../background/db/ai-search"
import { SessionIndexStore } from "../../../../background/db/session-index"
import {
  getUserMcpcfAuthTokenSecretKey,
  getUserMcpcfGatewayApiTokenSecretKey,
  UserMcpcfServerConfigStore,
} from "../../../../background/db/user-mcpcf"
import {
  getMcpcfServerDisplayLabel,
  isMcpcfGatewayTokenAuthType,
  isMcpcfUserTokenAuthType,
  normalizeMcpcfAuthType,
  normalizeMcpcfUpstreamAuthType,
} from "../../../../background/mcpcf/metadata"
import {
  buildRuntimeProviderCatalog,
  getUserDefaultIsolateStepLimit,
} from "../../../../background/provider-catalog"
import { resolveSessionAccess } from "../../../../background/session/access"
import type {
  PromptExecutionMode,
  RunSessionPromptResponse,
  SandboxEvent,
} from "../../../../background/types"
import { stringifyJson } from "../../../../lib/json"
import {
  providerServicesForEnv,
  type GitHubProviderShape,
  type IdentityProviderShape,
} from "../../../services/providers"
import {
  failMessage,
  failSetup,
  failSetupWhen,
  failUnless,
  failWhen,
  InternalRequests,
  logControlPlaneError,
  requireGlobalSecretsStoreEffect,
  requireOption,
  resolveAuthorizedRepo,
  resolvePrincipalUserId,
  type AuthPrincipal,
  type ResolvedAuthorizedRepo,
  type ResolvedUserIdentity,
} from "../control-plane"

export function getSessionStub(env: ApiEnv, sessionId: string): DurableObjectStub {
  const sessionNamespace = env.SESSION as DurableObjectNamespace
  const doId = sessionNamespace.idFromName(sessionId)
  return sessionNamespace.get(doId)
}

export function resolveRequestedSessionTools(
  request: Request,
  body: {
    repoOwner?: string
    repoName?: string
    tools?: unknown
  },
): SessionToolSpec[] {
  const tools = Match.value(Array.isArray(body.tools)).pipe(
    Match.when(true, () => body.tools as SessionToolSpec[]),
    Match.orElse(() => undefined),
  )
  return resolveSessionTools({
    tools,
    queryTools: parseSessionToolsFromSearchParams(new URL(request.url).searchParams),
    repoOwner: body.repoOwner,
    repoName: body.repoName,
  })
}

export function resolveRequestedCustomMcpServers(body: {
  customMcpServers?: unknown
}): OpenCodeMcpServers {
  return normalizeOpenCodeMcpServers(body.customMcpServers as OpenCodeMcpServers | undefined)
}

const RESERVED_SECRET_ENV_KEYS = new Set([
  "PYTHONUNBUFFERED",
  "REPO_OWNER",
  "REPO_NAME",
  "SESSION_CONFIG",
  "RESTORED_FROM_SNAPSHOT",
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "PWD",
  "LANG",
])

export const validateRequestedSecretKeys = Effect.fn("controlPlane.validateRequestedSecretKeys")(
  function* (env: ApiEnv, secretKeys: readonly string[], options: { userId?: string | null } = {}) {
    const shouldValidate = Effect.succeed(secretKeys.length > 0)
    yield* Effect.when(validateRequestedSecretKeysPresent(env, secretKeys, options), shouldValidate)
  },
)

const validateRequestedSecretKeysPresent = Effect.fn(
  "controlPlane.validateRequestedSecretKeysPresent",
)(function* (env: ApiEnv, secretKeys: readonly string[], options: { userId?: string | null }) {
  const userId = yield* requireOption(
    Option.fromNullishOr(options.userId),
    "Secret attachments require a user context",
    400,
  )
  const reservedKey = Arr.findFirst(secretKeys, (key) =>
    RESERVED_SECRET_ENV_KEYS.has(key.toUpperCase()),
  )
  const reservedKeyName = Option.getOrElse(reservedKey, () => "")
  yield* failWhen(
    Option.isSome(reservedKey),
    `Secret '${reservedKeyName}' conflicts with a reserved runtime environment variable`,
    400,
  )
  const secretsStore = yield* requireGlobalSecretsStoreEffect(
    env,
    "Secret storage is not configured",
  )
  const userSecretKeys = new Set(yield* secretsStore.listSecretKeys({ userId }))
  const missingKeys = secretKeys.filter((key) => !userSecretKeys.has(key))
  yield* failWhen(
    missingKeys.length > 0,
    `Secret is not configured: ${missingKeys.join(", ")}`,
    400,
  )
})

export const validateRequestedMcpcfSessionTools = Effect.fn(
  "controlPlane.validateRequestedMcpcfSessionTools",
)(function* (
  env: ApiEnv,
  tools: readonly SessionToolSpec[],
  options: { userId?: string | null } = {},
) {
  const serverIds = getSelectedMcpcfServerIds(tools)
  const shouldValidate = Effect.succeed(serverIds.length > 0)
  yield* Effect.when(validateMcpcfServers(env, serverIds, options), shouldValidate)
})

export const validateRequestedAiSearchSessionTools = Effect.fn(
  "controlPlane.validateRequestedAiSearchSessionTools",
)(function* (env: ApiEnv, tools: readonly SessionToolSpec[]) {
  const sourceIds = getSelectedAiSearchSourceIds(tools)
  const shouldValidate = Effect.succeed(sourceIds.length > 0)
  yield* Effect.when(validateAiSearchSources(env, sourceIds), shouldValidate)
})

const validateAiSearchSources = Effect.fn("controlPlane.validateAiSearchSources")(function* (
  env: ApiEnv,
  sourceIds: readonly string[],
) {
  const registry = new AiSearchRegistryStore(env)
  const sources = yield* registry.listAvailableSourcesByIds(sourceIds)
  const availableIds = new Set(sources.map((source) => source.id))
  const missingIds = sourceIds.filter((sourceId) => !availableIds.has(sourceId))
  yield* failWhen(
    sources.length !== sourceIds.length,
    `AI Search source is not available: ${missingIds.join(", ")}`,
    400,
  )
})

type McpcfAvailableServer = Effect.Success<
  ReturnType<McpcfRegistryStore["listAvailableServersByIds"]>
>[number]

const mcpcfServerAuthType = (server: McpcfAvailableServer) =>
  server.authType ?? normalizeMcpcfAuthType(server.rawMetadata)

const validateMcpcfServers = Effect.fn("controlPlane.validateMcpcfServers")(function* (
  env: ApiEnv,
  serverIds: readonly string[],
  options: { userId?: string | null },
) {
  const registry = new McpcfRegistryStore(env)
  const config = yield* registry.getConfigOrDefault()
  yield* failUnless(
    Boolean(config.enabled && config.baseUrl),
    "MCP Context Forge is not configured",
    400,
  )

  const servers = yield* registry.listAvailableServersByIds([...serverIds])
  const availableIds = new Set(servers.map((server) => server.id))
  const missingIds = serverIds.filter((serverId) => !availableIds.has(serverId))
  yield* failWhen(
    servers.length !== serverIds.length,
    `MCP Context Forge server is not available: ${missingIds.join(", ")}`,
    400,
  )

  const needsUserOAuth = servers.some(
    (server) => !isMcpcfGatewayTokenAuthType(mcpcfServerAuthType(server)),
  )
  yield* failWhen(
    needsUserOAuth && !config.userOauthProviderId,
    "MCP Context Forge user OAuth provider is not configured",
    400,
  )

  const gatewayTokenServers = servers.filter((server) =>
    isMcpcfGatewayTokenAuthType(mcpcfServerAuthType(server)),
  )
  const upstreamTokenServers = servers.filter((server) =>
    isMcpcfUserTokenAuthType(normalizeMcpcfUpstreamAuthType(server.rawMetadata)),
  )
  const shouldValidateTokens = Effect.succeed(
    gatewayTokenServers.length > 0 || upstreamTokenServers.length > 0,
  )
  yield* Effect.when(
    validateMcpcfTokens(env, gatewayTokenServers, upstreamTokenServers, options),
    shouldValidateTokens,
  )
})

const validateMcpcfTokens = Effect.fn("controlPlane.validateMcpcfTokens")(function* (
  env: ApiEnv,
  gatewayTokenServers: ReadonlyArray<McpcfAvailableServer>,
  upstreamTokenServers: ReadonlyArray<McpcfAvailableServer>,
  options: { userId?: string | null },
) {
  const userId = yield* requireOption(
    Option.fromNullishOr(options.userId),
    "MCP Context Forge token-auth servers require a user context",
    400,
  )
  const secretsStore = yield* requireGlobalSecretsStoreEffect(
    env,
    "MCP Context Forge user API token storage is not configured",
  )
  const userSecretKeys = new Set(
    yield* secretsStore.listSecretKeys({ userId, includeMcpcfManaged: true }),
  )
  yield* failWhen(
    gatewayTokenServers.length > 0 && !userSecretKeys.has(getUserMcpcfGatewayApiTokenSecretKey()),
    "Configure your ContextForge API token in Accounts.",
    400,
  )
  const shouldCheckUpstream = Effect.succeed(upstreamTokenServers.length > 0)
  yield* Effect.when(
    validateMcpcfUpstreamTokens(env, upstreamTokenServers, userId, userSecretKeys),
    shouldCheckUpstream,
  )
})

const validateMcpcfUpstreamTokens = Effect.fn("controlPlane.validateMcpcfUpstreamTokens")(
  function* (
    env: ApiEnv,
    upstreamTokenServers: ReadonlyArray<McpcfAvailableServer>,
    userId: string,
    userSecretKeys: Set<string>,
  ) {
    const userConfigs = yield* new UserMcpcfServerConfigStore(env.DB).listByUserAndServerIds(
      userId,
      upstreamTokenServers.map((server) => server.id),
    )
    const userConfigByServerId = new Map(
      userConfigs.map((userConfig) => [userConfig.serverId, userConfig]),
    )
    const missingServer = Arr.findFirst(
      upstreamTokenServers,
      (server) =>
        !userSecretKeys.has(
          userConfigByServerId.get(server.id)?.authTokenSecretKey ??
            getUserMcpcfAuthTokenSecretKey(server.id),
        ),
    )
    const missingServerLabel = Option.match(missingServer, {
      onSome: (server) => getMcpcfServerDisplayLabel(server),
      onNone: () => "",
    })
    yield* failWhen(
      Option.isSome(missingServer),
      `Configure your token for ${missingServerLabel} in MCP settings.`,
      400,
    )
  },
)

export const requireSessionAccess = Effect.fn("controlPlane.requireSessionAccess")(function* (
  request: Request,
  env: ApiEnv,
  principal: AuthPrincipal | null,
  sessionId: string,
) {
  yield* requireOption(Option.fromNullishOr(principal), "Unauthorized", 401)
  const userId = yield* requireOption(
    resolvePrincipalUserId(request, principal),
    "Missing acting user context",
    401,
  )
  return yield* requireSessionAccessForUser(env, userId, sessionId)
})

export const requireSessionAccessForUser = Effect.fn("controlPlane.requireSessionAccessForUser")(
  function* (env: ApiEnv, userId: string, sessionId: string) {
    const store = new SessionIndexStore(env.DB)
    const access = yield* resolveSessionAccess(store, sessionId, userId)
    return yield* requireOption(access, "Session not found", 404)
  },
)

function getVisibleModelIds(
  catalog: Awaited<ReturnType<typeof buildRuntimeProviderCatalog>>,
): Set<string> {
  return new Set(catalog.modelOptions.flatMap((group) => group.models.map((model) => model.id)))
}

const resolveSessionRepo = Effect.fn("controlPlane.resolveSessionRepo")(function* (input: {
  env: ApiEnv
  identity: ResolvedUserIdentity
  githubProvider: GitHubProviderShape
  requestedTools: SessionToolSpec[]
}) {
  const requestedRepo = getGitHubRepoTool(input.requestedTools)
  return yield* Option.match(Option.fromNullishOr(requestedRepo), {
    onNone: () => Effect.succeed(Option.none<ResolvedAuthorizedRepo>()),
    onSome: (repo) => resolveSessionRepoForRequest(input, repo),
  })
})

const resolveSessionRepoForRequest = Effect.fn("controlPlane.resolveSessionRepoForRequest")(
  function* (
    input: {
      env: ApiEnv
      identity: ResolvedUserIdentity
      githubProvider: GitHubProviderShape
    },
    requestedRepo: { repoOwner: string; repoName: string },
  ) {
    yield* failSetupWhen(
      Option.isNone(Option.fromNullishOr(input.identity.githubAppUserAccessToken)),
      input.env,
      "GitHub App is not authorized for this user",
      403,
      { githubSetup: "1" },
    )
    const repoOption = yield* resolveAuthorizedRepo(
      input.identity,
      requestedRepo.repoOwner,
      requestedRepo.repoName,
      input.githubProvider,
    ).pipe(
      Effect.tapError((cause) =>
        logControlPlaneError(cause, { event: "control_plane.session_repo_resolution_failed" }),
      ),
      Effect.catch(() => failMessage("Failed to resolve repository", 500)),
    )
    const resolvedRepo = yield* requireOption(
      repoOption,
      "Repository is not accessible to both this user and the GitHub App",
      403,
    )
    const hasWriteAccess =
      resolvedRepo.permissions.canPush && resolvedRepo.permissions.canOpenPullRequests
    yield* failUnless(
      hasWriteAccess,
      "Repository does not grant the user and GitHub App enough write access for repo-backed agent sessions",
      403,
    )
    return Option.some(resolvedRepo)
  },
)

const resolveSessionModel = Effect.fn("controlPlane.resolveSessionModel")(function* (
  env: ApiEnv,
  userId: string,
  requestedModelInput: string | undefined,
) {
  const providerCatalog = yield* Effect.tryPromise(() => buildRuntimeProviderCatalog(env, userId))
  const visibleModelIds = getVisibleModelIds(providerCatalog)
  yield* failWhen(
    visibleModelIds.size === 0,
    "No models are configured for this user. An admin needs to set up an AI Provider.",
    400,
  )
  const requestedModel = yield* requireOption(
    Option.match(Option.fromNullishOr(requestedModelInput), {
      onSome: (model) => Option.some(normalizeModelId(model)),
      onNone: () => Option.fromNullishOr(providerCatalog.defaultModel),
    }),
    "No default model is configured for this user",
    400,
  )
  yield* failUnless(
    visibleModelIds.has(requestedModel),
    `Model '${requestedModel}' is not configured for this user`,
    400,
  )
  return requestedModel
})

const resolveGithubAuthor = Effect.fn("controlPlane.resolveGithubAuthor")(function* (input: {
  identity: ResolvedUserIdentity
  githubProvider: GitHubProviderShape
  resolvedRepo: Option.Option<ResolvedAuthorizedRepo>
}) {
  return yield* Option.match(Option.fromNullishOr(input.identity.githubAppUserAccessToken), {
    onNone: () =>
      Effect.succeed(Option.none<{ login: string; author: { name: string; email: string } }>()),
    onSome: (accessToken) =>
      Match.value(Option.isSome(input.resolvedRepo)).pipe(
        Match.when(false, () =>
          Effect.succeed(Option.none<{ login: string; author: { name: string; email: string } }>()),
        ),
        Match.orElse(() => resolveGithubAuthorProfile(input.githubProvider, accessToken)),
      ),
  })
})

const resolveGithubAuthorProfile = Effect.fn("controlPlane.resolveGithubAuthorProfile")(function* (
  githubProvider: GitHubProviderShape,
  accessToken: string,
) {
  const profile = yield* githubProvider.getGitHubUserProfile(accessToken).pipe(
    Effect.tapError((cause) =>
      logControlPlaneError(cause, { event: "control_plane.github_profile_resolution_failed" }),
    ),
    Effect.catch(() => failMessage("Failed to resolve GitHub profile for commit attribution", 502)),
  )
  return Option.some({
    login: profile.login,
    author: createGitUser(profile.login, profile.name, profile.email, profile.id),
  })
})

export const createSessionWithIdentity = Effect.fn("controlPlane.createSessionWithIdentity")(
  function* (input: {
    env: ApiEnv
    identity: ResolvedUserIdentity
    githubProvider: GitHubProviderShape
    requestedTools: SessionToolSpec[]
    requestedCustomMcpServers: OpenCodeMcpServers
    requestedSecretKeys?: string[]
    sessionKind: SessionKind
    agentRuntime?: AgentRuntime | null
    source?: SessionInitiationSource
    serverUrl?: string | null
    title?: string | null
    model?: string
    reasoningEffort?: string | null
    isolateStepLimit?: number | null
    subagents?: SubagentMode | null
    incognito?: boolean
    githubLogin?: string | null
    githubName?: string | null
    githubEmail?: string | null
  }) {
    const agentRuntime = resolveAgentRuntime({
      agentRuntime: input.agentRuntime,
      sessionKind: input.sessionKind,
    })
    const sessionKind = sessionKindForAgentRuntime(agentRuntime)
    const resolvedRepoOption = yield* resolveSessionRepo(input)
    const requestedModel = yield* resolveSessionModel(input.env, input.identity.userId, input.model)
    yield* validateAgentRuntimeModel(agentRuntime, requestedModel)

    const sessionId = generateId()
    const now = Date.now()
    const resolvedRepo = Option.getOrNull(resolvedRepoOption)
    const repoOwner = resolvedRepo?.repoOwner ?? ""
    const repoName = resolvedRepo?.repoName ?? ""
    const repoDefaultBranch = resolvedRepo?.defaultBranch ?? null
    const branchName = Option.match(resolvedRepoOption, {
      onSome: () => generateBranchName(sessionId, input.title ?? undefined),
      onNone: () => null,
    })

    const authorInfo = yield* resolveGithubAuthor({
      identity: input.identity,
      githubProvider: input.githubProvider,
      resolvedRepo: resolvedRepoOption,
    })
    const githubLogin = Option.match(authorInfo, {
      onSome: (info) => info.login,
      onNone: () => input.githubLogin ?? null,
    })
    const githubAuthor = Option.getOrNull(Option.map(authorInfo, (info) => info.author))

    const isolateStepLimit = yield* resolveIsolateStepLimit({
      ...input,
      sessionKind,
      agentRuntime,
    })
    const subagents = resolveSessionSubagentMode(sessionKind, input.subagents)

    const stub = getSessionStub(input.env, sessionId)
    const internalRequests = yield* InternalRequests
    const initResponse = yield* internalRequests.fetch(stub, "http://internal/internal/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyJson({
        sessionName: sessionId,
        sessionKind,
        agentRuntime,
        serverUrl: input.serverUrl ?? null,
        title: input.title ?? null,
        repoOwner,
        repoName,
        githubInstallationId: resolvedRepo?.installationId ?? null,
        githubRepoId: resolvedRepo?.repoId ?? null,
        repoDefaultBranch,
        branchName,
        tools: input.requestedTools,
        customMcpServers: input.requestedCustomMcpServers,
        secretKeys: input.requestedSecretKeys ?? [],
        isolateStepLimit,
        subagents,
        model: requestedModel,
        reasoningEffort: input.reasoningEffort ?? null,
        userId: input.identity.userId,
        githubLogin,
        githubName: githubAuthor?.name ?? input.githubName ?? input.identity.name ?? null,
        githubEmail: githubAuthor?.email ?? input.githubEmail ?? input.identity.email ?? null,
      }),
    })
    yield* failUnless(initResponse.ok, "Failed to initialize session", 500)

    const indexStore = new SessionIndexStore(input.env.DB)
    yield* indexStore.create({
      id: sessionId,
      userId: input.identity.userId,
      title: input.title ?? null,
      repoOwner,
      repoName,
      githubInstallationId: resolvedRepo?.installationId ?? null,
      githubRepoId: resolvedRepo?.repoId ?? null,
      repoDefaultBranch,
      branchName,
      tools: input.requestedTools,
      customMcpServers: input.requestedCustomMcpServers,
      secretKeys: input.requestedSecretKeys ?? [],
      isolateStepLimit,
      subagents,
      model: requestedModel,
      reasoningEffort: input.reasoningEffort ?? null,
      sessionKind,
      agentRuntime,
      source: input.source ?? "web",
      incognito: input.incognito ?? false,
      status: "created",
      createdAt: now,
      updatedAt: now,
    })
    return sessionId
  },
)

const validateAgentRuntimeModel = Effect.fn("controlPlane.validateAgentRuntimeModel")(function* (
  agentRuntime: AgentRuntime,
  requestedModel: string,
) {
  const { providerId } = splitModelId(requestedModel)
  yield* failUnless(
    isAgentRuntimeCompatibleWithProvider(agentRuntime, providerId),
    `Model '${requestedModel}' is not compatible with ${agentRuntime} runtime`,
    400,
  )
})

const resolveIsolateStepLimit = Effect.fn("controlPlane.resolveIsolateStepLimit")(
  function* (input: {
    env: ApiEnv
    identity: ResolvedUserIdentity
    sessionKind: SessionKind
    agentRuntime?: AgentRuntime | null
    isolateStepLimit?: number | null
  }) {
    const fetchDefaultLimit = Effect.tryPromise(() =>
      getUserDefaultIsolateStepLimit(input.env, input.identity.userId),
    )
    const isolateGuard = Effect.succeed(
      resolveAgentRuntime({
        agentRuntime: input.agentRuntime,
        sessionKind: input.sessionKind,
      }) === "isolate",
    )
    const fallback = yield* Effect.when(fetchDefaultLimit, isolateGuard)
    return Option.match(fallback, {
      onSome: (value) => normalizeIsolateStepLimit(input.isolateStepLimit, value),
      onNone: () => normalizeIsolateStepLimit(input.isolateStepLimit),
    })
  },
)

export const enqueuePromptForSession = Effect.fn("controlPlane.enqueuePromptForSession")(
  function* (input: {
    env: ApiEnv
    sessionId: string
    actorUserId: string
    content: string
    source?: string
    agentRuntime?: AgentRuntime | null
    model?: string
    reasoningEffort?: string
    executionMode?: PromptExecutionMode
    attachments?: ReadonlyArray<{ type: string; name: string; url?: string }>
    callbackContext?: SessionCallbackContext
  }) {
    const modelInput = Option.fromNullishOr(input.model)
    const validatePromptModel = resolvePromptModel(
      input.env,
      input.actorUserId,
      input.agentRuntime ?? null,
      Option.getOrElse(modelInput, () => ""),
    )
    const modelGuard = Effect.succeed(Option.isSome(modelInput))
    const resolvedModel = yield* Effect.when(validatePromptModel, modelGuard)
    const stub = getSessionStub(input.env, input.sessionId)
    const promptPath = Match.value(input.executionMode === "stream").pipe(
      Match.when(true, () => "/prompt"),
      Match.orElse(() => "/prompt-async"),
    )
    const internalRequests = yield* InternalRequests
    return yield* internalRequests.fetch(stub, `http://internal/internal${promptPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyJson({
        content: input.content,
        authorId: input.actorUserId,
        source: input.source ?? "web",
        model: Option.getOrUndefined(resolvedModel),
        reasoningEffort: input.reasoningEffort,
        executionMode: input.executionMode ?? "sync",
        attachments: input.attachments,
        callbackContext: input.callbackContext,
      }),
    })
  },
)

const resolvePromptModel = Effect.fn("controlPlane.resolvePromptModel")(function* (
  env: ApiEnv,
  actorUserId: string,
  agentRuntime: AgentRuntime | null,
  model: string,
) {
  const providerCatalog = yield* Effect.tryPromise(() =>
    buildRuntimeProviderCatalog(env, actorUserId),
  )
  const visibleModelIds = getVisibleModelIds(providerCatalog)
  const requestedModel = normalizeModelId(model)
  yield* failUnless(
    visibleModelIds.has(requestedModel),
    `Model '${requestedModel}' is not configured for this user`,
    400,
  )
  yield* validateAgentRuntimeModel(agentRuntime ?? "isolate", requestedModel)
  return requestedModel
})

export const collectPromptResult = Effect.fn("controlPlane.collectPromptResult")(function* (
  stub: DurableObjectStub,
  messageId: string,
) {
  const internalRequests = yield* InternalRequests
  const eventsResponse = yield* internalRequests.fetch(
    stub,
    `http://internal/internal/events?messageId=${encodeURIComponent(messageId)}`,
  )
  return yield* Match.value(eventsResponse.ok).pipe(
    Match.when(false, () =>
      Effect.succeed<PromptResult>({
        status: "failed",
        output: null,
        error: "Failed to collect prompt events",
      }),
    ),
    Match.orElse(() => summarizePromptEvents(eventsResponse, messageId)),
  )
})

const summarizePromptEvents = Effect.fn("controlPlane.summarizePromptEvents")(function* (
  eventsResponse: Response,
  messageId: string,
) {
  const payload = yield* Effect.tryPromise(
    () =>
      eventsResponse.json() as Promise<{
        events: Array<{ data: SandboxEvent }>
      }>,
  )
  const events = payload.events
    .map((event) => event.data)
    .filter((event) => "messageId" in event && event.messageId === messageId)

  const latestToken = events
    .filter((event): event is Extract<SandboxEvent, { type: "token" }> => event.type === "token")
    .sort((left, right) => left.timestamp - right.timestamp)
    .at(-1)
  const latestCompletion = events
    .filter(
      (event): event is Extract<SandboxEvent, { type: "execution_complete" }> =>
        event.type === "execution_complete",
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .at(-1)
  const latestError = events
    .filter((event): event is Extract<SandboxEvent, { type: "error" }> => event.type === "error")
    .sort((left, right) => left.timestamp - right.timestamp)
    .at(-1)

  const completionOption = Option.fromNullishOr(latestCompletion)
  const output = latestToken?.content ?? null
  const status = Option.match(completionOption, {
    onSome: (completion) =>
      Match.value(completion.success).pipe(
        Match.when(true, () => "completed" as const),
        Match.orElse(() => "failed" as const),
      ),
    onNone: () => "processing" as const,
  })
  const error = Option.match(completionOption, {
    onSome: (completion) => completion.error ?? latestError?.error,
    onNone: () => latestError?.error,
  })
  const subagentRuns = summarizeSubagentRuns(events)
  const subagentRunField = Match.value(subagentRuns.length > 0).pipe(
    Match.when(true, () => ({ subagentRuns })),
    Match.orElse(() => ({})),
  )
  return {
    status,
    output,
    error,
    ...subagentRunField,
  } satisfies PromptResult
})

const PROMPT_POLL_INTERVAL_MS = 5_000
const PROMPT_POLL_TIMEOUT_MS = 10 * 60_000

type PromptResult = Pick<RunSessionPromptResponse, "status" | "output" | "error" | "subagentRuns">

interface PromptPollState {
  done: boolean
  result: PromptResult
  lastCollectError: string | null
}

function promptTimeoutResult(state: PromptPollState): PromptResult {
  const error = Option.match(Option.fromNullishOr(state.lastCollectError), {
    onSome: (collectError) =>
      `Timed out waiting for prompt completion; last event fetch error: ${collectError}`,
    onNone: () => "Timed out waiting for prompt completion",
  })
  return { status: "failed", output: state.result.output, error }
}

const sleepThenState = (state: PromptPollState) =>
  Effect.sleep(PROMPT_POLL_INTERVAL_MS).pipe(Effect.map(() => state))

const pollPromptOnce = Effect.fn("controlPlane.pollPromptOnce")(function* (
  stub: DurableObjectStub,
  messageId: string,
  lastResult: PromptResult,
) {
  const outcome = yield* Effect.option(collectPromptResult(stub, messageId))
  return yield* Option.match(outcome, {
    onNone: () =>
      sleepThenState({
        done: false,
        result: lastResult,
        lastCollectError: "prompt event fetch failed",
      }),
    onSome: (value) =>
      Match.value(value.status === "processing").pipe(
        Match.when(true, () =>
          sleepThenState({ done: false, result: value, lastCollectError: null }),
        ),
        Match.orElse(() =>
          Effect.succeed<PromptPollState>({ done: true, result: value, lastCollectError: null }),
        ),
      ),
  })
})

export const waitForPromptResult = Effect.fn("controlPlane.waitForPromptResult")(function* (
  stub: DurableObjectStub,
  messageId: string,
) {
  const deadline = Date.now() + PROMPT_POLL_TIMEOUT_MS
  let state: PromptPollState = {
    done: false,
    result: { status: "processing", output: null },
    lastCollectError: null,
  }
  yield* Effect.whileLoop({
    while: () => !state.done && Date.now() < deadline,
    body: () => pollPromptOnce(stub, messageId, state.result),
    step: (next) => {
      state = next
    },
  })
  return Match.value(state.done).pipe(
    Match.when(true, () => state.result),
    Match.orElse(() => promptTimeoutResult(state)),
  )
})

export function parsePromptExecutionMode(url: URL): PromptExecutionMode {
  return Option.match(Option.fromNullishOr(url.searchParams.get("stream")), {
    onNone: () => "sync",
    onSome: (rawValue) =>
      Match.value(rawValue === "1" || rawValue.toLowerCase() === "true").pipe(
        Match.when(true, () => "stream" as const),
        Match.orElse(() => "sync" as const),
      ),
  })
}

type SessionListResult = Effect.Success<ReturnType<SessionIndexStore["list"]>>

function formatSessionListItem(
  session: SessionListResult["sessions"][number],
  sessionTools: StoredSessionToolResolution,
) {
  return {
    id: session.id,
    sessionKind: session.session_kind,
    agentRuntime: session.agent_runtime,
    source: session.source ?? "web",
    incognito: session.incognito,
    title: session.title,
    repoOwner: session.repo_owner,
    repoName: session.repo_name,
    githubInstallationId: session.github_installation_id,
    githubRepoId: session.github_repo_id,
    repoDefaultBranch: session.repo_default_branch,
    branchName: session.branch_name,
    tools: sessionTools.tools,
    unavailableTools: sessionTools.unavailableTools,
    customMcpServers: parseStoredOpenCodeMcpServers(session.custom_mcp_json),
    isolateStepLimit: session.isolate_step_limit,
    ...sessionSubagentModeField(session.session_kind, session.subagents),
    model: session.model,
    reasoningEffort: session.reasoning_effort ?? undefined,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }
}

export function formatSessionListResponse(
  result: SessionListResult,
  resolvedSessionTools: readonly StoredSessionToolResolution[] = result.sessions.map((session) =>
    resolveStoredSessionTools(session.tools_json),
  ),
) {
  return {
    ...result,
    sessions: result.sessions.map((session, index) =>
      formatSessionListItem(
        session,
        resolvedSessionTools[index] ?? resolveStoredSessionTools(session.tools_json),
      ),
    ),
  }
}

export const resolveSlackLinkedUserId = Effect.fn("controlPlane.resolveSlackLinkedUserId")(
  function* (
    env: ApiEnv,
    slackUserId: string,
    identityProvider: IdentityProviderShape = providerServicesForEnv(env).identityProvider,
  ) {
    const linkedUserId = yield* Option.match(
      Option.fromNullishOr(
        yield* identityProvider.getLinkedUserIdByProviderAccountId(env, "slack", slackUserId),
      ),
      {
        onSome: (userId) => Effect.succeed(userId),
        onNone: () =>
          failSetup(env, "Slack user is not linked to a c0 account", 403, { slackUserId }),
      },
    )
    return linkedUserId
  },
)
