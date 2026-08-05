/* oxlint-disable s0-lint/max-file-lines -- MCPCF registry is already at the lint ceiling; keep registry storage changes localized. */
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { S0McpcfConfig, McpcfServerDefinition, SessionToolSpec } from "@solzero/shared"
import { getSelectedMcpcfServerIds, normalizeMcpcfServerSlug } from "@solzero/shared"
import { stringifyJson } from "../../lib/json"
import { describeError } from "../../lib/effect-errors"
import type { Env } from "../types"
import {
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
  S0_CONFIG_LOCATIONS,
  S0ConfigStore,
  getS0DeploymentConfig,
  getS0DeploymentSecret,
} from "./s0-config"
import {
  normalizeMcpcfSourceServer,
  normalizeMcpcfToolPreview,
  type McpcfToolPreview,
  type NormalizedMcpcfSourceServer,
} from "../mcpcf/metadata"
import { defaultMcpcfRefreshClient, type McpcfRefreshClient } from "../mcpcf/refresh-client"
import { McpcfConfigurationError, McpcfServerUnavailableError } from "./errors"

export const MCPCF_CONFIG_ID = "default"
export const MCPCF_ADMIN_API_TOKEN_SECRET_KEY = "mcpcf.admin-api-token"

export type McpcfSourceStatus = "active" | "filtered" | "blacklisted" | "missing"

export interface McpcfConfigRecord {
  id: string
  enabled: boolean
  baseUrl: string
  adminApiTokenSecretKey: string
  userOauthProviderId: string
  expectedIssuer: string | null
  authTypeAllowlist: string[]
  serverBlacklist: string[]
  createdAt: number
  updatedAt: number
}

export interface McpcfConfigUpdate {
  enabled: boolean
  baseUrl: string
  userOauthProviderId: string
  expectedIssuer?: string | null
  authTypeAllowlist?: readonly string[] | null
  serverBlacklist?: readonly string[] | null
}

export interface McpcfServerRecord extends McpcfServerDefinition {
  authType: string | null
  tools: McpcfToolPreview[]
  sourceStatus: McpcfSourceStatus
  filterReason: string | null
  enabled: boolean
  rawMetadata: Record<string, unknown>
  firstSeenAt: number
  lastSeenAt: number
  verifiedAt: number | null
  updatedAt: number
}

export interface McpcfRefreshDiffItem {
  id: string
  slug: string
  label: string
  reason?: string | null
}

export interface McpcfRefreshResult {
  added: McpcfRefreshDiffItem[]
  updated: McpcfRefreshDiffItem[]
  filtered: McpcfRefreshDiffItem[]
  blacklisted: McpcfRefreshDiffItem[]
  missing: McpcfRefreshDiffItem[]
  unchanged: McpcfRefreshDiffItem[]
  failures: Array<McpcfRefreshDiffItem & { error: string }>
}

export type McpcfConfigSource = "default" | "deployment" | "kv"
export type McpcfSecretSource = "deployment" | "kv" | "none"
export type McpcfRegistrySource = "kv" | "none"

export interface McpcfConfigPresence {
  configured: boolean
  source: McpcfConfigSource
  locked: boolean
  envVarName: string | null
  config: McpcfConfigRecord
}

export interface McpcfAdminApiTokenPresence {
  configured: boolean
  source: McpcfSecretSource
  locked: boolean
  envVarName: string | null
  adminApiToken: Option.Option<string>
}

export interface McpcfServerIndexPresence {
  serverIds: string[]
  source: McpcfRegistrySource
  locked: boolean
  envVarName: string | null
}

interface McpcfServerNext {
  slug: string
  label: string
  description: string
  authType: string | null
  toolCount: number
  tools: McpcfToolPreview[]
  sourceStatus: McpcfSourceStatus
  filterReason: string | null
  rawMetadata: Record<string, unknown>
}

interface McpcfRefreshContext {
  now: number
  client: McpcfRefreshClient
  config: McpcfConfigRecord
  adminApiToken: string
  existingById: Map<string, McpcfServerRecord>
  claimedSlugs: Map<string, string>
  seenIds: Set<string>
  allowlist: Set<string>
  blacklistIds: Set<string>
  blacklistSlugs: Set<string>
  result: McpcfRefreshResult
}

