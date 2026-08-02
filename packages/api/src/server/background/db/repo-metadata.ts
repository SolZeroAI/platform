import { asc, and, eq } from "drizzle-orm"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { parseJson, stringifyJson } from "../../lib/json"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { repoMetadata } from "../../effect/db/schema"
import { d1Error } from "./errors"

export interface RepoMetadata {
  description?: string
  aliases?: string[]
  channelAssociations?: string[]
  keywords?: string[]
}

interface RepoMetadataRow {
  description: string | null
  aliases: string | null
  channelAssociations: string | null
  keywords: string | null
}

function stringifyOption(value: unknown): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(Boolean),
    Option.map((resolved) => stringifyJson(resolved)),
  )
}

function normalizeRepoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`
}

function parseStringArrayOption(value: string | null): Option.Option<string[]> {
  return Option.fromNullishOr(value).pipe(
    Option.filter((raw) => raw.length > 0),
    Option.map((raw) => parseJson(raw) as string[]),
  )
}

function toMetadata(row: RepoMetadataRow): RepoMetadata {
  return {
    description: row.description ?? undefined,
    aliases: Option.getOrUndefined(parseStringArrayOption(row.aliases)),
    channelAssociations: Option.getOrUndefined(parseStringArrayOption(row.channelAssociations)),
    keywords: Option.getOrUndefined(parseStringArrayOption(row.keywords)),
  }
}

export class RepoMetadataStore {
  private readonly drizzle

  constructor(private readonly db: D1Database) {
    this.drizzle = makeD1Drizzle(db)
  }

  upsert = Effect.fn("db.repoMetadata.upsert")(function* (
    this: RepoMetadataStore,
    repoOwner: string,
    repoName: string,
    metadata: RepoMetadata,
  ) {
    const now = Date.now()
    const owner = repoOwner.toLowerCase()
    const name = repoName.toLowerCase()
    const existing = yield* this.getRow(owner, name)
    const createdAt = Option.getOrElse(
      Option.map(existing, (row) => row.createdAt),
      () => now,
    )
    const aliases = Option.getOrNull(stringifyOption(metadata.aliases))
    const channelAssociations = Option.getOrNull(stringifyOption(metadata.channelAssociations))
    const keywords = Option.getOrNull(stringifyOption(metadata.keywords))
    const description = metadata.description ?? null

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(repoMetadata)
          .values({
            repoOwner: owner,
            repoName: name,
            description,
            aliases,
            channelAssociations,
            keywords,
            createdAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [repoMetadata.repoOwner, repoMetadata.repoName],
            set: {
              description,
              aliases,
              channelAssociations,
              keywords,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.repoMetadata.upsert"),
    })
  })

  get = Effect.fn("db.repoMetadata.get")(function* (
    this: RepoMetadataStore,
    repoOwner: string,
    repoName: string,
  ) {
    const row = yield* this.getRow(repoOwner.toLowerCase(), repoName.toLowerCase())
    return Option.map(row, toMetadata)
  })

  getBatch = Effect.fn("db.repoMetadata.getBatch")(function* (
    this: RepoMetadataStore,
    repos: Array<{ owner: string; name: string }>,
  ) {
    const normalizedRepos = Arr.dedupeWith(
      repos.map((repo) => ({ owner: repo.owner.toLowerCase(), name: repo.name.toLowerCase() })),
      (left, right) =>
        normalizeRepoKey(left.owner, left.name) === normalizeRepoKey(right.owner, right.name),
    )

    const entries = yield* Effect.forEach(normalizedRepos, (repo) =>
      this.getRow(repo.owner, repo.name).pipe(
        Effect.map((row) =>
          Option.map(
            row,
            (resolved) => [normalizeRepoKey(repo.owner, repo.name), toMetadata(resolved)] as const,
          ),
        ),
      ),
    )

    return new Map(Arr.getSomes(entries))
  })

  list = Effect.fn("db.repoMetadata.list")(function* (this: RepoMetadataStore) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(repoMetadata)
          .orderBy(asc(repoMetadata.repoOwner), asc(repoMetadata.repoName)),
      catch: d1Error("db.repoMetadata.list"),
    })

    return rows.map((row) => ({
      repoOwner: row.repoOwner,
      repoName: row.repoName,
      metadata: toMetadata(row),
    }))
  })

  private getRow = Effect.fn("db.repoMetadata.getRow")(function* (
    this: RepoMetadataStore,
    repoOwner: string,
    repoName: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(repoMetadata)
          .where(and(eq(repoMetadata.repoOwner, repoOwner), eq(repoMetadata.repoName, repoName)))
          .limit(1),
      catch: d1Error("db.repoMetadata.get"),
    })
    return Option.fromNullishOr(rows[0])
  })
}
