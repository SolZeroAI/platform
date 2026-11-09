import { normalizeAiSearchSourceId } from "@solzero/shared"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  booleanField,
  isRecord,
  nonBlankStringField,
  numberField,
  readStringArray,
  stringField,
} from "./record-fields"

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

export function trimmedStringField(record: Record<string, unknown>, key: string) {
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

export function buildAiSearchSourceRecord(
  update: AiSearchSourceUpdate,
  existing: Option.Option<AiSearchSourceRecord>,
): AiSearchSourceRecord {
  const id = normalizeAiSearchSourceId(update.id)

  const dataSource = requireConfiguration(
    normalizeDataSource(update.dataSource),
    (source) => source.type === "built-in",
    "Only built-in storage is supported. Export and migrate legacy content explicitly.",
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
