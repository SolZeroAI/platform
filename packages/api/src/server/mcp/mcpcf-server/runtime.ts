import { getSelectedMcpcfServerIds, parseStoredSessionTools } from "@solzero/shared"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { McpcfConfigurationError } from "../../background/db/errors"
import {
  createMcpcfRegistryStoreFromEnv,
  type McpcfConfigRecord,
  type McpcfServerRecord,
} from "../../background/db/mcpcf"
import { createGlobalSecretsStoreFromD1 } from "../../background/db/repo-secrets"
import {
  createUserMcpcfServerConfigStoreFromD1,
  getUserMcpcfAuthTokenSecretKey,
  getUserMcpcfGatewayApiTokenSecretKey,
  type UserMcpcfServerConfigRecord,
} from "../../background/db/user-mcpcf"
import {
  isMcpcfGatewayTokenAuthType,
  isMcpcfUserTokenAuthType,
  normalizeMcpcfAuthType,
  normalizeMcpcfUpstreamAuthType,
} from "../../background/mcpcf/metadata"
import {
  MCPCF_MCP_TIMEOUT_MS,
  MCPCF_PROXY_MCP_ROUTE,
  parseAllowedMcpcfServers,
} from "../../background/session/mcp-config"
import type { Env } from "../../background/types"
import { describeError, toError } from "../../lib/effect-errors"
import {
  type AuthLogSink,
  getLinkedOAuthAccessTokenForUserId,
  LinkedOAuthReconnectRequiredError,
} from "../../lib/oauth-tokens"

export class McpcfMcpRuntimeError extends Schema.TaggedError<McpcfMcpRuntimeError>()(
  "McpcfMcpRuntimeError",
  {
    message: Schema.String,
  },
) {}

interface McpcfSessionRow {
  user_id: string
  tools_json: string | null
}

export type McpcfRuntimeAuthMode = "mixed" | "mcpcf_oauth" | "mcpcf_token"

export interface McpcfServerRuntimeSettings {
  defaultToolsEnabled: boolean
  disabledTools: string[]
}

export interface McpcfUpstreamListToolsInput {
  config: McpcfConfigRecord
  server: McpcfServerRecord
  accessToken: string
  upstreamAccessToken?: string
}

export interface McpcfUpstreamCallToolInput {
  config: McpcfConfigRecord
  server: McpcfServerRecord
  accessToken: string
  upstreamAccessToken?: string
  toolName: string
  arguments?: Record<string, unknown>
}

export function getMcpcfServerMcpUrl(config: McpcfConfigRecord, server: McpcfServerRecord): string {
  return `${config.baseUrl}/servers/${encodeURIComponent(server.id)}/mcp`
}

function rewriteRequestPathname(request: Request, url: URL, pathname: string): Request {
  url.pathname = pathname
  return new Request(url.toString(), request)
}

export function normalizeMcpcfMcpRequest(request: Request): Request {
  const url = new URL(request.url)
  return Match.value(url.pathname === `${MCPCF_PROXY_MCP_ROUTE}/`).pipe(
    Match.when(true, () => rewriteRequestPathname(request, url, MCPCF_PROXY_MCP_ROUTE)),
    Match.orElse(() => request),
  )
}

export function redactMcpcfErrorMessage(error: unknown, secrets: string[] = []): string {
  const rawMessage = describeError(error)
  const redacted = Arr.reduce(
    Arr.filter(secrets, (secret) => secret.length > 0),
    rawMessage,
    (message, secret) => message.split(secret).join("[redacted]"),
  )
  return redacted.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
}

export function formatMcpcfBearerCredential(token: string): string {
  const trimmed = token.trim()
  return Match.value(/^Bearer\s+/i.test(trimmed)).pipe(
    Match.when(true, () => trimmed),
    Match.orElse(() => `Bearer ${trimmed}`),
  )
}

