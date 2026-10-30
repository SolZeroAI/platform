import {
  AI_SEARCH_SESSION_TOOL_KIND,
  getSelectedAiSearchSourceIds,
  normalizeAiSearchSourceId,
  type SessionToolSpec,
} from "@solzero/shared"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { describeError, toError } from "../../lib/effect-errors"
import type { Env } from "../types"
import {
  booleanField,
  isRecord,
  nonBlankStringField,
  numberField,
  readArray,
  readStringArray,
  stringField,
} from "./record-fields"
import { S0_CONFIG_KEYS, S0ConfigStore } from "./s0-config"

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

export class AiSearchConfigurationError extends Schema.TaggedError<AiSearchConfigurationError>()(
  "AiSearchConfigurationError",
  {
    message: Schema.String,
  },
) {}

export class AiSearchSourceUnavailableError extends Schema.TaggedError<AiSearchSourceUnavailableError>()(
  "AiSearchSourceUnavailableError",
  {
    sourceIds: Schema.Array(Schema.String),
  },
) {}

function trimmedStringField(record: Record<string, unknown>, key: string) {
  return Option.getOrNull(Option.map(nonBlankStringField(record, key), (value) => value.trim()))
}

function normalizeStringList(values: readonly string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function isValidMaxResults(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 20
}

function requireConfiguration<A>(value: A, valid: (value: A) => boolean, message: string): A {
  return Option.liftPredicate(value, valid).pipe(
    Option.getOrThrowWith(() => new AiSearchConfigurationError({ message })),
  )
}

function normalizeMaxResults(value: number | null | undefined): number {
  return Option.fromNullishOr(value).pipe(
    Option.map((resolved) =>
      requireConfiguration(
        resolved,
        isValidMaxResults,
        "AI Search max results must be an integer between 1 and 20",
      ),
    ),
    Option.getOrElse(() => DEFAULT_AI_SEARCH_MAX_RESULTS),
  )
}

function normalizeDomain(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")

  return requireConfiguration(trimmed, (domain) => domain.length > 0, "Website domain is required")
}

function normalizeDataSource(dataSource: AiSearchDataSourceRecord): AiSearchDataSourceRecord {
  return Match.value(dataSource).pipe(
    Match.discriminatorsExhaustive("type")({
      "built-in": (): AiSearchDataSourceRecord => ({ type: "built-in" }),
      r2: (r2): AiSearchDataSourceRecord => ({
        type: "r2",
        bucketName: r2.bucketName.trim(),
        prefix: r2.prefix?.trim() || null,
        r2Jurisdiction: r2.r2Jurisdiction?.trim() || null,
      }),
      website: (website): AiSearchDataSourceRecord => ({
        type: "website",
        domain: normalizeDomain(website.domain),
        includePaths: normalizeStringList(website.includePaths),
        excludePaths: normalizeStringList(website.excludePaths),
        specificSitemaps: normalizeStringList(website.specificSitemaps),
        useBrowserRendering: Boolean(website.useBrowserRendering),
        includeImages: Boolean(website.includeImages),
      }),
    }),
  )
}

function hasRequiredDataSourceFields(dataSource: AiSearchDataSourceRecord) {
  return dataSource.type !== "r2" || dataSource.bucketName.trim().length > 0
}

function dataSourceFromRecord(value: Record<string, unknown>) {
  return Match.value(stringField(value, "type")).pipe(
    Match.when("built-in", () => Option.some<AiSearchDataSourceRecord>({ type: "built-in" })),
    Match.when("r2", () =>
      Option.some<AiSearchDataSourceRecord>({
        type: "r2",
        bucketName: stringField(value, "bucketName"),
        prefix: trimmedStringField(value, "prefix"),
        r2Jurisdiction: trimmedStringField(value, "r2Jurisdiction"),
      }),
    ),
    Match.when("website", () =>
      Option.some<AiSearchDataSourceRecord>({
        type: "website",
        domain: stringField(value, "domain"),
        includePaths: readStringArray(value.includePaths),
        excludePaths: readStringArray(value.excludePaths),
        specificSitemaps: readStringArray(value.specificSitemaps),
        useBrowserRendering: booleanField(value, "useBrowserRendering", false),
        includeImages: booleanField(value, "includeImages", false),
      }),
    ),
    Match.orElse(() => Option.none<AiSearchDataSourceRecord>()),
  )
}

function aiSearchSourceFromRecord(
  record: Record<string, unknown>,
  dataSource: AiSearchDataSourceRecord,
): AiSearchSourceRecord {
  const id = normalizeAiSearchSourceId(stringField(record, "id"))
  const now = Date.now()

  return {
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
  }
}

export function readAiSearchSourceRecord(value: unknown): Option.Option<AiSearchSourceRecord> {
  return Option.liftPredicate(value, isRecord).pipe(
    Option.flatMap((record) =>
      Option.liftPredicate(record.dataSource, isRecord).pipe(
        Option.flatMap(dataSourceFromRecord),
        Option.map((dataSource) => aiSearchSourceFromRecord(record, dataSource)),
      ),
    ),
  )
}

function buildAiSearchSourceRecord(
  update: AiSearchSourceUpdate,
  existing: Option.Option<AiSearchSourceRecord>,
): AiSearchSourceRecord {
  const id = normalizeAiSearchSourceId(update.id)

  const dataSource = requireConfiguration(
    normalizeDataSource(update.dataSource),
    hasRequiredDataSourceFields,
    "R2 bucket name is required",
  )

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

function searchToolName(source: AiSearchSourceRecord) {
  return getAiSearchMcpToolNames(source).search
}

function failDuplicateToolNames(existingId: string, sourceId: string): never {
  throw new AiSearchConfigurationError({
    message: `AI Search source IDs '${existingId}' and '${sourceId}' generate the same MCP tool names`,
  })
}

function ensureUniqueToolNames(sources: readonly AiSearchSourceRecord[]) {
  // Reversed, so the first source that claims a tool name owns it.
  const owners = new Map(
    [...sources].reverse().map((source) => [searchToolName(source), source.id] as const),
  )

  const owner = (source: AiSearchSourceRecord) => owners.get(searchToolName(source)) ?? source.id

  Option.match(
    Arr.findFirst(sources, (source) => owner(source) !== source.id),
    {
      onNone: () => undefined,
      onSome: (source) => failDuplicateToolNames(owner(source), source.id),
    },
  )
}

type AiSearchNamespace = NonNullable<Env["AI_SEARCH"]>

type AiSearchCreateInput = Parameters<AiSearchNamespace["create"]>[0]

type AiSearchInstance = ReturnType<AiSearchNamespace["get"]>

type AiSearchUpdateInput = Parameters<AiSearchInstance["update"]>[0]

interface R2SourceParams {
  prefix?: string
  r2_jurisdiction?: string
}

interface WebsiteSourceParams {
  include_items?: string[]
  exclude_items?: string[]
  web_crawler: {
    parse_type: "sitemap"
    parse_options: {
      include_images: boolean
      use_browser_rendering: boolean
      specific_sitemaps?: string[]
    }
  }
}

function nonEmptyText(value: string | null) {
  return Option.fromNullishOr(value).pipe(Option.filter((text) => text.length > 0))
}

function nonEmptyList(values: readonly string[]) {
  return Option.liftPredicate(values, Arr.isReadonlyArrayNonEmpty)
}

function r2SourceParams(dataSource: AiSearchR2DataSourceRecord): R2SourceParams {
  return {
    ...Option.match(nonEmptyText(dataSource.prefix), {
      onNone: () => ({}),
      onSome: (prefix) => ({ prefix }),
    }),
    ...Option.match(nonEmptyText(dataSource.r2Jurisdiction), {
      onNone: () => ({}),
      onSome: (jurisdiction) => ({ r2_jurisdiction: jurisdiction }),
    }),
  }
}

function websiteSourceParams(dataSource: AiSearchWebsiteDataSourceRecord): WebsiteSourceParams {
  return {
    web_crawler: {
      parse_type: "sitemap",
      parse_options: {
        include_images: dataSource.includeImages,
        use_browser_rendering: dataSource.useBrowserRendering,
        ...Option.match(nonEmptyList(dataSource.specificSitemaps), {
          onNone: () => ({}),
          onSome: (sitemaps) => ({ specific_sitemaps: [...sitemaps] }),
        }),
      },
    },
    ...Option.match(nonEmptyList(dataSource.includePaths), {
      onNone: () => ({}),
      onSome: (paths) => ({ include_items: [...paths] }),
    }),
    ...Option.match(nonEmptyList(dataSource.excludePaths), {
      onNone: () => ({}),
      onSome: (paths) => ({ exclude_items: [...paths] }),
    }),
  }
}

function sourceParamsFor(dataSource: AiSearchDataSourceRecord) {
  return Match.value(dataSource).pipe(
    Match.discriminatorsExhaustive("type")({
      "built-in": () => undefined,
      r2: r2SourceParams,
      website: websiteSourceParams,
    }),
  )
}

function createInputFor(
  source: AiSearchSourceRecord,
  tokenId?: string | null,
): AiSearchCreateInput {
  const base = {
    id: source.id,
    enable: source.enabled,
    max_num_results: source.maxResults,
    ...Option.match(nonEmptyText(tokenId?.trim() ?? null), {
      onNone: () => ({}),
      onSome: (token) => ({ token_id: token }),
    }),
  }

  // SAFETY: each branch builds the AiSearchCreateInput variant for its data source type.
  return Match.value(source.dataSource).pipe(
    Match.discriminatorsExhaustive("type")({
      "built-in": () => base as AiSearchCreateInput,
      r2: (r2) =>
        ({
          ...base,
          type: "r2",
          source: r2.bucketName,
          source_params: sourceParamsFor(r2),
        }) as AiSearchCreateInput,
      website: (website) =>
        ({
          ...base,
          type: "web-crawler",
          source: website.domain,
          source_params: sourceParamsFor(website),
        }) as AiSearchCreateInput,
    }),
  )
}

function updateInputFor(source: AiSearchSourceRecord): AiSearchUpdateInput {
  const update = {
    enable: source.enabled,
    max_num_results: source.maxResults,
  }

  const withParams = {
    ...sourceFields(update, source),
    ...Option.match(Option.fromUndefinedOr(sourceParamsFor(source.dataSource)), {
      onNone: () => ({}),
      onSome: (sourceParams) => ({ source_params: sourceParams }),
    }),
  }

  // SAFETY: Cloudflare AI Search update accepts this enable, source, and source_params bag. Absent fields stay omitted.
  return withParams as AiSearchUpdateInput
}

function sourceFields(
  update: { enable: boolean; max_num_results: number },
  source: AiSearchSourceRecord,
) {
  return Match.value(source.dataSource).pipe(
    Match.discriminatorsExhaustive("type")({
      "built-in": () => update,
      r2: (r2) => ({ ...update, source: r2.bucketName }),
      website: (website) => ({ ...update, source: website.domain }),
    }),
  )
}

function normalizeInstanceListItem(item: unknown): Option.Option<AiSearchInstanceListItem> {
  return Option.liftPredicate(item, isRecord).pipe(
    Option.map((record) => ({
      id: stringField(record, "id"),
      type: trimmedStringField(record, "type"),
      source: trimmedStringField(record, "source"),
      status: trimmedStringField(record, "status"),
      enabled: Option.getOrNull(Option.liftPredicate(record.enable, P.isBoolean)),
      namespace: trimmedStringField(record, "namespace"),
      createdAt: trimmedStringField(record, "created_at"),
      modifiedAt: trimmedStringField(record, "modified_at"),
    })),
  )
}

function aiSearchNamespace(env: Env) {
  return Effect.fromOption(Option.fromNullishOr(env.AI_SEARCH)).pipe(
    Effect.mapError(
      () =>
        new AiSearchConfigurationError({
          message: "AI Search namespace binding is not configured",
        }),
    ),
  )
}

function ensureAiSearch(valid: boolean, message: string) {
  return Effect.fromResult(
    Result.liftPredicate(
      valid,
      (passed) => passed,
      () => new AiSearchConfigurationError({ message }),
    ),
  )
}

function requireExistingSource(
  presence: Option.Option<AiSearchSourceWithPresence>,
  sourceId: string,
) {
  return Effect.fromOption(presence).pipe(
    Effect.mapError(
      () =>
        new AiSearchConfigurationError({
          message: `AI Search source '${sourceId}' does not exist`,
        }),
    ),
  )
}

function listInstanceResponse(aiSearch: AiSearchNamespace) {
  return Effect.tryPromise({
    try: () => aiSearch.list({ per_page: 100 }),
    catch: toError,
  }).pipe(Effect.catch(() => Effect.succeed({ result: [] })))
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
  readonly s0Config: S0ConfigStore

  constructor(readonly env: Env) {
    this.s0Config = new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
  }

  getSourceWithPresence = Effect.fn("db.aiSearch.getSourceWithPresence")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
  ) {
    const normalizedSourceId = normalizeAiSearchSourceId(sourceId)
    const value = yield* this.s0Config.getJson(S0_CONFIG_KEYS.aiSearch.source(normalizedSourceId))

    return Option.flatMap(value, (resolved) =>
      sourcePresenceOption(resolved, {
        recordSource: "kv" as const,
        locked: false,
        envVarName: null,
      }),
    )
  })

  listSourcesWithPresence = Effect.fn("db.aiSearch.listSourcesWithPresence")(function* (
    this: AiSearchRegistryStore,
  ) {
    const kvKeys = yield* this.s0Config.listKeys(S0_CONFIG_KEYS.aiSearch.sourcePrefix)

    const kvSourceOptions = yield* Effect.forEach(
      kvKeys,
      (key) =>
        this.s0Config.getJson(key).pipe(
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

    const sources = Arr.getSomes(kvSourceOptions)
    ensureUniqueToolNames(sources.map((source) => source.source))

    return sources.sort((left, right) => left.source.label.localeCompare(right.source.label))
  })

  listSources = Effect.fn("db.aiSearch.listSources")(function* (this: AiSearchRegistryStore) {
    const sources = yield* this.listSourcesWithPresence()

    return sources.map((source) => source.source)
  })

  listAvailableSources = Effect.fn("db.aiSearch.listAvailableSources")(function* (
    this: AiSearchRegistryStore,
  ) {
    const sources = yield* this.listSources()

    return sources.filter((source) => source.enabled)
  })

  listAvailableSourcesByIds = Effect.fn("db.aiSearch.listAvailableSourcesByIds")(function* (
    this: AiSearchRegistryStore,
    sourceIds: readonly string[],
  ) {
    const uniqueIds = [...new Set(sourceIds.map(normalizeAiSearchSourceId))]

    return yield* Option.match(Option.liftPredicate(uniqueIds, Arr.isArrayNonEmpty), {
      onNone: () => Effect.succeed([]),
      onSome: (ids) => this.listAvailableSourcesInOrder(ids),
    })
  })

  private listAvailableSourcesInOrder = Effect.fn("db.aiSearch.listAvailableSourcesInOrder")(
    function* (this: AiSearchRegistryStore, sourceIds: readonly string[]) {
      const available = yield* this.listAvailableSources()
      const byId = new Map(available.map((source) => [source.id, source]))

      return Arr.getSomes(sourceIds.map((sourceId) => Option.fromUndefinedOr(byId.get(sourceId))))
    },
  )

  listSelectedAvailableSources = Effect.fn("db.aiSearch.listSelectedAvailableSources")(function* (
    this: AiSearchRegistryStore,
    tools: readonly SessionToolSpec[] | null | undefined,
  ) {
    const selectedSourceIds = getSelectedAiSearchSourceIds(tools)
    const sources = yield* this.listAvailableSourcesByIds(selectedSourceIds)
    const availableIds = new Set(sources.map((source) => source.id))
    const missingIds = selectedSourceIds.filter((sourceId) => !availableIds.has(sourceId))

    yield* Effect.fromResult(
      Result.liftPredicate(
        missingIds,
        Arr.isArrayEmpty,
        (sourceIds) => new AiSearchSourceUnavailableError({ sourceIds }),
      ),
    )

    return sources
  })

  createSource = Effect.fn("db.aiSearch.createSource")(function* (
    this: AiSearchRegistryStore,
    update: AiSearchSourceUpdate,
  ) {
    const sourceId = normalizeAiSearchSourceId(update.id)
    const existing = yield* this.getSourceWithPresence(sourceId)

    yield* ensureAiSearch(Option.isNone(existing), `AI Search source '${sourceId}' already exists`)

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

    const existing = yield* requireExistingSource(existingPresence, normalizedSourceId)

    yield* ensureAiSearch(update.id === normalizedSourceId, "AI Search source id cannot be changed")
    yield* ensureAiSearch(
      update.dataSource.type === existing.source.dataSource.type,
      "AI Search data source type cannot be changed; delete and recreate the source",
    )

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

    const existing = yield* requireExistingSource(existingPresence, normalizedSourceId)

    yield* this.deleteCloudflareInstance(existing.source.id)
    yield* this.s0Config.delete(S0_CONFIG_KEYS.aiSearch.source(normalizedSourceId))
  })

  listCloudflareInstances = Effect.fn("db.aiSearch.listCloudflareInstances")(function* (
    this: AiSearchRegistryStore,
  ) {
    const response = yield* Effect.transposeOption(
      Option.map(Option.fromNullishOr(this.env.AI_SEARCH), listInstanceResponse),
    )

    const result = response.pipe(
      Option.filter(isRecord),
      Option.map((record) => readArray(record.result)),
      Option.getOrElse(() => []),
    )

    return Arr.getSomes(result.map(normalizeInstanceListItem))
  })

  private createCloudflareInstance = Effect.fn("db.aiSearch.createCloudflareInstance")(function* (
    this: AiSearchRegistryStore,
    source: AiSearchSourceRecord,
  ) {
    const aiSearch = yield* aiSearchNamespace(this.env)
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
    const aiSearch = yield* aiSearchNamespace(this.env)
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
    const aiSearch = yield* aiSearchNamespace(this.env)
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
    yield* this.s0Config.putJson(S0_CONFIG_KEYS.aiSearch.source(source.id), source)
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
