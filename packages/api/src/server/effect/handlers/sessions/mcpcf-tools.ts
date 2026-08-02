import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { ApiEnv } from "infra/types/env"
import type {
  McpcfContextForgeTokenSettingsPayload,
  McpcfServerParams,
  McpcfUserServerSettingsPayload,
  McpcfUserSettingsListQuery,
} from "@c0/api"
import { McpcfRegistryStore } from "../../../background/db/mcpcf"
import type { GlobalSecretsStore } from "../../../background/db/repo-secrets"
import {
  getUserMcpcfAuthTokenSecretKey,
  getUserMcpcfGatewayApiTokenSecretKey,
  UserMcpcfServerConfigStore,
  type UserMcpcfServerConfigRecord,
} from "../../../background/db/user-mcpcf"
import {
  formatMcpcfAuthLabel,
  formatMcpcfUpstreamAuthLabel,
  getMcpcfServerDescription,
  getMcpcfServerDisplayLabel,
  isMcpcfGatewayTokenAuthType,
  isMcpcfUserTokenAuthType,
  normalizeMcpcfAuthType,
  normalizeMcpcfUpstreamAuthType,
  type McpcfToolPreview,
} from "../../../background/mcpcf/metadata"
import {
  ControlPlaneFailure,
  failUnless,
  failWhen,
  json,
  requireGlobalSecretsStore,
  requireOption,
  resolvePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

type McpcfServerForSettings = Effect.Success<
  ReturnType<McpcfRegistryStore["listAvailableServers"]>
>[number]

type McpcfConfig = Effect.Success<ReturnType<McpcfRegistryStore["getConfigOrDefault"]>>

const optionalField = <const K extends string, V>(key: K, value: V | null | undefined) =>
  Option.match(Option.fromNullishOr(value), {
    onNone: () => ({}) as Partial<Record<K, V>>,
    onSome: (resolved) => ({ [key]: resolved }) as Partial<Record<K, V>>,
  })

const failResponseWhen = Effect.fn("sessions.mcpcf.failResponseWhen")(function* (
  condition: boolean,
  payload: unknown,
  status: number,
) {
  const failure = Effect.fail(new ControlPlaneFailure({ payload, status }))
  const guard = Effect.succeed(condition)
  yield* Effect.when(failure, guard)
})

const listUserSecretKeys = Effect.fn("sessions.mcpcf.listUserSecretKeys")(function* (
  env: ApiEnv,
  userId: string,
) {
  const secretsStore = requireGlobalSecretsStore(env)
  const keys = yield* Option.match(secretsStore, {
    onNone: () => Effect.succeed<readonly string[]>([]),
    onSome: (store) => store.listSecretKeys({ userId, includeMcpcfManaged: true }),
  })
  return new Set(keys)
})

const resolveOauthConfigured = Effect.fn("sessions.mcpcf.resolveOauthConfigured")(function* (
  env: ApiEnv,
  userId: string,
  providerId: string | null | undefined,
) {
  const provider = Option.fromNullishOr(providerId).pipe(Option.filter((id) => id.length > 0))
  return yield* Option.match(provider, {
    onNone: () => Effect.succeed(false),
    onSome: (resolvedProviderId) =>
      Effect.tryPromise(() =>
        hasLinkedOAuthAccount({ env, userId, providerId: resolvedProviderId }),
      ),
  })
})

function normalizeServerAuthType(server: McpcfServerForSettings) {
  return server.authType ?? normalizeMcpcfAuthType(server.rawMetadata)
}

function normalizeServerUpstreamAuthType(server: McpcfServerForSettings) {
  return normalizeMcpcfUpstreamAuthType(server.rawMetadata)
}

function formatTools(tools: readonly McpcfToolPreview[]) {
  return tools.map((tool) => ({
    name: tool.name,
    ...optionalField("description", tool.description),
  }))
}

async function hasLinkedOAuthAccount(input: {
  env: { DB: D1Database }
  userId: string
  providerId: string
}): Promise<boolean> {
  const row = await input.env.DB.prepare(
    `SELECT "id"
       FROM "account"
       WHERE "providerId" = ?1 AND "userId" = ?2
       LIMIT 1`,
  )
    .bind(input.providerId, input.userId)
    .first<{ id: string }>()
  return Boolean(row)
}

function buildAdminUrl(trimmedBaseUrl: string): string {
  const url = new URL(trimmedBaseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/admin`
  url.search = ""
  url.searchParams.set("view", "tokens")
  return url.toString()
}

function getContextForgeApiKeysUrl(baseUrl: string | null | undefined) {
  const trimmed = Option.fromNullishOr(baseUrl?.trim()).pipe(
    Option.filter((value) => value.length > 0),
  )
  return Option.match(trimmed, {
    onNone: () => null,
    onSome: (trimmedBaseUrl) =>
      Match.value(URL.canParse(trimmedBaseUrl)).pipe(
        Match.when(true, () => buildAdminUrl(trimmedBaseUrl)),
        Match.orElse(() => `${trimmedBaseUrl.replace(/\/+$/, "")}/admin?view=tokens`),
      ),
  })
}

function getTokenAuthServerCount(servers: readonly McpcfServerForSettings[]): number {
  return servers.filter((server) => isMcpcfGatewayTokenAuthType(normalizeServerAuthType(server)))
    .length
}

function formatContextForgeTokenSettings(input: {
  contextForgeUrl: string | null
  contextForgeApiKeysUrl: string | null
  tokenAuthServerCount: number
  userSecretKeys: Set<string>
}) {
  return {
    configured: input.userSecretKeys.has(getUserMcpcfGatewayApiTokenSecretKey()),
    tokenAuthServerCount: input.tokenAuthServerCount,
    ...optionalField("contextForgeUrl", input.contextForgeUrl),
    ...optionalField("contextForgeApiKeysUrl", input.contextForgeApiKeysUrl),
  }
}

function formatUserServerSettings(input: {
  server: McpcfServerForSettings
  contextForgeUrl: string | null
  contextForgeApiKeysUrl: string | null
  oauthProviderId: string | null
  oauthConfigured: boolean
  userConfig: UserMcpcfServerConfigRecord | null
  userSecretKeys: Set<string>
}) {
  const authType = normalizeServerAuthType(input.server)
  const upstreamAuthType = normalizeServerUpstreamAuthType(input.server)
  const gatewayAuthTokenRequired = isMcpcfGatewayTokenAuthType(authType)
  const gatewayAuthTokenConfigured =
    gatewayAuthTokenRequired && input.userSecretKeys.has(getUserMcpcfGatewayApiTokenSecretKey())
  const upstreamAuthTokenRequired = isMcpcfUserTokenAuthType(upstreamAuthType)
  const defaultTokenSecretKey = getUserMcpcfAuthTokenSecretKey(input.server.id)
  const authTokenSecretKey = input.userConfig?.authTokenSecretKey ?? defaultTokenSecretKey
  const upstreamAuthTokenConfigured =
    upstreamAuthTokenRequired && input.userSecretKeys.has(authTokenSecretKey)
  const authTokenRequired = gatewayAuthTokenRequired || upstreamAuthTokenRequired
  const authTokenConfigured =
    authTokenRequired &&
    (!gatewayAuthTokenRequired || gatewayAuthTokenConfigured) &&
    (!upstreamAuthTokenRequired || upstreamAuthTokenConfigured)
  const gatewayConfiguredForUser =
    (gatewayAuthTokenRequired && gatewayAuthTokenConfigured) ||
    (!gatewayAuthTokenRequired && authType === "oauth" && input.oauthConfigured) ||
    (!gatewayAuthTokenRequired && authType !== "oauth")
  const configuredForUser =
    gatewayConfiguredForUser && (!upstreamAuthTokenRequired || upstreamAuthTokenConfigured)
  const toolNames = new Set(input.server.tools.map((tool) => tool.name))
  const disabledTools = (input.userConfig?.disabledTools ?? []).filter((toolName) =>
    toolNames.has(toolName),
  )

  return {
    id: input.server.id,
    slug: input.server.slug,
    label: getMcpcfServerDisplayLabel(input.server),
    description: getMcpcfServerDescription(input.server),
    authType,
    authLabel: formatMcpcfAuthLabel({
      authType,
      oauthProviderId: input.oauthProviderId ?? undefined,
    }),
    gatewayAuthType: authType,
    gatewayAuthLabel: formatMcpcfAuthLabel({
      authType,
      oauthProviderId: input.oauthProviderId ?? undefined,
    }),
    upstreamAuthType,
    upstreamAuthLabel: formatMcpcfUpstreamAuthLabel(upstreamAuthType),
    gatewayAuthTokenRequired,
    gatewayAuthTokenConfigured,
    upstreamAuthTokenRequired,
    upstreamAuthTokenConfigured,
    authTokenRequired,
    authTokenConfigured,
    configuredForUser,
    ...optionalField("contextForgeUrl", input.contextForgeUrl),
    ...optionalField("contextForgeApiKeysUrl", input.contextForgeApiKeysUrl),
    toolCount: input.server.toolCount,
    defaultToolsEnabled: input.userConfig?.defaultToolsEnabled ?? true,
    disabledTools,
    tools: formatTools(input.server.tools),
  }
}

function formatServerSummary(input: {
  server: McpcfServerForSettings
  config: McpcfConfig
  contextForgeUrl: string | null
  contextForgeApiKeysUrl: string | null
  oauthConfigured: boolean
  userConfig: UserMcpcfServerConfigRecord | null
  userSecretKeys: Set<string>
}) {
  const authType = input.server.authType ?? normalizeMcpcfAuthType(input.server.rawMetadata)
  const upstreamAuthType = normalizeMcpcfUpstreamAuthType(input.server.rawMetadata)
  const settings = formatUserServerSettings({
    server: input.server,
    contextForgeUrl: input.contextForgeUrl,
    contextForgeApiKeysUrl: input.contextForgeApiKeysUrl,
    oauthProviderId: input.config.userOauthProviderId || null,
    oauthConfigured: input.oauthConfigured,
    userConfig: input.userConfig,
    userSecretKeys: input.userSecretKeys,
  })
  const authLabel = formatMcpcfAuthLabel({
    authType,
    oauthProviderId: input.config.userOauthProviderId,
  })
  return {
    id: input.server.id,
    slug: input.server.slug,
    label: getMcpcfServerDisplayLabel(input.server),
    description: getMcpcfServerDescription(input.server),
    authType,
    authLabel,
    gatewayAuthType: authType,
    gatewayAuthLabel: authLabel,
    upstreamAuthType,
    upstreamAuthLabel: formatMcpcfUpstreamAuthLabel(upstreamAuthType),
    gatewayAuthTokenRequired: settings.gatewayAuthTokenRequired,
    gatewayAuthTokenConfigured: settings.gatewayAuthTokenConfigured,
    upstreamAuthTokenRequired: settings.upstreamAuthTokenRequired,
    upstreamAuthTokenConfigured: settings.upstreamAuthTokenConfigured,
    configuredForUser: settings.configuredForUser,
    ...optionalField("contextForgeUrl", settings.contextForgeUrl),
    ...optionalField("contextForgeApiKeysUrl", settings.contextForgeApiKeysUrl),
    toolCount: input.server.toolCount,
  }
}

export function mcpcfServers() {
  return runControlPlane(
    Effect.fn("sessions.mcpcfServers")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing user context",
        401,
      )

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failResponseWhen(!config.enabled || !config.baseUrl, { servers: [] }, 200)

      const servers = yield* registry.listAvailableServers()
      const serverIds = servers.map((server) => server.id)
      const userConfigs = yield* new UserMcpcfServerConfigStore(env.DB).listByUserAndServerIds(
        userId,
        serverIds,
      )
      const userConfigByServerId = new Map(
        userConfigs.map((userConfig) => [userConfig.serverId, userConfig]),
      )
      const userSecretKeys = yield* listUserSecretKeys(env, userId)
      const oauthConfigured = yield* resolveOauthConfigured(env, userId, config.userOauthProviderId)
      const contextForgeUrl = config.baseUrl.trim()
      const contextForgeApiKeysUrl = getContextForgeApiKeysUrl(contextForgeUrl)

      return json({
        servers: servers.map((server) =>
          formatServerSummary({
            server,
            config,
            contextForgeUrl,
            contextForgeApiKeysUrl,
            oauthConfigured,
            userConfig: userConfigByServerId.get(server.id) ?? null,
            userSecretKeys,
          }),
        ),
      })
    }),
  )
}

export function mcpcfTools({ params }: { params: McpcfServerParams }) {
  return runControlPlane(
    Effect.fn("sessions.mcpcfTools")(function* ({ request, env, principal }) {
      yield* requireOption(resolvePrincipalUserId(request, principal), "Missing user context", 401)

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failUnless(
        Boolean(config.enabled && config.baseUrl),
        "MCP Context Forge is not configured",
        404,
      )

      const serverRecord = yield* registry.getServer(params.serverId)
      const server = yield* requireOption(
        serverRecord.pipe(
          Option.filter((value) => Boolean(value.enabled) && value.sourceStatus === "active"),
        ),
        "MCP Context Forge server is not available",
        404,
      )

      return json({
        tools: server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      })
    }),
  )
}

type FormattedUserServerSettings = ReturnType<typeof formatUserServerSettings>

type McpcfUserSettingsSortKey = "label" | "auth" | "configured" | "tools" | "defaultTools"

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Match.value(Number.isFinite(parsed) && parsed > 0).pipe(
    Match.when(true, () => Math.min(parsed, max)),
    Match.orElse(() => fallback),
  )
}

function parseNonNegativeInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Match.value(Number.isFinite(parsed) && parsed >= 0).pipe(
    Match.when(true, () => parsed),
    Match.orElse(() => 0),
  )
}

function resolveSortDir(value: string | undefined): "asc" | "desc" {
  return Match.value(value?.trim().toLowerCase() === "desc").pipe(
    Match.when(true, () => "desc" as const),
    Match.orElse(() => "asc" as const),
  )
}

function authTypeLabel(server: FormattedUserServerSettings): string {
  return (
    server.gatewayAuthLabel ??
    server.authLabel ??
    server.gatewayAuthType ??
    server.authType ??
    "Unknown"
  )
}

function gatewayAuthType(server: FormattedUserServerSettings): string {
  return (server.gatewayAuthType ?? server.authType ?? "").toLowerCase()
}

function oauthStatusLabel(server: FormattedUserServerSettings): string {
  return Match.value(server.configuredForUser).pipe(
    Match.when(true, () => "Linked"),
    Match.orElse(() => "Not linked"),
  )
}

function configuredStatusLabel(server: FormattedUserServerSettings): string {
  return Match.value(true).pipe(
    Match.when(
      () => server.gatewayAuthTokenRequired && !server.gatewayAuthTokenConfigured,
      () => "API token needed",
    ),
    Match.when(
      () => server.upstreamAuthTokenRequired && !server.upstreamAuthTokenConfigured,
      () => "Token needed",
    ),
    Match.when(
      () => gatewayAuthType(server) === "oauth",
      () => oauthStatusLabel(server),
    ),
    Match.when(
      () => server.configuredForUser,
      () => "Configured",
    ),
    Match.orElse(() => "Unavailable"),
  )
}

function activeToolCount(server: FormattedUserServerSettings): number {
  return Match.value(server.defaultToolsEnabled).pipe(
    Match.when(false, () => 0),
    Match.orElse(() => Math.max(0, server.toolCount - server.disabledTools.length)),
  )
}

function authFilterValue(server: FormattedUserServerSettings): string {
  const authLabel = authTypeLabel(server).toLowerCase()
  const authType = gatewayAuthType(server)
  return Match.value(true).pipe(
    Match.when(
      () => authType === "token" || authLabel.includes("token"),
      () => "token",
    ),
    Match.when(
      () => authType === "oauth" || authLabel.includes("oauth"),
      () => "oauth",
    ),
    Match.orElse(() => "other"),
  )
}

function searchableText(server: FormattedUserServerSettings): string {
  return [
    server.label,
    server.slug,
    server.description,
    authTypeLabel(server),
    configuredStatusLabel(server),
    ...server.tools.flatMap((tool) => [tool.name, tool.description ?? ""]),
  ]
    .join(" ")
    .toLowerCase()
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" })
}

function compareNumbers(left: number, right: number): number {
  return Math.sign(left - right)
}

function resolveMcpcfUserSettingsSortKey(value: string | undefined): McpcfUserSettingsSortKey {
  return Match.value(value).pipe(
    Match.when("auth", () => "auth" as const),
    Match.when("configured", () => "configured" as const),
    Match.when("tools", () => "tools" as const),
    Match.when("defaultTools", () => "defaultTools" as const),
    Match.orElse(() => "label" as const),
  )
}

function compareBySortKey(
  left: FormattedUserServerSettings,
  right: FormattedUserServerSettings,
  sortBy: McpcfUserSettingsSortKey,
): number {
  return Match.value(sortBy).pipe(
    Match.when("auth", () => compareStrings(authTypeLabel(left), authTypeLabel(right))),
    Match.when("configured", () =>
      compareNumbers(Number(left.configuredForUser), Number(right.configuredForUser)),
    ),
    Match.when("tools", () => compareNumbers(activeToolCount(left), activeToolCount(right))),
    Match.when("defaultTools", () =>
      compareNumbers(Number(left.defaultToolsEnabled), Number(right.defaultToolsEnabled)),
    ),
    Match.orElse(() => compareStrings(left.label, right.label)),
  )
}

function applySortDir(result: number, sortDir: "asc" | "desc"): number {
  return Match.value(sortDir).pipe(
    Match.when("asc", () => result),
    Match.orElse(() => -result),
  )
}

function compareServers(
  left: FormattedUserServerSettings,
  right: FormattedUserServerSettings,
  sortBy: McpcfUserSettingsSortKey,
  sortDir: "asc" | "desc",
): number {
  const primary =
    compareBySortKey(left, right, sortBy) ||
    compareStrings(left.label, right.label) ||
    compareStrings(left.id, right.id)
  return applySortDir(primary, sortDir)
}

function sortMcpcfUserSettings(
  servers: FormattedUserServerSettings[],
  sortBy: McpcfUserSettingsSortKey,
  sortDir: "asc" | "desc",
): FormattedUserServerSettings[] {
  return [...servers].sort((left, right) => compareServers(left, right, sortBy, sortDir))
}

function matchesMcpcfUserSettings(
  server: FormattedUserServerSettings,
  filters: {
    normalizedQuery: string
    authFilter: string
    configuredFilter: string
    defaultToolsFilter: string
  },
): boolean {
  return (
    !(
      filters.normalizedQuery !== "" && !searchableText(server).includes(filters.normalizedQuery)
    ) &&
    !(filters.authFilter !== "" && authFilterValue(server) !== filters.authFilter) &&
    !(filters.configuredFilter === "configured" && !server.configuredForUser) &&
    !(filters.configuredFilter === "needs_config" && server.configuredForUser) &&
    !(filters.defaultToolsFilter === "enabled" && !server.defaultToolsEnabled) &&
    !(filters.defaultToolsFilter === "disabled" && server.defaultToolsEnabled)
  )
}

function filterMcpcfUserSettings(
  servers: FormattedUserServerSettings[],
  query: McpcfUserSettingsListQuery,
): FormattedUserServerSettings[] {
  const filters = {
    normalizedQuery: query.q?.trim().toLowerCase() ?? "",
    authFilter: query.auth?.trim().toLowerCase() ?? "",
    configuredFilter: query.configured?.trim().toLowerCase() ?? "",
    defaultToolsFilter: query.defaultTools?.trim().toLowerCase() ?? "",
  }
  return servers.filter((server) => matchesMcpcfUserSettings(server, filters))
}

export function mcpcfSettings({ query }: { query: McpcfUserSettingsListQuery }) {
  return runControlPlane(
    Effect.fn("sessions.mcpcfSettings")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing user context",
        401,
      )

      const limit = parsePositiveInt(query.limit, 10, 100)
      const offset = parseNonNegativeInt(query.offset)
      const sortBy = resolveMcpcfUserSettingsSortKey(query.sortBy)
      const sortDir = resolveSortDir(query.sortDir)

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failResponseWhen(
        !config.enabled || !config.baseUrl,
        { servers: [], total: 0, limit, offset },
        200,
      )

      const servers = yield* registry.listAvailableServers()
      const contextForgeUrl = config.baseUrl.trim()
      const contextForgeApiKeysUrl = getContextForgeApiKeysUrl(contextForgeUrl)
      const serverIds = servers.map((server) => server.id)
      const userConfigs = yield* new UserMcpcfServerConfigStore(env.DB).listByUserAndServerIds(
        userId,
        serverIds,
      )
      const userConfigByServerId = new Map(
        userConfigs.map((userConfig) => [userConfig.serverId, userConfig]),
      )
      const userSecretKeys = yield* listUserSecretKeys(env, userId)
      const oauthConfigured = yield* resolveOauthConfigured(env, userId, config.userOauthProviderId)

      const formattedServers = servers.map((server) =>
        formatUserServerSettings({
          server,
          contextForgeUrl,
          contextForgeApiKeysUrl,
          oauthProviderId: config.userOauthProviderId || null,
          oauthConfigured,
          userConfig: userConfigByServerId.get(server.id) ?? null,
          userSecretKeys,
        }),
      )
      const filteredServers = filterMcpcfUserSettings(formattedServers, query)
      const sortedServers = sortMcpcfUserSettings(filteredServers, sortBy, sortDir)
      const total = sortedServers.length

      return json({
        servers: sortedServers.slice(offset, offset + limit),
        total,
        limit,
        offset,
      })
    }),
  )
}

export function mcpcfContextForgeTokenSettings() {
  return runControlPlane(
    Effect.fn("sessions.mcpcfContextForgeTokenSettings")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing user context",
        401,
      )

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failResponseWhen(
        !config.enabled || !config.baseUrl,
        { configured: false, tokenAuthServerCount: 0 },
        200,
      )

      const userSecretKeys = yield* listUserSecretKeys(env, userId)
      const contextForgeUrl = config.baseUrl.trim()
      const contextForgeApiKeysUrl = getContextForgeApiKeysUrl(contextForgeUrl)
      const servers = yield* registry.listAvailableServers()

      return json(
        formatContextForgeTokenSettings({
          contextForgeUrl,
          contextForgeApiKeysUrl,
          tokenAuthServerCount: getTokenAuthServerCount(servers),
          userSecretKeys,
        }),
      )
    }),
  )
}

const writeContextForgeToken = Effect.fn("sessions.mcpcf.writeContextForgeToken")(function* (
  store: GlobalSecretsStore,
  token: Option.Option<string>,
  clearToken: boolean,
  userId: string,
) {
  const gatewayKey = getUserMcpcfGatewayApiTokenSecretKey()
  const deletion = store.deleteSecret(gatewayKey, { userId })
  const clearGuard = Effect.succeed(clearToken)
  yield* Option.match(token, {
    onNone: () => Effect.when(deletion, clearGuard),
    onSome: (resolvedToken) => store.setSecrets({ [gatewayKey]: resolvedToken }, { userId }),
  })
})

export function updateMcpcfContextForgeTokenSettings({
  payload,
}: {
  payload: McpcfContextForgeTokenSettingsPayload
}) {
  return runControlPlane(
    Effect.fn("sessions.updateMcpcfContextForgeTokenSettings")(function* ({
      request,
      env,
      principal,
    }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing user context",
        401,
      )

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failUnless(
        Boolean(config.enabled && config.baseUrl),
        "MCP Context Forge is not configured",
        404,
      )

      const token = Option.fromNullishOr(payload.token?.trim()).pipe(
        Option.filter((value) => value.length > 0),
      )
      const clearToken = payload.clearToken ?? false
      const shouldWriteSecret = Option.isSome(token) || clearToken
      const writeStore = requireGlobalSecretsStore(env)
      yield* failWhen(
        shouldWriteSecret && Option.isNone(writeStore),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )

      yield* Option.match(writeStore, {
        onNone: () => Effect.void,
        onSome: (store) => writeContextForgeToken(store, token, clearToken, userId),
      })

      const userSecretKeys = yield* listUserSecretKeys(env, userId)
      const contextForgeUrl = config.baseUrl.trim()
      const contextForgeApiKeysUrl = getContextForgeApiKeysUrl(contextForgeUrl)
      const servers = yield* registry.listAvailableServers()

      return json(
        formatContextForgeTokenSettings({
          contextForgeUrl,
          contextForgeApiKeysUrl,
          tokenAuthServerCount: getTokenAuthServerCount(servers),
          userSecretKeys,
        }),
      )
    }),
  )
}

const writeUpstreamAuthToken = Effect.fn("sessions.mcpcf.writeUpstreamAuthToken")(function* (
  store: Option.Option<GlobalSecretsStore>,
  serverId: string,
  token: string,
  userId: string,
) {
  const authTokenSecretKey = getUserMcpcfAuthTokenSecretKey(serverId)
  yield* Option.match(store, {
    onNone: () => Effect.void,
    onSome: (resolvedStore) =>
      resolvedStore.setSecrets({ [authTokenSecretKey]: token }, { userId }),
  })
  return authTokenSecretKey
})

const deleteSecretIfPresent = Effect.fn("sessions.mcpcf.deleteSecretIfPresent")(function* (
  store: Option.Option<GlobalSecretsStore>,
  key: string,
  userId: string,
) {
  yield* Option.match(store, {
    onNone: () => Effect.void,
    onSome: (resolvedStore) => resolvedStore.deleteSecret(key, { userId }),
  })
})

const clearUpstreamAuthToken = Effect.fn("sessions.mcpcf.clearUpstreamAuthToken")(function* (
  store: Option.Option<GlobalSecretsStore>,
  shouldClear: boolean,
  existingKey: string | null,
  userId: string,
) {
  const keyOption = Option.fromNullishOr(existingKey).pipe(Option.filter(() => shouldClear))
  yield* Option.match(keyOption, {
    onNone: () => Effect.void,
    onSome: (key) => deleteSecretIfPresent(store, key, userId),
  })
  return Option.match(keyOption, {
    onNone: () => existingKey,
    onSome: () => null,
  })
})

const resolveAuthTokenSecretKey = Effect.fn("sessions.mcpcf.resolveAuthTokenSecretKey")(
  function* (input: {
    store: Option.Option<GlobalSecretsStore>
    serverId: string
    authToken: Option.Option<string>
    shouldClear: boolean
    existingKey: string | null
    userId: string
  }) {
    return yield* Option.match(input.authToken, {
      onSome: (token) => writeUpstreamAuthToken(input.store, input.serverId, token, input.userId),
      onNone: () =>
        clearUpstreamAuthToken(input.store, input.shouldClear, input.existingKey, input.userId),
    })
  },
)

function resolveDisabledTools(
  requested: readonly string[] | undefined,
  toolNames: Set<string>,
  existing: readonly string[] | undefined,
) {
  return Option.match(Option.fromNullishOr(requested), {
    onNone: () => existing,
    onSome: (tools) => tools.filter((toolName) => toolNames.has(toolName)),
  })
}

export function updateMcpcfSettings({
  params,
  payload,
}: {
  params: McpcfServerParams
  payload: McpcfUserServerSettingsPayload
}) {
  return runControlPlane(
    Effect.fn("sessions.updateMcpcfSettings")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing user context",
        401,
      )

      const registry = new McpcfRegistryStore(env)
      const config = yield* registry.getConfigOrDefault()
      yield* failUnless(
        Boolean(config.enabled && config.baseUrl),
        "MCP Context Forge is not configured",
        404,
      )

      const serverRecord = yield* registry.getServer(params.serverId)
      const server = yield* requireOption(
        serverRecord.pipe(
          Option.filter((value) => Boolean(value.enabled) && value.sourceStatus === "active"),
        ),
        "MCP Context Forge server is not available",
        404,
      )

      const upstreamAuthType = normalizeServerUpstreamAuthType(server)
      const upstreamAuthTokenRequired = isMcpcfUserTokenAuthType(upstreamAuthType)
      const authToken = Option.fromNullishOr(payload.authToken?.trim()).pipe(
        Option.filter((value) => value.length > 0),
      )
      yield* failWhen(
        Option.isSome(authToken) && !upstreamAuthTokenRequired,
        "This MCP server does not accept a user upstream token",
        400,
      )

      const userConfigStore = new UserMcpcfServerConfigStore(env.DB)
      const existing = yield* userConfigStore.get(userId, server.id)
      const existingKey = Option.getOrNull(
        Option.flatMap(existing, (record) => Option.fromNullishOr(record.authTokenSecretKey)),
      )
      const shouldClear = Boolean(payload.clearAuthToken)
      const shouldClearUpstream = shouldClear && Boolean(existingKey)
      const secretsStoreNeeded = Option.isSome(authToken) || shouldClearUpstream
      const writeStore = requireGlobalSecretsStore(env)
      yield* failWhen(
        secretsStoreNeeded && Option.isNone(writeStore),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )

      const authTokenSecretKey = yield* resolveAuthTokenSecretKey({
        store: writeStore,
        serverId: server.id,
        authToken,
        shouldClear,
        existingKey,
        userId,
      })

      const toolNames = new Set(server.tools.map((tool) => tool.name))
      const disabledTools = resolveDisabledTools(
        payload.disabledTools,
        toolNames,
        Option.getOrUndefined(Option.map(existing, (record) => record.disabledTools)),
      )

      const updated = yield* userConfigStore.upsert({
        userId,
        serverId: server.id,
        authTokenSecretKey,
        defaultToolsEnabled: payload.defaultToolsEnabled,
        disabledTools,
      })

      const userSecretKeys = yield* listUserSecretKeys(env, userId)
      const oauthConfigured = yield* resolveOauthConfigured(env, userId, config.userOauthProviderId)
      const contextForgeUrl = config.baseUrl.trim()
      const contextForgeApiKeysUrl = getContextForgeApiKeysUrl(contextForgeUrl)

      return json({
        server: formatUserServerSettings({
          server,
          contextForgeUrl,
          contextForgeApiKeysUrl,
          oauthProviderId: config.userOauthProviderId || null,
          oauthConfigured,
          userConfig: updated,
          userSecretKeys,
        }),
      })
    }),
  )
}