const withMcpcfClient = <A>(input: {
  config: McpcfConfigRecord
  server: McpcfServerRecord
  accessToken: string
  upstreamAccessToken: Option.Option<string>
  action: (client: Client) => Promise<A>
}) =>
  Effect.gen(function* () {
    const client = new Client(
      {
        name: "s0-mcpcf-proxy",
        version: "1.0.0",
      },
      {
        jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      },
    )
    const transport = new StreamableHTTPClientTransport(
      new URL(getMcpcfServerMcpUrl(input.config, input.server)),
      {
        requestInit: {
          headers: {
            Authorization: formatMcpcfBearerCredential(input.accessToken),
            ...Option.match(input.upstreamAccessToken, {
              onNone: () => ({}),
              onSome: (upstreamAccessToken) => ({
                "X-Upstream-Authorization": formatMcpcfBearerCredential(upstreamAccessToken),
              }),
            }),
          },
        },
      },
    )

    const closeClient = Effect.tryPromise(() => client.close().catch(() => {})).pipe(Effect.ignore)
    return yield* Effect.tryPromise({
      try: () =>
        client
          .connect(transport, {
            timeout: MCPCF_MCP_TIMEOUT_MS,
            maxTotalTimeout: MCPCF_MCP_TIMEOUT_MS,
          })
          .then(() => input.action(client)),
      catch: (cause) =>
        new McpcfMcpRuntimeError({
          message: redactMcpcfErrorMessage(cause, [
            input.accessToken,
            Option.getOrElse(input.upstreamAccessToken, () => ""),
          ]),
        }),
    }).pipe(Effect.ensuring(closeClient))
  })

export const defaultMcpcfUpstreamClient = {
  listTools: ({ config, server, accessToken, upstreamAccessToken }: McpcfUpstreamListToolsInput) =>
    withMcpcfClient({
      config,
      server,
      accessToken,
      upstreamAccessToken: Option.fromNullishOr(upstreamAccessToken),
      action: (client) =>
        client.listTools(undefined, {
          timeout: MCPCF_MCP_TIMEOUT_MS,
          maxTotalTimeout: MCPCF_MCP_TIMEOUT_MS,
        }),
    }).pipe(Effect.map((result) => result.tools)),
  callTool: ({
    config,
    server,
    accessToken,
    upstreamAccessToken,
    toolName,
    arguments: toolArguments,
  }: McpcfUpstreamCallToolInput) =>
    withMcpcfClient({
      config,
      server,
      accessToken,
      upstreamAccessToken: Option.fromNullishOr(upstreamAccessToken),
      action: (client) =>
        client.callTool(
          {
            name: toolName,
            arguments: toolArguments ?? {},
          },
          CallToolResultSchema,
          {
            timeout: MCPCF_MCP_TIMEOUT_MS,
            maxTotalTimeout: MCPCF_MCP_TIMEOUT_MS,
          },
        ) as Promise<CallToolResult>,
    }),
}

export type McpcfUpstreamClient = typeof defaultMcpcfUpstreamClient

export interface McpcfMcpLogSink extends AuthLogSink {
  set(event: Record<string, unknown>): void
  emit(event: Record<string, unknown>): void
}

export interface McpcfMcpRuntimeContext {
  upstreamClient?: McpcfUpstreamClient
  log: McpcfMcpLogSink
}

export interface McpcfMcpContext {
  userId: Option.Option<string>
  oauthProviderId: Option.Option<string>
  providerUserId: Option.Option<string>
  accessToken: Option.Option<string>
  accessTokensByServerId: Record<string, string>
  upstreamAccessTokensByServerId: Record<string, string>
  accessTokenIssuer: Option.Option<string>
  expectedAccessTokenIssuer: Option.Option<string>
  authMode: Option.Option<McpcfRuntimeAuthMode>
  serverSettingsById: Record<string, McpcfServerRuntimeSettings>
  config: Option.Option<McpcfConfigRecord>
  servers: McpcfServerRecord[]
  upstreamClient: McpcfUpstreamClient
  log: McpcfMcpLogSink
}

