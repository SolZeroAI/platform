/* oxlint-disable c0-lint/no-if-statement, c0-lint/no-ternary, c0-lint/prefer-option-over-null, c0-lint/no-return-in-arrow, c0-lint/no-return-in-callback, c0-lint/no-branch-in-object -- AI Search registry is a low-level C0_CONFIG and Cloudflare namespace boundary with compact JSON decoders and request builders. */
import {
  AI_SEARCH_SESSION_TOOL_KIND,
  getSelectedAiSearchSourceIds,
  normalizeAiSearchSourceId,
  type SessionToolSpec,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { describeError, toError } from "../../lib/effect-errors"
import type { Env } from "../types"
import { C0_CONFIG_KEYS, C0ConfigStore } from "./c0-config"

export const DEFAULT_AI_SEARCH_MAX_RESULTS = 5

export type AiSearchSourceRecordSource = "kv"
export type AiSearchDataSourceType = "built-in" | "r2" | "website"

export interface AiSearchBuiltInDataSourceRecord {
  type: "built-in"
}

export interface AiSearchR2DataSourceRecord {
  type: "r2"
  bucketName: string
  prefix: string | null
  r2Jurisdiction: string | null
}

export interface AiSearchWebsiteDataSourceRecord {
  type: "website"
  domain: string
  includePaths: readonly string[]
  excludePaths: readonly string[]
  specificSitemaps: readonly string[]
  useBrowserRendering: boolean
  includeImages: boolean
}

export type AiSearchDataSourceRecord =
  | AiSearchBuiltInDataSourceRecord
  | AiSearchR2DataSourceRecord
  | AiSearchWebsiteDataSourceRecord

export interface AiSearchSourceRecord {
  id: string
  label: string
  description: string
  enabled: boolean
  maxResults: number
  dataSource: AiSearchDataSourceRecord
  createdAt: number
  updatedAt: number
}

export interface AiSearchSourceWithPresence {
  source: AiSearchSourceRecord
  recordSource: AiSearchSourceRecordSource
  locked: boolean
  envVarName: string | null
}

export interface AiSearchSourceUpdate {
  id: string
  label: string
  description: string
  enabled: boolean
  maxResults?: number | null
  dataSource: AiSearchDataSourceRecord
}

export interface AiSearchInstanceListItem {
  id: string
  type: string | null
  source: string | null
  status: string | null
  enabled: boolean | null
  namespace: string | null
  createdAt: string | null
  modifiedAt: string | null
}

export class AiSearchConfigurationError extends Schema.TaggedErrorClass<AiSearchConfigurationError>()(
  "AiSearchConfigurationError",
  {
    message: Schema.String,
  },
) {}

export class AiSearchSourceUnavailableError extends Schema.TaggedErrorClass<AiSearchSourceUnavailableError>()(
  "AiSearchSourceUnavailableError",
  {
    sourceIds: Schema.Array(Schema.String),
  },
) {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key]
  return typeof value === "string" ? value : fallback
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
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

function normalizeStringList(values: readonly string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function normalizeMaxResults(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return DEFAULT_AI_SEARCH_MAX_RESULTS
  }
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new AiSearchConfigurationError({
      message: "AI Search max results must be an integer between 1 and 20",
    })
  }
  return value
}

function normalizeDomain(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
  if (!trimmed) {
    throw new AiSearchConfigurationError({ message: "Website domain is required" })
  }
  return trimmed
}

function normalizeDataSource(dataSource: AiSearchDataSourceRecord): AiSearchDataSourceRecord {
  switch (dataSource.type) {
    case "built-in":
      return { type: "built-in" }
    case "r2":
      return {
        type: "r2",
        bucketName: dataSource.bucketName.trim(),
        prefix: dataSource.prefix?.trim() || null,
        r2Jurisdiction: dataSource.r2Jurisdiction?.trim() || null,
      }
    case "website":
      return {
        type: "website",
        domain: normalizeDomain(dataSource.domain),
        includePaths: normalizeStringList(dataSource.includePaths),
        excludePaths: normalizeStringList(dataSource.excludePaths),
        specificSitemaps: normalizeStringList(dataSource.specificSitemaps),
        useBrowserRendering: Boolean(dataSource.useBrowserRendering),
        includeImages: Boolean(dataSource.includeImages),
      }
  }
}

