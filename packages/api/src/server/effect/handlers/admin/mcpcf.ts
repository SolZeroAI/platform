import type { AdminMcpcfConfigPayload } from "@c0/api"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { C0_CONFIG_KEYS, C0ConfigStore } from "../../../background/db/c0-config"
import {
  McpcfRegistryStore,
  type McpcfAdminApiTokenPresence,
  type McpcfConfigRecord,
  type McpcfConfigPresence,
  type McpcfServerRecord,
} from "../../../background/db/mcpcf"
import { exportMcpcfConfig, resetMcpcfConfig } from "../../../background/mcpcf/admin-actions"
import {
  getMcpcfServerDescription,
  getMcpcfServerDisplayLabel,
  normalizeMcpcfAuthType,
} from "../../../background/mcpcf/metadata"
import { EffectRequestLogger } from "../../services/observability"
import {
  describeError,
  failMessage,
  failUnless,
  failWhen,
  json,
  requireOption,
  type ControlPlaneContext,
} from "../shared/control-plane"

interface AdminIdentity {
  userId: string
  email: string
}

function formatMcpcfConfig(input: {
  configPresence: McpcfConfigPresence
  adminApiTokenStatus: McpcfAdminApiTokenPresence
}) {
  const { adminApiTokenStatus, configPresence } = input
  const config = configPresence.config
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    userOauthProviderId: config.userOauthProviderId,
    expectedIssuer: config.expectedIssuer,
    authTypeAllowlist: config.authTypeAllowlist,
    serverBlacklist: config.serverBlacklist,
    source: configPresence.source,
    locked: configPresence.locked,
    envVarName: configPresence.envVarName,
    adminApiTokenConfigured: adminApiTokenStatus.configured,
    adminApiTokenSource: adminApiTokenStatus.source,
    adminApiTokenLocked: adminApiTokenStatus.locked,
    adminApiTokenEnvVarName: adminApiTokenStatus.envVarName,
    updatedAt: config.updatedAt || null,
  }
}

function formatMcpcfServer(server: McpcfServerRecord) {
  return {
    id: server.id,
    slug: server.slug,
    label: getMcpcfServerDisplayLabel(server),
    description: getMcpcfServerDescription(server),
    authType: server.authType ?? normalizeMcpcfAuthType(server.rawMetadata),
    toolCount: server.toolCount,
    sourceStatus: server.sourceStatus,
    filterReason: server.filterReason,
    enabled: server.enabled,
    firstSeenAt: server.firstSeenAt,
    lastSeenAt: server.lastSeenAt,
    verifiedAt: server.verifiedAt,
    updatedAt: server.updatedAt,
  }
}

export const getMcpcfAdminResponse = Effect.fn("admin.getMcpcfAdminResponse")(function* (
  context: ControlPlaneContext,
) {
  const registry = new McpcfRegistryStore(context.env)
  const [configPresence, adminApiTokenStatus, registryPresence, servers] = yield* Effect.all(
    [
      registry.getConfigWithPresence(),
      registry.getAdminApiTokenStatus(),
      registry.getServerIndexWithPresence(),
      registry.listServers(),
    ],
    { concurrency: "unbounded" },
  )
  return {
    config: formatMcpcfConfig({ configPresence, adminApiTokenStatus }),
    servers: servers.map(formatMcpcfServer),
    registrySource: registryPresence.source,
    registryLocked: registryPresence.locked,
    registryEnvVarName: registryPresence.envVarName,
  }
})

export const performUpdateMcpcfConfig = Effect.fn("admin.performUpdateMcpcfConfig")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
  payload: AdminMcpcfConfigPayload,
) {
  const token = payload.adminApiToken?.trim()
  const registry = new McpcfRegistryStore(context.env)
  const tokenStatus = yield* registry.getAdminApiTokenStatus()
  yield* failWhen(
    Boolean(token) && tokenStatus.locked,
    `MCP Context Forge admin API token is managed by ${tokenStatus.envVarName ?? "environment"}; remove the env var to edit it in Admin`,
    400,
  )
  yield* failWhen(
    Boolean(token) && !context.env.REPO_SECRETS_ENCRYPTION_KEY,
    "Global secret encryption is not configured",
    500,
  )

  const config = yield* registry
    .upsertConfig({
      enabled: payload.enabled,
      baseUrl: payload.baseUrl,
      userOauthProviderId: payload.userOauthProviderId,
      expectedIssuer: payload.expectedIssuer,
      authTypeAllowlist: payload.authTypeAllowlist ?? [],
      serverBlacklist: payload.serverBlacklist ?? [],
    })
    .pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))

  const c0Config = new C0ConfigStore(context.env.C0_CONFIG, context.env.REPO_SECRETS_ENCRYPTION_KEY)
  const tokenGuard = Effect.succeed(Boolean(token))
  yield* Effect.when(
    c0Config.setEncryptedSecret(C0_CONFIG_KEYS.mcpcf.adminApiToken, token ?? ""),
    tokenGuard,
  )

  const log = yield* EffectRequestLogger
  yield* log.emit({
    event: "admin.mcpcf.config.updated",
    boundary: "admin.mcpcf.config",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    mcpcf: {
      enabled: config.enabled,
      hasBaseUrl: Boolean(config.baseUrl),
      userOauthProviderId: config.userOauthProviderId || null,
      expectedIssuerConfigured: Boolean(config.expectedIssuer),
      authTypeAllowlistCount: config.authTypeAllowlist.length,
      serverBlacklistCount: config.serverBlacklist.length,
      adminApiTokenUpdated: Boolean(token),
    },
  })

  const data = yield* getMcpcfAdminResponse(context)
  return json(data)
})