const mcpcfSelectionFromSession = Effect.fn("mcp.mcpcf.selectionFromSession")(function* (
  env: Env,
  sessionId: string,
) {
  const row = yield* Effect.tryPromise({
    try: () =>
      env.DB.prepare(
        `SELECT user_id, tools_json
           FROM sessions
           WHERE id = ?`,
      )
        .bind(sessionId)
        .first<McpcfSessionRow>(),
    catch: toError,
  })

  return {
    userId: Option.fromNullishOr(row?.user_id),
    serverIds: getSelectedMcpcfServerIds(parseStoredSessionTools(row?.tools_json)),
  }
})

function getMcpcfRuntimeAuthType(server: McpcfServerRecord): Option.Option<string> {
  return Option.fromNullishOr(
    (server.authType ?? normalizeMcpcfAuthType(server.rawMetadata))?.trim().toLowerCase(),
  )
}

function getMcpcfUpstreamAuthType(server: McpcfServerRecord): Option.Option<string> {
  return Option.fromNullishOr(normalizeMcpcfUpstreamAuthType(server.rawMetadata))
}

function usesMcpcfGatewayTokenCredential(server: McpcfServerRecord): boolean {
  return Option.match(getMcpcfRuntimeAuthType(server), {
    onNone: () => false,
    onSome: (authType) => isMcpcfGatewayTokenAuthType(authType),
  })
}

function usesUserUpstreamTokenCredential(server: McpcfServerRecord): boolean {
  return Option.match(getMcpcfUpstreamAuthType(server), {
    onNone: () => false,
    onSome: (authType) => isMcpcfUserTokenAuthType(authType),
  })
}

function resolveMcpcfAuthModeFromServers(
  hasGatewayTokenServer: boolean,
  hasGatewayOAuthServer: boolean,
): McpcfRuntimeAuthMode {
  return Match.value(hasGatewayTokenServer && hasGatewayOAuthServer).pipe(
    Match.when(true, () => "mixed" as const),
    Match.orElse(() =>
      Match.value(hasGatewayTokenServer).pipe(
        Match.when(true, () => "mcpcf_token" as const),
        Match.orElse(() => "mcpcf_oauth" as const),
      ),
    ),
  )
}

export function getMcpcfRuntimeAuthMode(
  servers: readonly McpcfServerRecord[],
): Option.Option<McpcfRuntimeAuthMode> {
  return Match.value(servers.length === 0).pipe(
    Match.when(true, () => Option.none()),
    Match.orElse(() =>
      Option.some(
        resolveMcpcfAuthModeFromServers(
          servers.some(usesMcpcfGatewayTokenCredential),
          servers.some((server) => !usesMcpcfGatewayTokenCredential(server)),
        ),
      ),
    ),
  )
}

const getUserMcpcfServerAuthToken = Effect.fn("mcp.mcpcf.userServerAuthToken")(function* (
  env: Env,
  input: {
    userId: string
    server: McpcfServerRecord
    userConfig: Option.Option<UserMcpcfServerConfigRecord>
  },
) {
  const encryptionKey = yield* Option.match(Option.fromNullishOr(env.REPO_SECRETS_ENCRYPTION_KEY), {
    onNone: () =>
      Effect.fail(
        new McpcfMcpRuntimeError({
          message: `Configure your token for ${input.server.label} in MCP settings.`,
        }),
      ),
    onSome: Effect.succeed,
  })

  const secrets = yield* Effect.tryPromise({
    try: () =>
      createGlobalSecretsStoreFromD1(env.DB, encryptionKey).getDecryptedSecrets({
        userId: input.userId,
      }),
    catch: toError,
  })
  const secretKey = Option.match(input.userConfig, {
    onNone: () => getUserMcpcfAuthTokenSecretKey(input.server.id),
    onSome: (userConfig) =>
      userConfig.authTokenSecretKey ?? getUserMcpcfAuthTokenSecretKey(input.server.id),
  })
  return yield* Option.match(Option.fromNullishOr(secrets[secretKey]?.trim()), {
    onNone: () =>
      Effect.fail(
        new McpcfMcpRuntimeError({
          message: `Configure your token for ${input.server.label} in MCP settings.`,
        }),
      ),
    onSome: Effect.succeed,
  })
})