function validateDataSource(dataSource: AiSearchDataSourceRecord) {
  if (dataSource.type === "r2" && !dataSource.bucketName.trim()) {
    throw new AiSearchConfigurationError({ message: "R2 bucket name is required" })
  }
}

function readAiSearchDataSourceRecord(value: unknown): AiSearchDataSourceRecord | null {
  if (!isRecord(value)) {
    return null
  }
  const type = stringField(value, "type")
  return Match.value(type).pipe(
    Match.when("built-in", () => ({ type: "built-in" }) satisfies AiSearchBuiltInDataSourceRecord),
    Match.when(
      "r2",
      () =>
        ({
          type: "r2",
          bucketName: stringField(value, "bucketName"),
          prefix: nullableStringField(value, "prefix"),
          r2Jurisdiction: nullableStringField(value, "r2Jurisdiction"),
        }) satisfies AiSearchR2DataSourceRecord,
    ),
    Match.when(
      "website",
      () =>
        ({
          type: "website",
          domain: stringField(value, "domain"),
          includePaths: readStringArray(value.includePaths),
          excludePaths: readStringArray(value.excludePaths),
          specificSitemaps: readStringArray(value.specificSitemaps),
          useBrowserRendering: booleanField(value, "useBrowserRendering", false),
          includeImages: booleanField(value, "includeImages", false),
        }) satisfies AiSearchWebsiteDataSourceRecord,
    ),
    Match.orElse(() => null),
  )
}

export function readAiSearchSourceRecord(value: unknown): Option.Option<AiSearchSourceRecord> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(isRecord),
    Option.flatMap((record) => {
      const dataSource = readAiSearchDataSourceRecord(record.dataSource)
      if (!dataSource) {
        return Option.none<AiSearchSourceRecord>()
      }
      const id = normalizeAiSearchSourceId(stringField(record, "id"))
      const now = Date.now()
      return Option.some({
        id,
        label: stringField(record, "label", id),
        description: stringField(record, "description"),
        enabled: booleanField(record, "enabled", true),
        maxResults: normalizeMaxResults(
          numberField(record, "maxResults", DEFAULT_AI_SEARCH_MAX_RESULTS),
        ),
        dataSource: normalizeDataSource(dataSource),
        createdAt: numberField(record, "createdAt", now),
        updatedAt: numberField(record, "updatedAt", now),
      } satisfies AiSearchSourceRecord)
    }),
  )
}

function buildAiSearchSourceRecord(
  update: AiSearchSourceUpdate,
  existing: Option.Option<AiSearchSourceRecord>,
): AiSearchSourceRecord {
  const id = normalizeAiSearchSourceId(update.id)
  const dataSource = normalizeDataSource(update.dataSource)
  validateDataSource(dataSource)
  const now = Date.now()
  return {
    id,
    label: update.label.trim() || id,
    description: update.description.trim(),
    enabled: update.enabled,
    maxResults: normalizeMaxResults(update.maxResults),
    dataSource,
    createdAt: Option.getOrElse(
      Option.map(existing, (source) => source.createdAt),
      () => now,
    ),
    updatedAt: now,
  }
}

function ensureUniqueToolNames(sources: readonly AiSearchSourceRecord[]) {
  const seen = new Map<string, string>()
  for (const source of sources) {
    const toolNames = getAiSearchMcpToolNames(source)
    const existing = seen.get(toolNames.search)
    if (existing && existing !== source.id) {
      throw new AiSearchConfigurationError({
        message: `AI Search source IDs '${existing}' and '${source.id}' generate the same MCP tool names`,
      })
    }
    seen.set(toolNames.search, source.id)
  }
}

type AiSearchNamespace = NonNullable<Env["AI_SEARCH"]>
type AiSearchCreateInput = Parameters<AiSearchNamespace["create"]>[0]
type AiSearchInstance = ReturnType<AiSearchNamespace["get"]>
type AiSearchUpdateInput = Parameters<AiSearchInstance["update"]>[0]

