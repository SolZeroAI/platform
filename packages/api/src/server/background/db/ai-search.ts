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
import { describeError, toError } from "../../lib/effect-errors"
import type { Env } from "../types"
import { isRecord, readArray, stringField } from "./record-fields"
import { S0_CONFIG_KEYS, S0ConfigStore } from "./s0-config"

export * from "./ai-search-records"

import {
  AiSearchConfigurationError,
  AiSearchSourceUnavailableError,
  buildAiSearchSourceRecord,
  readAiSearchSourceRecord,
  trimmedStringField,
  type AiSearchSourceRecord,
  type AiSearchSourceUpdate,
  type AiSearchSourceWithPresence,
  type AiSearchInstanceListItem,
} from "./ai-search-records"

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

function isDisposableInstance(
  instance: AiSearchInstance,
): instance is AiSearchInstance & Disposable {
  const handle: AiSearchInstance & Partial<Disposable> = instance

  return P.isFunction(handle[Symbol.dispose])
}

function createInputFor(source: AiSearchSourceRecord): AiSearchCreateInput {
  return { id: source.id, enable: source.enabled, max_num_results: source.maxResults }
}

function updateInputFor(source: AiSearchSourceRecord): AiSearchUpdateInput {
  return { enable: source.enabled, max_num_results: source.maxResults }
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

    return sources.filter((source) => source.enabled && source.dataSource.type === "built-in")
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
      "Legacy sources require explicit content migration to a new built-in source; existing content is retained",
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

  builtInInstance = Effect.fn("db.aiSearch.builtInInstance")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
  ) {
    const presence = yield* this.getSourceWithPresence(sourceId)
    const existing = yield* requireExistingSource(presence, sourceId)

    yield* ensureAiSearch(
      existing.source.dataSource.type === "built-in",
      "This legacy source requires an explicit content migration to built-in storage before use",
    )

    const namespace = yield* aiSearchNamespace(this.env)

    return namespace.get(existing.source.id)
  })

  listItems = Effect.fn("db.aiSearch.listItems")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
    page = 1,
  ) {
    yield* ensureAiSearch(Number.isInteger(page) && page > 0, "Page must be a positive integer")

    const instance = yield* this.builtInInstance(sourceId)

    return yield* Effect.tryPromise({
      try: () => instance.items.list({ page, per_page: 50 }),
      catch: toError,
    })
  })

  uploadItem = Effect.fn("db.aiSearch.uploadItem")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
    name: string,
    content: Blob | string,
  ) {
    yield* ensureAiSearch(
      name.trim().length > 0 && name.length <= 128,
      "Item name must contain 1 to 128 characters",
    )

    const size = Match.value(content).pipe(
      Match.when(P.isString, (text) => new TextEncoder().encode(text).length),
      Match.orElse((blob) => blob.size),
    )

    yield* ensureAiSearch(
      size > 0 && size <= 10 * 1024 * 1024,
      "Item must contain 1 byte to 10 MiB",
    )

    const instance = yield* this.builtInInstance(sourceId)

    return yield* Effect.tryPromise({
      try: () => instance.items.upload(name, content),
      catch: toError,
    })
  })

  deleteItem = Effect.fn("db.aiSearch.deleteItem")(function* (
    this: AiSearchRegistryStore,
    sourceId: string,
    itemId: string,
  ) {
    const instance = yield* this.builtInInstance(sourceId)

    yield* Effect.tryPromise({ try: () => instance.items.delete(itemId), catch: toError })
  })

  private createCloudflareInstance = Effect.fn("db.aiSearch.createCloudflareInstance")(function* (
    this: AiSearchRegistryStore,
    source: AiSearchSourceRecord,
  ) {
    const aiSearch = yield* aiSearchNamespace(this.env)

    const instance = yield* Effect.tryPromise({
      try: () => aiSearch.create(createInputFor(source)),
      catch: (cause) =>
        new AiSearchConfigurationError({
          message: `Failed to create AI Search instance '${source.id}': ${describeError(cause)}`,
        }),
    })

    // Release a remote RPC handle rather than retaining it until garbage collection.
    yield* Effect.try({
      try: () =>
        Option.map(Option.liftPredicate(instance, isDisposableInstance), (handle) =>
          handle[Symbol.dispose](),
        ),
      catch: toError,
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