const getUserMcpcfGatewayAccessToken = Effect.fn("mcp.mcpcf.userGatewayAccessToken")(function* (
  env: Env,
  input: {
    userId: string
    server: McpcfServerRecord
  },
) {
  const encryptionKey = yield* Option.match(Option.fromNullishOr(env.REPO_SECRETS_ENCRYPTION_KEY), {
    onNone: () =>
      Effect.fail(
        new McpcfMcpRuntimeError({
          message: "MCP Context Forge user API token storage is not configured",
        }),
      ),
    onSome: Effect.succeed,
  })

  const secrets = yield* Effect.tryPromise({
    try: () =>
      createGlobalSecretsStoreFromD1(env.DB, encryptionKey).getDecryptedSecrets({
        userId: input.userId,
      }),
    catch: toError,
  })
  return yield* Option.match(
    Option.fromNullishOr(secrets[getUserMcpcfGatewayApiTokenSecretKey()]?.trim()),
    {
      onNone: () =>
        Effect.fail(
          new McpcfMcpRuntimeError({
            message: "Configure your ContextForge API token in Accounts.",
          }),
        ),
      onSome: Effect.succeed,
    },
  )
})

export function getServerRuntimeSettings(
  userConfig: Option.Option<UserMcpcfServerConfigRecord>,
): McpcfServerRuntimeSettings {
  const defaultToolsEnabled = Option.match(userConfig, {
    onNone: () => true,
    onSome: (config) => config.defaultToolsEnabled ?? true,
  })
  const disabledTools = Option.match(userConfig, {
    onNone: () => [] as string[],
    onSome: (config) => config.disabledTools ?? [],
  })
  return { defaultToolsEnabled, disabledTools }
}

export function emptyMcpcfContext(
  storedSelection: { userId: Option.Option<string>; serverIds: string[] },
  config: McpcfConfigRecord,
  servers: McpcfServerRecord[],
  runtimeContext: McpcfMcpRuntimeContext,
): McpcfMcpContext {
  return {
    userId: storedSelection.userId,
    oauthProviderId: Option.fromNullishOr(config.userOauthProviderId || null),
    providerUserId: Option.none(),
    accessToken: Option.none(),
    accessTokensByServerId: {},
    upstreamAccessTokensByServerId: {},
    accessTokenIssuer: Option.none(),
    expectedAccessTokenIssuer: Option.fromNullishOr(config.expectedIssuer),
    authMode: Option.none(),
    serverSettingsById: {},
    config: Option.some(config),
    servers,
    upstreamClient: runtimeContext.upstreamClient ?? defaultMcpcfUpstreamClient,
    log: runtimeContext.log,
  }
}

const validateMcpcfHintSelection = Effect.fn("mcp.mcpcf.validateHintSelection")(function* (input: {
  hintServerIds: readonly string[]
  selectedServerIds: readonly string[]
  storedSelectionUserId: Option.Option<string>
}) {
  yield* Effect.succeed(input).pipe(
    Effect.filterOrFail(
      (value) => value.hintServerIds.length === 0 || Option.isSome(value.storedSelectionUserId),
      () => new McpcfMcpRuntimeError({ message: "MCP Context Forge session not found" }),
    ),
    Effect.filterOrFail(
      (value) => value.hintServerIds.length === 0 || value.selectedServerIds.length > 0,
      () =>
        new McpcfMcpRuntimeError({
          message: "MCP Context Forge request did not match any selected session servers",
        }),
    ),
  )
})