function sourceParamsFor(dataSource: AiSearchDataSourceRecord) {
  switch (dataSource.type) {
    case "built-in":
      return undefined
    case "r2":
      return {
        ...(dataSource.prefix ? { prefix: dataSource.prefix } : {}),
        ...(dataSource.r2Jurisdiction ? { r2_jurisdiction: dataSource.r2Jurisdiction } : {}),
      }
    case "website":
      return {
        ...(dataSource.includePaths.length > 0 ? { include_items: dataSource.includePaths } : {}),
        ...(dataSource.excludePaths.length > 0 ? { exclude_items: dataSource.excludePaths } : {}),
        web_crawler: {
          parse_type: "sitemap",
          parse_options: {
            include_images: dataSource.includeImages,
            use_browser_rendering: dataSource.useBrowserRendering,
            ...(dataSource.specificSitemaps.length > 0
              ? { specific_sitemaps: dataSource.specificSitemaps }
              : {}),
          },
        },
      }
  }
}

function createInputFor(
  source: AiSearchSourceRecord,
  tokenId?: string | null,
): AiSearchCreateInput {
  const base = {
    id: source.id,
    enable: source.enabled,
    max_num_results: source.maxResults,
    ...(tokenId?.trim() ? { token_id: tokenId.trim() } : {}),
  }
  switch (source.dataSource.type) {
    case "built-in":
      return base as AiSearchCreateInput
    case "r2":
      return {
        ...base,
        type: "r2",
        source: source.dataSource.bucketName,
        source_params: sourceParamsFor(source.dataSource),
      } as AiSearchCreateInput
    case "website":
      return {
        ...base,
        type: "web-crawler",
        source: source.dataSource.domain,
        source_params: sourceParamsFor(source.dataSource),
      } as AiSearchCreateInput
  }
}

function updateInputFor(source: AiSearchSourceRecord): AiSearchUpdateInput {
  const sourceParams = sourceParamsFor(source.dataSource)
  return {
    enable: source.enabled,
    max_num_results: source.maxResults,
    ...(source.dataSource.type === "r2" ? { source: source.dataSource.bucketName } : {}),
    ...(source.dataSource.type === "website" ? { source: source.dataSource.domain } : {}),
    ...(sourceParams ? { source_params: sourceParams } : {}),
  } as AiSearchUpdateInput
}

function normalizeInstanceListItem(item: unknown): AiSearchInstanceListItem | null {
  if (!isRecord(item)) {
    return null
  }
  return {
    id: stringField(item, "id"),
    type: nullableStringField(item, "type"),
    source: nullableStringField(item, "source"),
    status: nullableStringField(item, "status"),
    enabled: typeof item.enable === "boolean" ? item.enable : null,
    namespace: nullableStringField(item, "namespace"),
    createdAt: nullableStringField(item, "created_at"),
    modifiedAt: nullableStringField(item, "modified_at"),
  }
}

function isRecordEnv(env: Env): env is Env & { AI_SEARCH: NonNullable<Env["AI_SEARCH"]> } {
  return Boolean(env.AI_SEARCH)
}

function sourcePresenceOption(
  value: unknown,
  presence: Omit<AiSearchSourceWithPresence, "source">,
): Option.Option<AiSearchSourceWithPresence> {
  return Option.map(readAiSearchSourceRecord(value), (source) => ({
    ...presence,
    source,
  }))
}

export class AiSearchRegistryStore {
  readonly c0Config: C0ConfigStore