export const performExportMcpcfConfig = Effect.fn("admin.performExportMcpcfConfig")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
) {
  const result = yield* exportMcpcfConfig(context.env).pipe(
    Effect.catch((cause) => failMessage(describeError(cause), 500)),
  )
  const log = yield* EffectRequestLogger
  yield* log.emit({
    event: "admin.mcpcf.config.exported",
    boundary: "admin.mcpcf.config.export",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    mcpcf: {
      variableCount: result.variableCount,
      includesSecret: result.includesSecret,
      includesRegistry: result.includesRegistry,
      serverCount: result.serverCount,
    },
  })
  return json(result)
})

export const performResetMcpcfConfig = Effect.fn("admin.performResetMcpcfConfig")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
) {
  const result = yield* resetMcpcfConfig(context.env).pipe(
    Effect.catch((cause) => failMessage(describeError(cause), 500)),
  )
  const log = yield* EffectRequestLogger
  yield* log.emit({
    event: "admin.mcpcf.config.reset",
    boundary: "admin.mcpcf.config.reset",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    mcpcf: {
      deletedKeyCount: result.deletedKeys.length,
    },
  })

  const data = yield* getMcpcfAdminResponse(context)
  return json(data)
})

const logMcpcfRefreshFailed = Effect.fn("admin.logMcpcfRefreshFailed")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
  config: McpcfConfigRecord,
  cause: unknown,
) {
  const log = yield* EffectRequestLogger
  yield* log.error(cause, {
    event: "admin.mcpcf.registry.refresh_failed",
    boundary: "admin.mcpcf.refresh",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    mcpcf: {
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      userOauthProviderId: config.userOauthProviderId || null,
      authTypeAllowlistCount: config.authTypeAllowlist.length,
      serverBlacklistCount: config.serverBlacklist.length,
    },
    _forceKeep: true,
  })
})

export const performRefreshMcpcf = Effect.fn("admin.performRefreshMcpcf")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
) {
  const registry = new McpcfRegistryStore(context.env)
  const config = yield* registry.getConfigOrDefault()
  yield* failUnless(Boolean(config.baseUrl), "MCP Context Forge base URL is required", 400)

  const adminApiTokenPresence = yield* registry
    .getAdminApiTokenWithPresence()
    .pipe(Effect.catch(() => failMessage("Global secret encryption is not configured", 500)))
  const adminApiToken = yield* requireOption(
    adminApiTokenPresence.adminApiToken.pipe(Option.filter((value) => value.trim().length > 0)),
    "MCP Context Forge admin API token is not configured",
    400,
  )

  const result = yield* registry.refresh({ adminApiToken }).pipe(
    Effect.tapError((cause) => logMcpcfRefreshFailed(context, admin, config, cause)),
    Effect.catch((cause) =>
      failMessage(`MCP Context Forge refresh failed: ${describeError(cause)}`, 502),
    ),
  )
  const log = yield* EffectRequestLogger
  yield* log.emit({
    event: "admin.mcpcf.registry.refreshed",
    boundary: "admin.mcpcf.refresh",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    mcpcf: {
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      userOauthProviderId: config.userOauthProviderId || null,
      authTypeAllowlistCount: config.authTypeAllowlist.length,
      serverBlacklistCount: config.serverBlacklist.length,
      added: result.added.length,
      updated: result.updated.length,
      filtered: result.filtered.length,
      blacklisted: result.blacklisted.length,
      missing: result.missing.length,
      unchanged: result.unchanged.length,
      failures: result.failures.length,
    },
  })
  return json(result)
})