export function logMcpcfAuthFailure(input: {
  cause: unknown
  runtimeContext: McpcfMcpRuntimeContext
  sessionId: Option.Option<string>
  servers: readonly McpcfServerRecord[]
}) {
  const authError = toError(input.cause)
  const oauthContext = Match.value(input.cause).pipe(
    Match.when(Match.instanceOf(LinkedOAuthReconnectRequiredError), (error) => error.context),
    Match.orElse(() => undefined),
  )
  input.runtimeContext.log.error(authError, {
    event: "mcp.mcpcf.auth.failed",
    boundary: "auth.mcpcf.runtime_credential",
    mcpcf: {
      sessionId: Option.getOrNull(input.sessionId),
      selectedServerCount: input.servers.length,
      servers: input.servers.map((server) => ({
        id: server.id,
        slug: server.slug,
        label: server.label,
        authType: Option.getOrNull(getMcpcfRuntimeAuthType(server)),
        upstreamAuthType: Option.getOrNull(getMcpcfUpstreamAuthType(server)),
      })),
    },
    auth: {
      mode: Option.getOrNull(getMcpcfRuntimeAuthMode(input.servers)),
    },
    oauth: oauthContext,
    _forceKeep: true,
  })
  return Effect.fail(authError)
}

const resolveMcpcfMcpCredentialsForServers = Effect.fn("mcp.mcpcf.resolveCredentialsForServers")(
  function* (input: {
    env: Env
    config: McpcfConfigRecord
    servers: McpcfServerRecord[]
    storedSelection: { userId: Option.Option<string>; serverIds: string[] }
    runtimeContext: McpcfMcpRuntimeContext
    sessionId: Option.Option<string>
  }) {
    const userId = yield* Option.match(input.storedSelection.userId, {
      onNone: () =>
        Effect.fail(
          new McpcfMcpRuntimeError({
            message: "MCP Context Forge tools require a session owner",
          }),
        ),
      onSome: Effect.succeed,
    })
    return yield* resolveMcpcfRuntimeCredentials({
      env: input.env,
      config: input.config,
      servers: input.servers,
      userId,
      runtimeContext: input.runtimeContext,
    }).pipe(
      Effect.catch((cause) =>
        logMcpcfAuthFailure({
          cause,
          runtimeContext: input.runtimeContext,
          sessionId: input.sessionId,
          servers: input.servers,
        }),
      ),
    )
  },
)

export function unavailableMcpcfServerError(
  servers: readonly McpcfServerRecord[],
  selectedServerIds: readonly string[],
): McpcfMcpRuntimeError {
  const availableIds = new Set(servers.map((server) => server.id))
  const missingIds = selectedServerIds.filter((serverId) => !availableIds.has(serverId))
  return new McpcfMcpRuntimeError({
    message: `Selected MCP Context Forge servers are unavailable: ${missingIds.join(", ")}`,
  })
}

export const resolveMcpcfMcpContextWithConfig = Effect.fn("mcp.mcpcf.resolveContextWithConfig")(
  function* (input: {
    env: Env
    config: McpcfConfigRecord
    storedSelection: { userId: Option.Option<string>; serverIds: string[] }
    selectedServerIds: string[]
    runtimeContext: McpcfMcpRuntimeContext
    sessionId: Option.Option<string>
    registry: ReturnType<typeof createMcpcfRegistryStoreFromEnv>
  }) {
    const servers = yield* Effect.tryPromise({
      try: () => input.registry.listAvailableServersByIds(input.selectedServerIds),
      catch: toError,
    })
    yield* Effect.succeed({ servers, selectedServerIds: input.selectedServerIds }).pipe(
      Effect.filterOrFail(
        ({ servers, selectedServerIds }) =>
          selectedServerIds.length === 0 || servers.length === selectedServerIds.length,
        ({ servers, selectedServerIds }) => unavailableMcpcfServerError(servers, selectedServerIds),
      ),
    )
    return yield* Match.value(servers.length === 0).pipe(
      Match.when(true, () =>
        Effect.succeed(
          emptyMcpcfContext(input.storedSelection, input.config, servers, input.runtimeContext),
        ),
      ),
      Match.orElse(() =>
        resolveMcpcfMcpCredentialsForServers({
          env: input.env,
          config: input.config,
          servers,
          storedSelection: input.storedSelection,
          runtimeContext: input.runtimeContext,
          sessionId: input.sessionId,
        }),
      ),
    )
  },
)