  constructor(readonly env: Env) {
    this.c0Config = new C0ConfigStore(env.C0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
  }

  getSourceWithPresence = Effect.fn("db.aiSearch.getSourceWithPresence")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
  ) {
    const normalizedSourceId = normalizeAiSearchSourceId(sourceId)
    const value = yield* this.c0Config.getJson(C0_CONFIG_KEYS.aiSearch.source(normalizedSourceId))
    return Option.flatMap(value, (resolved) =>
      sourcePresenceOption(resolved, {
        recordSource: "kv" as const,
        locked: false,
        envVarName: null,
      }),
    )
  })

  listSourcesWithPresence = Effect.fn("db.aiSearch.listSourcesWithPresence")(
    function* (this: AiSearchRegistryStore) {
      const kvKeys = yield* this.c0Config.listKeys(C0_CONFIG_KEYS.aiSearch.sourcePrefix)
      const kvSourceOptions = yield* Effect.forEach(
        kvKeys,
        (key) =>
          this.c0Config.getJson(key).pipe(
            Effect.map((value) =>
              Option.flatMap(value, (resolved) =>
                sourcePresenceOption(resolved, {
                  recordSource: "kv" as const,
                  locked: false,
                  envVarName: null,
                }),
              ),
            ),
          ),
        { concurrency: "unbounded" },
      )
      const kvSources = kvSourceOptions.flatMap((source) =>
        Option.match(source, {
          onNone: () => [],
          onSome: (value) => [value],
        }),
      )
      const sources = kvSources
      ensureUniqueToolNames(sources.map((source) => source.source))
      return sources.sort((left, right) => left.source.label.localeCompare(right.source.label))
    },
  )

  listSources = Effect.fn("db.aiSearch.listSources")(function* (this: AiSearchRegistryStore) {
    const sources = yield* this.listSourcesWithPresence()
    return sources.map((source) => source.source)
  })

  listAvailableSources = Effect.fn("db.aiSearch.listAvailableSources")(
    function* (this: AiSearchRegistryStore) {
      const sources = yield* this.listSources()
      return sources.filter((source) => source.enabled)
    },
  )

  listAvailableSourcesByIds = Effect.fn("db.aiSearch.listAvailableSourcesByIds")(function* (
    this: AiSearchRegistryStore,
    sourceIds: readonly string[],
  ) {
    const uniqueIds = [...new Set(sourceIds.map(normalizeAiSearchSourceId))]
    if (uniqueIds.length === 0) {
      return []
    }
    const available = yield* this.listAvailableSources()
    const byId = new Map(available.map((source) => [source.id, source]))
    return uniqueIds.flatMap((sourceId) => {
      const source = byId.get(sourceId)
      return source ? [source] : []
    })
  })

  listSelectedAvailableSources = Effect.fn("db.aiSearch.listSelectedAvailableSources")(function* (
    this: AiSearchRegistryStore,
    tools: readonly SessionToolSpec[] | null | undefined,
  ) {
    const selectedSourceIds = getSelectedAiSearchSourceIds(tools)
    if (selectedSourceIds.length === 0) {
      return []
    }
    const sources = yield* this.listAvailableSourcesByIds(selectedSourceIds)
    const availableIds = new Set(sources.map((source) => source.id))
    const missingIds = selectedSourceIds.filter((sourceId) => !availableIds.has(sourceId))
    if (missingIds.length > 0) {
      return yield* Effect.fail(new AiSearchSourceUnavailableError({ sourceIds: missingIds }))
    }
    return sources
  })

  createSource = Effect.fn("db.aiSearch.createSource")(function* (
    this: AiSearchRegistryStore,
    update: AiSearchSourceUpdate,
  ) {
    const sourceId = normalizeAiSearchSourceId(update.id)
    const existing = yield* this.getSourceWithPresence(sourceId)
    if (Option.isSome(existing)) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({
          message: `AI Search source '${sourceId}' already exists`,
        }),
      )
    }
    const record = buildAiSearchSourceRecord(update, Option.none())
    yield* this.createCloudflareInstance(record)
    yield* this.putSourceRecord(record)
    return record
  })

  updateSource = Effect.fn("db.aiSearch.updateSource")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
    update: AiSearchSourceUpdate,
  ) {
    const normalizedSourceId = normalizeAiSearchSourceId(sourceId)
    const existingPresence = yield* this.getSourceWithPresence(normalizedSourceId)
    const existing = yield* Option.match(existingPresence, {
      onNone: () =>
        Effect.fail(
          new AiSearchConfigurationError({
            message: `AI Search source '${normalizedSourceId}' does not exist`,
          }),
        ),
      onSome: (resolved) => Effect.succeed(resolved),
    })
    if (update.id !== normalizedSourceId) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({ message: "AI Search source id cannot be changed" }),
      )
    }
    if (update.dataSource.type !== existing.source.dataSource.type) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({
          message: "AI Search data source type cannot be changed; delete and recreate the source",
        }),
      )
    }
    const record = buildAiSearchSourceRecord(update, Option.some(existing.source))
    yield* this.updateCloudflareInstance(record)
    yield* this.putSourceRecord(record)
    return record
  })

  deleteSource = Effect.fn("db.aiSearch.deleteSource")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
  ) {
    const normalizedSourceId = normalizeAiSearchSourceId(sourceId)
    const existingPresence = yield* this.getSourceWithPresence(normalizedSourceId)
    const existing = yield* Option.match(existingPresence, {
      onNone: () =>
        Effect.fail(
          new AiSearchConfigurationError({
            message: `AI Search source '${normalizedSourceId}' does not exist`,
          }),
        ),
      onSome: (resolved) => Effect.succeed(resolved),
    })
    yield* this.deleteCloudflareInstance(existing.source.id)
    yield* this.c0Config.delete(C0_CONFIG_KEYS.aiSearch.source(normalizedSourceId))
  })

  listCloudflareInstances = Effect.fn("db.aiSearch.listCloudflareInstances")(
    function* (this: AiSearchRegistryStore) {
      if (!isRecordEnv(this.env)) {
        return []
      }
      const aiSearch = this.env.AI_SEARCH
      const response = yield* Effect.tryPromise({
        try: () => aiSearch.list({ per_page: 100 }),
        catch: toError,
      }).pipe(Effect.catch(() => Effect.succeed({ result: [] })))
      const result = isRecord(response) && Array.isArray(response.result) ? response.result : []
      return result
        .map(normalizeInstanceListItem)
        .filter((item): item is AiSearchInstanceListItem => item !== null)
    },
  )

  private createCloudflareInstance = Effect.fn("db.aiSearch.createCloudflareInstance")(function* (
    this: AiSearchRegistryStore,
    source: AiSearchSourceRecord,
  ) {
    if (!isRecordEnv(this.env)) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({
          message: "AI Search namespace binding is not configured",
        }),
      )
    }
    const aiSearch = this.env.AI_SEARCH
    yield* Effect.tryPromise({
      try: () => aiSearch.create(createInputFor(source, this.env.CF_AI_SEARCH_SERVICE_TOKEN_ID)),
      catch: (cause) =>
        new AiSearchConfigurationError({
          message: `Failed to create AI Search instance '${source.id}': ${describeError(cause)}`,
        }),
    })
  })

  private updateCloudflareInstance = Effect.fn("db.aiSearch.updateCloudflareInstance")(function* (
    this: AiSearchRegistryStore,
    source: AiSearchSourceRecord,
  ) {
    if (!isRecordEnv(this.env)) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({
          message: "AI Search namespace binding is not configured",
        }),
      )
    }
    const aiSearch = this.env.AI_SEARCH
    yield* Effect.tryPromise({
      try: () => aiSearch.get(source.id).update(updateInputFor(source)),
      catch: (cause) =>
        new AiSearchConfigurationError({
          message: `Failed to update AI Search instance '${source.id}': ${describeError(cause)}`,
        }),
    })
  })

  private deleteCloudflareInstance = Effect.fn("db.aiSearch.deleteCloudflareInstance")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
  ) {
    if (!isRecordEnv(this.env)) {
      return yield* Effect.fail(
        new AiSearchConfigurationError({
          message: "AI Search namespace binding is not configured",
        }),
      )
    }
    const aiSearch = this.env.AI_SEARCH
    yield* Effect.tryPromise({
      try: () => aiSearch.delete(sourceId),
      catch: (cause) =>
        new AiSearchConfigurationError({
          message: `Failed to delete AI Search instance '${sourceId}': ${describeError(cause)}`,
        }),
    })
  })

  private putSourceRecord = Effect.fn("db.aiSearch.putSourceRecord")(function* (
    this: AiSearchRegistryStore,
    source: AiSearchSourceRecord,
  ) {
    const existingSources = yield* this.listSources()
    ensureUniqueToolNames([
      ...existingSources.filter((existing) => existing.id !== source.id),
      source,
    ])
    yield* this.c0Config.putJson(C0_CONFIG_KEYS.aiSearch.source(source.id), source)
  })
}

export function getAiSearchMcpToolNames(source: Pick<AiSearchSourceRecord, "id">) {
  const suffix = source.id.replace(/-/g, "_")
  return {
    search: `search_${suffix}`,
    aiSearch: `ask_${suffix}`,
  }
}

export function toAiSearchSessionSource(source: AiSearchSourceRecord) {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    kind: AI_SEARCH_SESSION_TOOL_KIND,
  }
}