type McpcfRegistryEnv = Pick<Env, "S0_CONFIG" | "REPO_SECRETS_ENCRYPTION_KEY">

function normalizeStringList(values: readonly string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function normalizeAuthTypeAllowlist(values: readonly string[] | null | undefined): string[] {
  return normalizeStringList(values).map((value) => value.toLowerCase())
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  return Match.value(trimmed).pipe(
    Match.when("", () => ""),
    Match.orElse((resolved) => new URL(resolved).toString().replace(/\/+$/, "")),
  )
}

function defaultMcpcfConfig(now = Date.now()): McpcfConfigRecord {
  return {
    id: MCPCF_CONFIG_ID,
    enabled: false,
    baseUrl: "",
    adminApiTokenSecretKey: MCPCF_ADMIN_API_TOKEN_SECRET_KEY,
    userOauthProviderId: "",
    expectedIssuer: null,
    authTypeAllowlist: [],
    serverBlacklist: [],
    createdAt: now,
    updatedAt: now,
  }
}

/* oxlint-disable s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/no-ternary, s0-lint/prefer-option-over-null -- S0_CONFIG migration/registry decoders normalize untrusted JSON at a narrow boundary. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key]
  return typeof value === "string" ? value : fallback
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function booleanField(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key]
  return typeof value === "boolean" ? value : fallback
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function readMcpcfConfigRecord(value: unknown): Option.Option<McpcfConfigRecord> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(isRecord),
    Option.map((record) => {
      const now = Date.now()
      return {
        id: stringField(record, "id", MCPCF_CONFIG_ID),
        enabled: booleanField(record, "enabled", false),
        baseUrl: stringField(record, "baseUrl"),
        adminApiTokenSecretKey: stringField(
          record,
          "adminApiTokenSecretKey",
          MCPCF_ADMIN_API_TOKEN_SECRET_KEY,
        ),
        userOauthProviderId: stringField(record, "userOauthProviderId"),
        expectedIssuer: nullableStringField(record, "expectedIssuer"),
        authTypeAllowlist: readStringArray(record.authTypeAllowlist),
        serverBlacklist: readStringArray(record.serverBlacklist),
        createdAt: numberField(record, "createdAt", now),
        updatedAt: numberField(record, "updatedAt", now),
      } satisfies McpcfConfigRecord
    }),
  )
}

function readMcpcfConfig(value: Option.Option<unknown>, now = Date.now()): McpcfConfigRecord {
  return Option.getOrElse(Option.flatMap(value, readMcpcfConfigRecord), () =>
    defaultMcpcfConfig(now),
  )
}

function readMcpcfServerRecord(value: unknown): Option.Option<McpcfServerRecord> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(isRecord),
    Option.map((record) => {
      const rawMetadata = isRecord(record.rawMetadata) ? record.rawMetadata : {}
      const tools = Array.isArray(record.tools)
        ? record.tools
            .map((item) => normalizeMcpcfToolPreview(item))
            .filter((item): item is McpcfToolPreview => item !== null)
        : []
      return {
        id: stringField(record, "id"),
        slug: stringField(record, "slug"),
        label: stringField(record, "label"),
        description: stringField(record, "description"),
        authType: nullableStringField(record, "authType"),
        toolCount: numberField(record, "toolCount", tools.length),
        tools,
        sourceStatus: stringField(record, "sourceStatus", "active") as McpcfSourceStatus,
        filterReason: nullableStringField(record, "filterReason"),
        enabled: booleanField(record, "enabled", true),
        rawMetadata,
        firstSeenAt: numberField(record, "firstSeenAt", 0),
        lastSeenAt: numberField(record, "lastSeenAt", 0),
        verifiedAt: numberField(record, "verifiedAt", 0) || null,
        updatedAt: numberField(record, "updatedAt", 0),
      } satisfies McpcfServerRecord
    }),
    Option.filter((record) => record.id.length > 0),
  )
}
/* oxlint-enable s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/no-ternary, s0-lint/prefer-option-over-null */

function makeDiffItem(
  server: Pick<McpcfServerRecord, "id" | "slug" | "label">,
  reason?: string | null,
): McpcfRefreshDiffItem {
  const reasonPart = Option.match(Option.fromNullishOr(reason).pipe(Option.filter(Boolean)), {
    onNone: () => ({}),
    onSome: (resolved) => ({ reason: resolved }),
  })
  return { id: server.id, slug: server.slug, label: server.label, ...reasonPart }
}

function classifyServer(input: {
  server: NormalizedMcpcfSourceServer
  allowlist: Set<string>
  blacklistIds: Set<string>
  blacklistSlugs: Set<string>
}): { sourceStatus: McpcfSourceStatus; filterReason: string | null } {
  const authType = Option.getOrNull(
    Option.map(Option.fromNullishOr(input.server.authType), (value) => value.toLowerCase()),
  )
  const filteredByAuth =
    input.allowlist.size > 0 && (authType === null || !input.allowlist.has(authType))
  const blacklisted =
    input.blacklistIds.has(input.server.id) || input.blacklistSlugs.has(input.server.slug)
  return Match.value({ filteredByAuth, blacklisted }).pipe(
    Match.when({ filteredByAuth: true }, () => ({
      sourceStatus: "filtered" as const,
      filterReason: "auth_type_not_allowed",
    })),
    Match.when({ blacklisted: true }, () => ({
      sourceStatus: "blacklisted" as const,
      filterReason: "server_blacklisted",
    })),
    Match.orElse(() => ({ sourceStatus: "active" as const, filterReason: null })),
  )
}

function uniqueSlugForServer(
  slug: string,
  serverId: string,
  claimedSlugs: Map<string, string>,
): string {
  const existingOwner = claimedSlugs.get(slug)
  const resolved = Match.value(!existingOwner || existingOwner === serverId).pipe(
    Match.when(true, () => slug),
    Match.orElse(() =>
      normalizeMcpcfServerSlug(
        `${slug}_${
          serverId
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 8)
            .toLowerCase() || "server"
        }`,
      ),
    ),
  )
  claimedSlugs.set(resolved, serverId)
  return resolved
}

function serverChanged(existing: McpcfServerRecord | undefined, next: McpcfServerNext): boolean {
  return Option.match(Option.fromNullishOr(existing), {
    onNone: () => true,
    onSome: (record) =>
      record.slug !== next.slug ||
      record.label !== next.label ||
      record.description !== next.description ||
      record.authType !== next.authType ||
      record.toolCount !== next.toolCount ||
      record.sourceStatus !== next.sourceStatus ||
      record.filterReason !== next.filterReason ||
      stringifyJson(record.tools) !== stringifyJson(next.tools) ||
      stringifyJson(record.rawMetadata) !== stringifyJson(next.rawMetadata),
  })
}

function recordPresenceDiff(
  result: McpcfRefreshResult,
  existing: McpcfServerRecord | undefined,
  changed: boolean,
  item: McpcfRefreshDiffItem,
) {
  Match.value({ isNew: existing === undefined, changed }).pipe(
    Match.when({ isNew: true }, () => {
      result.added.push(item)
    }),
    Match.when({ changed: true }, () => {
      result.updated.push(item)
    }),
    Match.orElse(() => {
      result.unchanged.push(item)
    }),
  )
}

function recordDiff(
  result: McpcfRefreshResult,
  classification: { sourceStatus: McpcfSourceStatus; filterReason: string | null },
  existing: McpcfServerRecord | undefined,
  changed: boolean,
  item: McpcfRefreshDiffItem,
) {
  Match.value(classification.sourceStatus).pipe(
    Match.when("filtered", () => {
      result.filtered.push(item)
    }),
    Match.when("blacklisted", () => {
      result.blacklisted.push(item)
    }),
    Match.orElse(() => recordPresenceDiff(result, existing, changed, item)),
  )
}

export class McpcfRegistryStore {
  private readonly s0Config

  constructor(private readonly env: McpcfRegistryEnv) {
    this.s0Config = new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
  }

  getConfig = Effect.fn("db.mcpcf.getConfig")(function* (this: McpcfRegistryStore) {
    const presence = yield* this.getConfigWithPresence()
    return Match.value(presence.configured).pipe(
      Match.when(true, () => Option.some(presence.config)),
      Match.orElse(() => Option.none<McpcfConfigRecord>()),
    )
  })

  getConfigWithPresence = Effect.fn("db.mcpcf.getConfigWithPresence")(
    function* (this: McpcfRegistryStore) {
      const now = Date.now()
      const deploymentValue = getS0DeploymentConfig<S0McpcfConfig>(
        this.env,
        S0_CONFIG_BINDINGS.mcpcf,
      )
      const store = this
      return yield* Option.match(deploymentValue, {
        onNone: () =>
          Effect.gen(function* () {
            const value = yield* store.s0Config.getJson(S0_CONFIG_KEYS.mcpcf.config)
            const configured = Option.isSome(value)
            const source = Match.value(configured).pipe(
              Match.when(true, () => "kv" as const),
              Match.orElse(() => "default" as const),
            )
            return {
              configured,
              source,
              locked: false,
              envVarName: null,
              config: readMcpcfConfig(value, now),
            } satisfies McpcfConfigPresence
          }),
        onSome: (value) =>
          Effect.succeed({
            configured: true,
            source: "deployment" as const,
            locked: true,
            envVarName: S0_CONFIG_LOCATIONS.mcpcf,
            config: readMcpcfConfig(Option.some(value), now),
          } satisfies McpcfConfigPresence),
      })
    },
  )

  getConfigOrDefault = Effect.fn("db.mcpcf.getConfigOrDefault")(
    function* (this: McpcfRegistryStore) {
      const presence = yield* this.getConfigWithPresence()
      return presence.config
    },
  )

  getAdminApiTokenStatus = Effect.fn("db.mcpcf.getAdminApiTokenStatus")(
    function* (this: McpcfRegistryStore) {
      const deploymentConfig = getS0DeploymentConfig<S0McpcfConfig>(
        this.env,
        S0_CONFIG_BINDINGS.mcpcf,
      )
      const deploymentTokenReference = Option.flatMap(deploymentConfig, (config) =>
        Option.fromNullishOr(config.adminApiToken),
      )
      const store = this
      return yield* Option.match(deploymentTokenReference, {
        onNone: () =>
          Effect.gen(function* () {
            const configured = yield* store.s0Config.encryptedSecretConfigured(
              S0_CONFIG_KEYS.mcpcf.adminApiToken,
            )
            const source = Match.value(configured).pipe(
              Match.when(true, () => "kv" as const),
              Match.orElse(() => "none" as const),
            )
            return {
              configured,
              source,
              locked: false,
              envVarName: null,
              adminApiToken: Option.none<string>(),
            } satisfies McpcfAdminApiTokenPresence
          }),
        onSome: (reference) =>
          Option.match(getS0DeploymentSecret(this.env, reference), {
            onNone: () =>
              Effect.die(new Error(`${reference.env} is required by ${S0_CONFIG_LOCATIONS.mcpcf}`)),
            onSome: () =>
              Effect.succeed({
                configured: true,
                source: "deployment" as const,
                locked: true,
                envVarName: `${S0_CONFIG_LOCATIONS.mcpcf}.adminApiToken`,
                adminApiToken: Option.none<string>(),
              } satisfies McpcfAdminApiTokenPresence),
          }),
      })
    },
  )

  getAdminApiTokenWithPresence = Effect.fn("db.mcpcf.getAdminApiTokenWithPresence")(
    function* (this: McpcfRegistryStore) {
      const deploymentConfig = getS0DeploymentConfig<S0McpcfConfig>(
        this.env,
        S0_CONFIG_BINDINGS.mcpcf,
      )
      const deploymentTokenReference = Option.flatMap(deploymentConfig, (config) =>
        Option.fromNullishOr(config.adminApiToken),
      )
      const store = this
      return yield* Option.match(deploymentTokenReference, {
        onNone: () =>
          Effect.gen(function* () {
            const configured = yield* store.s0Config.encryptedSecretConfigured(
              S0_CONFIG_KEYS.mcpcf.adminApiToken,
            )
            const adminApiToken = yield* Match.value(configured).pipe(
              Match.when(false, () => Effect.succeed(Option.none<string>())),
              Match.orElse(() =>
                store.s0Config.getEncryptedSecret(S0_CONFIG_KEYS.mcpcf.adminApiToken),
              ),
            )
            const source = Match.value(configured).pipe(
              Match.when(true, () => "kv" as const),
              Match.orElse(() => "none" as const),
            )
            return {
              configured: Option.isSome(adminApiToken),
              source,
              locked: false,
              envVarName: null,
              adminApiToken,
            } satisfies McpcfAdminApiTokenPresence
          }),
        onSome: (reference) =>
          Option.match(getS0DeploymentSecret(this.env, reference), {
            onNone: () =>
              Effect.die(new Error(`${reference.env} is required by ${S0_CONFIG_LOCATIONS.mcpcf}`)),
            onSome: (adminApiToken) =>
              Effect.succeed({
                configured: true,
                source: "deployment" as const,
                locked: true,
                envVarName: `${S0_CONFIG_LOCATIONS.mcpcf}.adminApiToken`,
                adminApiToken: Option.some(adminApiToken),
              } satisfies McpcfAdminApiTokenPresence),
          }),
      })
    },
  )

  upsertConfig = Effect.fn("db.mcpcf.upsertConfig")(function* (
    this: McpcfRegistryStore,
    update: McpcfConfigUpdate,
  ) {
    const existingPresence = yield* this.getConfigWithPresence()
    const failLockedConfig = Effect.fail(
      new McpcfConfigurationError({
        message: `MCP Context Forge config is managed by ${existingPresence.envVarName ?? "deployment configuration"}; remove it from the active stage config to edit it in Admin`,
      }),
    )
    const configLocked = Effect.succeed(existingPresence.locked)
    yield* Effect.when(failLockedConfig, configLocked)

    const existing = Match.value(existingPresence.configured).pipe(
      Match.when(true, () => Option.some(existingPresence.config)),
      Match.orElse(() => Option.none<McpcfConfigRecord>()),
    )
    const now = Date.now()
    const adminApiTokenSecretKey = Option.getOrElse(
      Option.map(existing, (record) => record.adminApiTokenSecretKey),
      () => MCPCF_ADMIN_API_TOKEN_SECRET_KEY,
    )
    const createdAt = Option.getOrElse(
      Option.map(existing, (record) => record.createdAt),
      () => now,
    )
    const record = {
      id: MCPCF_CONFIG_ID,
      enabled: update.enabled,
      baseUrl: normalizeBaseUrl(update.baseUrl),
      adminApiTokenSecretKey,
      userOauthProviderId: update.userOauthProviderId.trim(),
      expectedIssuer: update.expectedIssuer?.trim() || null,
      authTypeAllowlist: normalizeAuthTypeAllowlist(update.authTypeAllowlist),
      serverBlacklist: normalizeStringList(update.serverBlacklist),
      createdAt,
      updatedAt: now,
    } satisfies McpcfConfigRecord
    yield* this.s0Config.putJson(S0_CONFIG_KEYS.mcpcf.config, record)
    return record
  })

  listServers = Effect.fn("db.mcpcf.listServers")(function* (this: McpcfRegistryStore) {
    const serverIds = yield* this.getServerIndex()
    const serverOptions = yield* Effect.forEach(serverIds, (serverId) => this.getServer(serverId), {
      concurrency: "unbounded",
    })
    return serverOptions
      .flatMap((server) =>
        Option.match(server, {
          onNone: () => [],
          onSome: (record) => [record],
        }),
      )
      .sort((left, right) => left.label.localeCompare(right.label))
  })

  listAvailableServers = Effect.fn("db.mcpcf.listAvailableServers")(
    function* (this: McpcfRegistryStore) {
      const servers = yield* this.listServers()
      return servers.filter((server) => server.enabled && server.sourceStatus === "active")
    },
  )

  getServer = Effect.fn("db.mcpcf.getServer")(function* (
    this: McpcfRegistryStore,
    serverId: string,
  ) {
    const value = yield* this.s0Config.getJson(S0_CONFIG_KEYS.mcpcf.server(serverId))
    return Option.flatMap(value, readMcpcfServerRecord)
  })

  listServersByIds = Effect.fn("db.mcpcf.listServersByIds")(function* (
    this: McpcfRegistryStore,
    serverIds: readonly string[],
  ) {
    const uniqueIds = [...new Set(serverIds.map((serverId) => serverId.trim()).filter(Boolean))]
    return yield* Match.value(uniqueIds.length === 0).pipe(
      Match.when(true, () => Effect.succeed([] as McpcfServerRecord[])),
      Match.orElse(() => this.queryServersByIds(uniqueIds)),
    )
  })

  private queryServersByIds = Effect.fn("db.mcpcf.queryServersByIds")(function* (
    this: McpcfRegistryStore,
    uniqueIds: readonly string[],
  ) {
    const serverOptions = yield* Effect.forEach(uniqueIds, (serverId) => this.getServer(serverId), {
      concurrency: "unbounded",
    })
    return serverOptions.flatMap((server) =>
      Option.match(server, {
        onNone: () => [],
        onSome: (record) => [record],
      }),
    )
  })

  listAvailableServersByIds = Effect.fn("db.mcpcf.listAvailableServersByIds")(function* (
    this: McpcfRegistryStore,
    serverIds: readonly string[],
  ) {
    const servers = yield* this.listServersByIds(serverIds)
    return servers.filter((server) => server.enabled && server.sourceStatus === "active")
  })

  listSelectedAvailableServers = Effect.fn("db.mcpcf.listSelectedAvailableServers")(function* (
    this: McpcfRegistryStore,
    tools: readonly SessionToolSpec[] | null | undefined,
  ) {
    const selectedServerIds = getSelectedMcpcfServerIds(tools)
    return yield* Match.value(selectedServerIds.length === 0).pipe(
      Match.when(true, () => Effect.succeed([] as McpcfServerRecord[])),
      Match.orElse(() => this.resolveSelectedServers(selectedServerIds)),
    )
  })

  private resolveSelectedServers = Effect.fn("db.mcpcf.resolveSelectedServers")(function* (
    this: McpcfRegistryStore,
    selectedServerIds: readonly string[],
  ) {
    const servers = yield* this.listAvailableServersByIds(selectedServerIds)
    const availableIds = new Set(servers.map((server) => server.id))
    const missingIds = selectedServerIds.filter((serverId) => !availableIds.has(serverId))
    return yield* Match.value(servers.length !== selectedServerIds.length).pipe(
      Match.when(true, () =>
        Effect.fail(new McpcfServerUnavailableError({ serverIds: missingIds })),
      ),
      Match.orElse(() => Effect.succeed(servers)),
    )
  })

  refresh = Effect.fn("db.mcpcf.refresh")(function* (
    this: McpcfRegistryStore,
    input: {
      adminApiToken: string
      client?: McpcfRefreshClient
      now?: number
    },
  ) {
    const config = yield* this.getConfigOrDefault()
    const failMissingBaseUrl = Effect.fail(
      new McpcfConfigurationError({ message: "MCP Context Forge base URL is required" }),
    )
    const baseUrlMissing = Effect.succeed(config.baseUrl.length === 0)
    yield* Effect.when(failMissingBaseUrl, baseUrlMissing)

    const now = input.now ?? Date.now()
    const client = input.client ?? defaultMcpcfRefreshClient
    const existingServers = yield* this.listServers()
    const ctx: McpcfRefreshContext = {
      now,
      client,
      config,
      adminApiToken: input.adminApiToken,
      existingById: new Map(existingServers.map((server) => [server.id, server])),
      claimedSlugs: new Map(existingServers.map((server) => [server.slug, server.id])),
      seenIds: new Set<string>(),
      allowlist: new Set(config.authTypeAllowlist.map((value) => value.toLowerCase())),
      blacklistIds: new Set(config.serverBlacklist),
      blacklistSlugs: new Set(config.serverBlacklist.map((value) => value.toLowerCase())),
      result: {
        added: [],
        updated: [],
        filtered: [],
        blacklisted: [],
        missing: [],
        unchanged: [],
        failures: [],
      },
    }

    const discoveredRaw = yield* client.fetchServers({ config, adminApiToken: input.adminApiToken })
    const discovered = discoveredRaw
      .map(normalizeMcpcfSourceServer)
      .filter((server): server is NormalizedMcpcfSourceServer => server !== null)
    const nextServerIds = [
      ...new Set([
        ...existingServers.map((server) => server.id),
        ...discovered.map((server) => server.id),
      ]),
    ]

    // Process discovered servers sequentially: slug uniqueness threads through the shared
    // `claimedSlugs` map, so order must be preserved.
    yield* Effect.forEach(discovered, (server) => this.processDiscoveredServer(ctx, server))

    const missingServers = existingServers.filter(
      (existing) => !ctx.seenIds.has(existing.id) && existing.sourceStatus !== "missing",
    )
    yield* Effect.forEach(
      missingServers,
      (existing) =>
        this.putServerRecord({
          ...existing,
          sourceStatus: "missing",
          filterReason: "not_discovered",
          updatedAt: now,
        }),
      { concurrency: "unbounded" },
    )
    ctx.result.missing.push(
      ...missingServers.map((existing) => makeDiffItem(existing, "not_discovered")),
    )
    yield* this.putServerIndex(nextServerIds)

    return ctx.result
  })

  private processDiscoveredServer = Effect.fn("db.mcpcf.processDiscoveredServer")(function* (
    this: McpcfRegistryStore,
    ctx: McpcfRefreshContext,
    server: NormalizedMcpcfSourceServer,
  ) {
    ctx.seenIds.add(server.id)
    server.slug = uniqueSlugForServer(server.slug, server.id, ctx.claimedSlugs)
    const existing = ctx.existingById.get(server.id)
    const classification = classifyServer({
      server,
      allowlist: ctx.allowlist,
      blacklistIds: ctx.blacklistIds,
      blacklistSlugs: ctx.blacklistSlugs,
    })

    const tools = yield* Match.value(classification.sourceStatus === "active").pipe(
      Match.when(true, () => this.fetchServerToolsSafe(ctx, server)),
      Match.orElse(() => Effect.succeed([] as McpcfToolPreview[])),
    )

    const next: McpcfServerNext = {
      slug: server.slug,
      label: server.label,
      description: server.description,
      authType: server.authType,
      toolCount: tools.length,
      tools,
      sourceStatus: classification.sourceStatus,
      filterReason: classification.filterReason,
      rawMetadata: server.rawMetadata,
    }
    const changed = serverChanged(existing, next)
    const enabledValue = Match.value(existing?.enabled === false).pipe(
      Match.when(true, () => false),
      Match.orElse(() => true),
    )
    const verifiedAt = Match.value(next.sourceStatus === "active").pipe(
      Match.when(true, () => ctx.now),
      Match.orElse(() => existing?.verifiedAt ?? null),
    )
    const firstSeenAt = existing?.firstSeenAt ?? ctx.now

    yield* this.putServerRecord({
      id: server.id,
      slug: next.slug,
      label: next.label,
      description: next.description,
      authType: next.authType,
      toolCount: next.toolCount,
      tools: next.tools,
      sourceStatus: next.sourceStatus,
      filterReason: next.filterReason,
      enabled: enabledValue,
      rawMetadata: next.rawMetadata,
      firstSeenAt,
      lastSeenAt: ctx.now,
      verifiedAt,
      updatedAt: ctx.now,
    })

    recordDiff(
      ctx.result,
      classification,
      existing,
      changed,
      makeDiffItem(server, classification.filterReason),
    )
  })

  private fetchServerToolsSafe = Effect.fn("db.mcpcf.fetchServerTools")(function* (
    this: McpcfRegistryStore,
    ctx: McpcfRefreshContext,
    server: NormalizedMcpcfSourceServer,
  ) {
    return yield* ctx.client
      .fetchServerTools({
        config: ctx.config,
        adminApiToken: ctx.adminApiToken,
        serverId: server.id,
      })
      .pipe(
        Effect.map((rawTools) =>
          rawTools
            .map(normalizeMcpcfToolPreview)
            .filter((tool): tool is McpcfToolPreview => tool !== null),
        ),
        Effect.catch((error) => this.recordToolFetchFailure(ctx, server, error)),
      )
  })

  private recordToolFetchFailure(
    ctx: McpcfRefreshContext,
    server: NormalizedMcpcfSourceServer,
    error: unknown,
  ) {
    ctx.result.failures.push({ ...makeDiffItem(server), error: describeError(error) })
    return Effect.succeed([] as McpcfToolPreview[])
  }

  private getServerIndex = Effect.fn("db.mcpcf.getServerIndex")(
    function* (this: McpcfRegistryStore) {
      const presence = yield* this.getServerIndexWithPresence()
      return presence.serverIds
    },
  )

  getServerIndexWithPresence = Effect.fn("db.mcpcf.getServerIndexWithPresence")(
    function* (this: McpcfRegistryStore) {
      const value = yield* this.s0Config.getJson(S0_CONFIG_KEYS.mcpcf.serverIndex)
      const serverIds = Option.match(value, {
        onNone: () => [] as string[],
        onSome: readStringArray,
      })
      const source = Match.value(Option.isSome(value)).pipe(
        Match.when(true, () => "kv" as const),
        Match.orElse(() => "none" as const),
      )
      return {
        serverIds,
        source,
        locked: false,
        envVarName: null,
      } satisfies McpcfServerIndexPresence
    },
  )

  private putServerIndex = Effect.fn("db.mcpcf.putServerIndex")(function* (
    this: McpcfRegistryStore,
    serverIds: readonly string[],
  ) {
    const normalized = [
      ...new Set(serverIds.map((serverId) => serverId.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right))
    yield* this.s0Config.putJson(S0_CONFIG_KEYS.mcpcf.serverIndex, normalized)
  })

  private putServerRecord = Effect.fn("db.mcpcf.putServerRecord")(function* (
    this: McpcfRegistryStore,
    server: McpcfServerRecord,
  ) {
    yield* this.s0Config.putJson(S0_CONFIG_KEYS.mcpcf.server(server.id), server)
  })
}

function runMcpcfRegistryEffect<A, E>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge for the generic Effect returned by the registry methods.
  effect: Effect.Effect<A, E>,
): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect McpcfRegistryStore to non-Effect runtime consumers (session MCP resolution and the MCP Context Forge server).
  return Effect.runPromise(effect)
}

/**
 * Promise-facing view of {@link McpcfRegistryStore} for the non-Effect MCP runtime (session MCP
 * server resolution and the MCP Context Forge server). Runs the underlying Effect at this boundary.
 */
export interface McpcfRegistryStorePromise {
  getConfigOrDefault(): Promise<McpcfConfigRecord>
  listAvailableServersByIds(serverIds: readonly string[]): Promise<McpcfServerRecord[]>
  listSelectedAvailableServers(
    tools: readonly SessionToolSpec[] | null | undefined,
  ): Promise<McpcfServerRecord[]>
}

export function createMcpcfRegistryStoreFromEnv(env: McpcfRegistryEnv): McpcfRegistryStorePromise {
  const registry = new McpcfRegistryStore(env)
  return {
    getConfigOrDefault: () => runMcpcfRegistryEffect(registry.getConfigOrDefault()),
    listAvailableServersByIds: (serverIds) =>
      runMcpcfRegistryEffect(registry.listAvailableServersByIds(serverIds)),
    listSelectedAvailableServers: (tools) =>
      runMcpcfRegistryEffect(registry.listSelectedAvailableServers(tools)),
  }
}