export const resolveMcpcfMcpContext = Effect.fn("mcp.mcpcf.resolveContext")(function* (
  request: Request,
  env: Env,
  runtimeContext: McpcfMcpRuntimeContext,
  authorizedSessionId: string,
) {
  const sessionId = Option.some(authorizedSessionId)
  const storedSelection = yield* mcpcfSelectionFromSession(env, authorizedSessionId)
  const hintServerIds = parseAllowedMcpcfServers(request)
  const hintSet = new Set(hintServerIds)
  const selectedServerIds = Match.value(hintServerIds.length > 0).pipe(
    Match.when(true, () => storedSelection.serverIds.filter((serverId) => hintSet.has(serverId))),
    Match.orElse(() => storedSelection.serverIds),
  )

  yield* validateMcpcfHintSelection({
    hintServerIds,
    selectedServerIds,
    storedSelectionUserId: storedSelection.userId,
  })

  const registry = createMcpcfRegistryStoreFromEnv(env)
  const config = yield* Effect.tryPromise({
    try: () => registry.getConfigOrDefault(),
    catch: toError,
  })
  const configReady = config.enabled && Boolean(config.baseUrl)
  return yield* Match.value(configReady).pipe(
    Match.when(false, () =>
      Match.value(selectedServerIds.length === 0).pipe(
        Match.when(true, () =>
          Effect.succeed(emptyMcpcfContext(storedSelection, config, [], runtimeContext)),
        ),
        Match.orElse(() =>
          Effect.fail(
            new McpcfConfigurationError({ message: "MCP Context Forge is not configured" }),
          ),
        ),
      ),
    ),
    Match.orElse(() =>
      resolveMcpcfMcpContextWithConfig({
        env,
        config,
        storedSelection,
        selectedServerIds,
        runtimeContext,
        sessionId,
        registry,
      }),
    ),
  )
})

const resolveMcpcfGatewayOAuthToken = Effect.fn("mcp.mcpcf.gatewayOAuthToken")(function* (input: {
  env: Env
  config: McpcfConfigRecord
  userId: string
  gatewayOAuthServers: McpcfServerRecord[]
  runtimeContext: McpcfMcpRuntimeContext
}) {
  return yield* Match.value(input.gatewayOAuthServers.length === 0).pipe(
    Match.when(true, () =>
      Effect.succeed(
        Option.none<Effect.Success<ReturnType<typeof getLinkedOAuthAccessTokenForUserId>>>(),
      ),
    ),
    Match.orElse(() =>
      Effect.gen(function* () {
        const providerId = yield* Option.match(
          Option.fromNullishOr(input.config.userOauthProviderId),
          {
            onNone: () =>
              Effect.fail(
                new McpcfConfigurationError({
                  message: "MCP Context Forge user OAuth provider is not configured",
                }),
              ),
            onSome: Effect.succeed,
          },
        )
        const oauthToken = yield* getLinkedOAuthAccessTokenForUserId(input.env, {
          userId: input.userId,
          providerId,
          expectedIssuer: input.config.expectedIssuer,
          log: input.runtimeContext.log,
        })
        return Option.some(oauthToken)
      }),
    ),
  )
})

const resolveMcpcfGatewayAccessToken = Effect.fn("mcp.mcpcf.gatewayAccessToken")(function* (
  env: Env,
  userId: string,
  gatewayTokenServers: McpcfServerRecord[],
) {
  return yield* Option.match(Arr.head(gatewayTokenServers), {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: (firstServer) =>
      Effect.gen(function* () {
        const token = yield* getUserMcpcfGatewayAccessToken(env, { userId, server: firstServer })
        return Option.some(token)
      }),
  })
})

export const resolveMcpcfRuntimeCredentials = Effect.fn("mcp.mcpcf.runtimeCredentials")(
  function* (input: {
    env: Env
    config: McpcfConfigRecord
    servers: McpcfServerRecord[]
    userId: string
    runtimeContext: McpcfMcpRuntimeContext
  }) {
    const { env, config, servers, userId, runtimeContext } = input
    const userConfigStore = createUserMcpcfServerConfigStoreFromD1(env.DB)
    const userConfigs = yield* Effect.tryPromise({
      try: () =>
        userConfigStore.listByUserAndServerIds(
          userId,
          servers.map((server) => server.id),
        ),
      catch: toError,
    })
    const userConfigByServerId = new Map(
      userConfigs.map((userConfig) => [userConfig.serverId, userConfig]),
    )
    const serverSettingsById = Object.fromEntries(
      servers.map((server) => [
        server.id,
        getServerRuntimeSettings(Option.fromNullishOr(userConfigByServerId.get(server.id))),
      ]),
    )
    const gatewayOAuthServers = servers.filter((server) => !usesMcpcfGatewayTokenCredential(server))
    const gatewayTokenServers = servers.filter(usesMcpcfGatewayTokenCredential)

    const oauthToken = yield* resolveMcpcfGatewayOAuthToken({
      env,
      config,
      userId,
      gatewayOAuthServers,
      runtimeContext,
    })
    const gatewayAccessToken = yield* resolveMcpcfGatewayAccessToken(
      env,
      userId,
      gatewayTokenServers,
    )

    const oauthTokenEntries = Option.match(oauthToken, {
      onNone: () => [] as const,
      onSome: (token) =>
        gatewayOAuthServers.map((server) => [server.id, token.accessToken] as const),
    })
    const gatewayTokenEntries = Option.match(gatewayAccessToken, {
      onNone: () => [] as const,
      onSome: (token) => gatewayTokenServers.map((server) => [server.id, token] as const),
    })
    const upstreamTokenEntries = yield* Effect.all(
      servers.filter(usesUserUpstreamTokenCredential).map((server) =>
        getUserMcpcfServerAuthToken(env, {
          userId,
          server,
          userConfig: Option.fromNullishOr(userConfigByServerId.get(server.id)),
        }).pipe(Effect.map((token) => [server.id, token] as const)),
      ),
    )

    const accessTokensByServerId: Record<string, string> = Object.fromEntries([
      ...oauthTokenEntries,
      ...gatewayTokenEntries,
    ])
    const upstreamAccessTokensByServerId: Record<string, string> =
      Object.fromEntries(upstreamTokenEntries)

    const [primaryServer] = servers
    const accessToken = Match.value(servers.length === 1 && Boolean(primaryServer)).pipe(
      Match.when(true, () =>
        Option.fromNullishOr(primaryServer && accessTokensByServerId[primaryServer.id]),
      ),
      Match.orElse(() =>
        Option.flatMap(oauthToken, (token) => Option.fromNullishOr(token.accessToken)),
      ),
    )
    return {
      userId: Option.some(userId),
      oauthProviderId: Option.flatMap(oauthToken, (token) =>
        Option.fromNullishOr(token.providerId),
      ),
      providerUserId: Option.flatMap(oauthToken, (token) =>
        Option.fromNullishOr(token.providerUserId),
      ),
      accessToken,
      accessTokensByServerId,
      upstreamAccessTokensByServerId,
      accessTokenIssuer: Option.flatMap(oauthToken, (token) =>
        Option.fromNullishOr(token.accessTokenIssuer),
      ),
      expectedAccessTokenIssuer: Option.flatMap(oauthToken, (token) =>
        Option.fromNullishOr(token.expectedAccessTokenIssuer),
      ),
      authMode: getMcpcfRuntimeAuthMode(servers),
      serverSettingsById,
      config: Option.some(config),
      servers,
      upstreamClient: runtimeContext.upstreamClient ?? defaultMcpcfUpstreamClient,
      log: runtimeContext.log,
    } satisfies McpcfMcpContext
  },
)
