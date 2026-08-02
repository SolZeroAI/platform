import { and, asc, eq, sql, type SQL } from "drizzle-orm"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import { parseJsonArray, stringifyJson } from "../../lib/json"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { globalSecrets } from "../../effect/db/schema"
import { decryptSecret, encryptSecret } from "../auth/crypto"
import { d1Error, type D1Error } from "./errors"

const MCPCF_KEY_PREFIX = "mcpcf/"
const LIKE_ESCAPE_CHAR = "\\"

// Locale-aware string ordering preserves the existing `localeCompare`-based tag sorting exactly.
const localeStringOrder: Order.Order<string> = (left, right) =>
  Math.sign(left.localeCompare(right)) as -1 | 0 | 1

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`)
}

function keyLike(pattern: string): SQL {
  return sql`${globalSecrets.key} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
}

function keyNotLike(pattern: string): SQL {
  return sql`${globalSecrets.key} NOT LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
}

function tagsContainAny(tags: readonly string[]): SQL {
  const list = sql.join(
    tags.map((tag) => sql`${tag}`),
    sql`, `,
  )
  return sql`EXISTS (SELECT 1 FROM json_each(${globalSecrets.tags}) WHERE value IN (${list}))`
}

export type SecretMetadata = {
  key: string
  tags: string[]
}

export type SecretScopeOptions = {
  userId?: string
  includeMcpcfManaged?: boolean
}

export type SecretWriteEntry = {
  key: string
  value?: string
  tags?: readonly string[]
}

type SecretWriteOutcome = "created" | "updated" | "skipped"

function parseTags(value: string | null | undefined): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === "string")
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  const normalized = new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))
  return [...normalized].sort()
}

const popularTagOrder = Order.combine(
  Order.mapInput(Order.flip(Order.Number), (entry: readonly [string, number]) => entry[1]),
  Order.mapInput(localeStringOrder, (entry: readonly [string, number]) => entry[0]),
)

const tagStatOrder = Order.combine(
  Order.mapInput(Order.flip(Order.Number), (row: { tag: string; count: number }) => row.count),
  Order.mapInput(localeStringOrder, (row: { tag: string; count: number }) => row.tag),
)

export function rankPopularTags(secrets: readonly SecretMetadata[], limit = 5): string[] {
  const counts = new Map<string, number>()
  secrets.forEach((secret) =>
    secret.tags.forEach((tag) => {
      const trimmed = tag.trim()
      Option.match(Option.fromNullishOr(trimmed).pipe(Option.filter(Boolean)), {
        onNone: () => undefined,
        onSome: (value) => counts.set(value, (counts.get(value) ?? 0) + 1),
      })
    }),
  )
  return [...counts.entries()]
    .sort(popularTagOrder)
    .slice(0, limit)
    .map(([tag]) => tag)
}

export function filterSecretMetadata(
  secrets: readonly SecretMetadata[],
  options?: { q?: string; tags?: readonly string[] },
): SecretMetadata[] {
  const query = options?.q?.trim().toLowerCase()
  const selectedTags = normalizeTags(options?.tags)
  const selected = new Set(selectedTags)
  return secrets.filter(
    (secret) =>
      (!query || secret.key.toLowerCase().includes(query)) &&
      (selectedTags.length === 0 || secret.tags.some((tag) => selected.has(tag))),
  )
}

export class GlobalSecretsStore {
  private readonly drizzle

  constructor(
    private readonly db: D1Database,
    private readonly encryptionKey: string,
  ) {
    this.drizzle = makeD1Drizzle(db)
  }

  private getUserSecretPrefix(userId: string): string {
    return `user:${encodeURIComponent(userId)}:`
  }

  private getSecretKey(key: string, options?: { userId?: string }): string {
    return Option.match(Option.fromNullishOr(options?.userId), {
      onNone: () => key,
      onSome: (userId) => `${this.getUserSecretPrefix(userId)}${key}`,
    })
  }

  private stripSecretKey(key: string, options?: { userId?: string }): string {
    return Option.match(Option.fromNullishOr(options?.userId), {
      onNone: () => key,
      onSome: (userId) => key.slice(this.getUserSecretPrefix(userId).length),
    })
  }

  setSecrets = Effect.fn("db.globalSecrets.setSecrets")(function* (
    this: GlobalSecretsStore,
    secrets: Record<string, string> | readonly SecretWriteEntry[],
    options?: { userId?: string },
  ) {
    const now = Date.now()
    const entries: SecretWriteEntry[] = Match.value(Array.isArray(secrets)).pipe(
      Match.when(true, () => [...(secrets as readonly SecretWriteEntry[])]),
      Match.orElse(() =>
        Object.entries(secrets as Record<string, string>).map(([key, value]) => ({ key, value })),
      ),
    )

    // Process sequentially: duplicate keys within an entry list resolve to the same scoped row,
    // whose read-then-write must stay ordered.
    const outcomes = yield* Effect.forEach(entries, (entry) =>
      this.writeSecretEntry(entry, now, options),
    )

    return {
      keys: entries.map((entry) => entry.key),
      created: outcomes.filter((outcome) => outcome === "created").length,
      updated: outcomes.filter((outcome) => outcome === "updated").length,
    }
  })

  private writeSecretEntry = Effect.fn("db.globalSecrets.writeSecretEntry")(function* (
    this: GlobalSecretsStore,
    entry: SecretWriteEntry,
    now: number,
    options?: { userId?: string },
  ) {
    const scopedKey = this.getSecretKey(entry.key, options)
    const existing = yield* this.getGlobalSecret(scopedKey)
    const skip = entry.value === undefined && Option.isNone(existing)
    return yield* Match.value(skip).pipe(
      Match.when(true, () => Effect.succeed<SecretWriteOutcome>("skipped")),
      Match.orElse(() => this.persistSecretEntry(scopedKey, entry, now, existing)),
    )
  })

  private persistSecretEntry = Effect.fn("db.globalSecrets.persistSecretEntry")(function* (
    this: GlobalSecretsStore,
    scopedKey: string,
    entry: SecretWriteEntry,
    now: number,
    existing: Option.Option<typeof globalSecrets.$inferSelect>,
  ) {
    const existingEncrypted = Option.getOrUndefined(
      Option.map(existing, (row) => row.encryptedValue),
    )
    const encrypted = yield* Option.match(Option.fromNullishOr(entry.value), {
      onNone: () => Effect.succeed(existingEncrypted),
      onSome: (plaintext) =>
        encryptSecret(plaintext, this.encryptionKey).pipe(
          Effect.mapError(d1Error("db.globalSecrets.setSecrets")),
        ),
    })
    const tagsJson = Option.match(Option.fromNullishOr(entry.tags), {
      onNone: () =>
        Option.getOrElse(
          Option.map(existing, (row) => row.tags),
          () => "[]",
        ),
      onSome: (tags) => stringifyJson(normalizeTags(tags)),
    })

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(globalSecrets)
          .values({
            key: scopedKey,
            encryptedValue: encrypted ?? "",
            tags: tagsJson,
            createdAt: Option.getOrElse(
              Option.map(existing, (row) => row.createdAt),
              () => now,
            ),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: globalSecrets.key,
            set: {
              encryptedValue: encrypted ?? existingEncrypted ?? "",
              tags: tagsJson,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.globalSecrets.setSecrets"),
    })

    return Option.match(existing, {
      onNone: () => "created" as const,
      onSome: () => "updated" as const,
    })
  })

  listSecretTagStats = Effect.fn("db.globalSecrets.listSecretTagStats")(function* (
    this: GlobalSecretsStore,
    options?: SecretScopeOptions & { popularLimit?: number },
  ) {
    const prefix = this.resolvePrefix(options)
    const counts = yield* this.aggregateTags(prefix, options)
    const limit = options?.popularLimit ?? 5
    const popularTags = Arr.sort(counts, tagStatOrder)
      .slice(0, limit)
      .map((row) => row.tag)
    return {
      tags: counts.map((row) => row.tag),
      popularTags,
    }
  })

  listSecrets = Effect.fn("db.globalSecrets.listSecrets")(function* (
    this: GlobalSecretsStore,
    options?: SecretScopeOptions & { q?: string; tags?: readonly string[] },
  ) {
    const prefix = this.resolvePrefix(options)
    const secrets = yield* this.querySecrets(options)
    const tagRows = yield* this.aggregateTags(prefix, options)
    return {
      secrets,
      tags: tagRows.map((row) => row.tag),
    }
  })

  listSecretKeys = Effect.fn("db.globalSecrets.listSecretKeys")(function* (
    this: GlobalSecretsStore,
    options?: SecretScopeOptions,
  ) {
    const secrets = yield* this.querySecrets(options)
    return secrets.map((item) => item.key)
  })

  private resolvePrefix(options?: { userId?: string }): Option.Option<string> {
    return Option.map(Option.fromNullishOr(options?.userId), (userId) =>
      this.getUserSecretPrefix(userId),
    )
  }

  private buildScopeConditions(
    prefix: Option.Option<string>,
    options?: Pick<SecretScopeOptions, "includeMcpcfManaged">,
  ): SQL[] {
    const escapedPrefix = Option.match(prefix, {
      onNone: () => "",
      onSome: escapeLikePattern,
    })
    const prefixConditions = Option.match(prefix, {
      onNone: () => [] as SQL[],
      onSome: () => [keyLike(`${escapedPrefix}%`)],
    })
    const mcpcfExclusion = Match.value(options?.includeMcpcfManaged === true).pipe(
      Match.when(true, () => [] as SQL[]),
      Match.orElse(() => [keyNotLike(`${escapedPrefix}${escapeLikePattern(MCPCF_KEY_PREFIX)}%`)]),
    )
    return [...prefixConditions, ...mcpcfExclusion]
  }

  private querySecrets = Effect.fn("db.globalSecrets.querySecrets")(function* (
    this: GlobalSecretsStore,
    options?: SecretScopeOptions & { q?: string; tags?: readonly string[] },
  ) {
    const prefix = this.resolvePrefix(options)
    const escapedPrefix = Option.match(prefix, {
      onNone: () => "",
      onSome: escapeLikePattern,
    })
    const conditions = this.buildScopeConditions(prefix, options)

    Option.match(Option.fromNullishOr(options?.q?.trim()).pipe(Option.filter(Boolean)), {
      onNone: () => undefined,
      onSome: (query) => {
        conditions.push(keyLike(`${escapedPrefix}%${escapeLikePattern(query)}%`))
      },
    })

    const selectedTags = normalizeTags(options?.tags)
    Match.value(selectedTags.length > 0).pipe(
      Match.when(true, () => {
        conditions.push(tagsContainAny(selectedTags))
      }),
      Match.orElse(() => undefined),
    )

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ key: globalSecrets.key, tags: globalSecrets.tags })
          .from(globalSecrets)
          .where(and(...conditions))
          .orderBy(asc(globalSecrets.key)),
      catch: d1Error("db.globalSecrets.listSecrets"),
    })

    return rows.map((item) => ({
      key: this.stripSecretKey(item.key, options),
      tags: parseTags(item.tags),
    }))
  })

  private aggregateTags = Effect.fn("db.globalSecrets.aggregateTags")(function* (
    this: GlobalSecretsStore,
    prefix: Option.Option<string>,
    options?: Pick<SecretScopeOptions, "includeMcpcfManaged">,
  ) {
    const where = and(...this.buildScopeConditions(prefix, options))
    return yield* Effect.tryPromise({
      try: () =>
        this.drizzle.all<{ tag: string; count: number }>(sql`
      SELECT json_each.value AS tag, COUNT(*) AS count
      FROM ${globalSecrets}, json_each(${globalSecrets.tags})
      WHERE ${where}
      GROUP BY json_each.value
      ORDER BY json_each.value ASC
    `),
      catch: d1Error("db.globalSecrets.listSecrets"),
    })
  })

  deleteSecret = Effect.fn("db.globalSecrets.deleteSecret")(function* (
    this: GlobalSecretsStore,
    key: string,
    options?: { userId?: string },
  ) {
    const deleted = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(globalSecrets)
          .where(eq(globalSecrets.key, this.getSecretKey(key, options)))
          .returning({ key: globalSecrets.key }),
      catch: d1Error("db.globalSecrets.deleteSecret"),
    })
    return deleted.length > 0
  })

  getDecryptedSecrets = Effect.fn("db.globalSecrets.getDecryptedSecrets")(function* (
    this: GlobalSecretsStore,
    options?: { userId?: string },
  ) {
    const prefix = this.resolvePrefix(options)
    const where = Option.match(prefix, {
      onNone: () => undefined,
      onSome: (resolved) => keyLike(`${escapeLikePattern(resolved)}%`),
    })
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({
            key: globalSecrets.key,
            encryptedValue: globalSecrets.encryptedValue,
          })
          .from(globalSecrets)
          .where(where),
      catch: d1Error("db.globalSecrets.getDecryptedSecrets"),
    })
    const entries = yield* Effect.forEach(
      rows,
      (row) =>
        decryptSecret(row.encryptedValue, this.encryptionKey).pipe(
          Effect.mapError(d1Error("db.globalSecrets.getDecryptedSecrets")),
          Effect.map((decrypted): [string, string] => [
            this.stripSecretKey(row.key, options),
            decrypted,
          ]),
        ),
      { concurrency: "unbounded" },
    )
    return Object.fromEntries(entries)
  })

  private getGlobalSecret = Effect.fn("db.globalSecrets.getGlobalSecret")(function* (
    this: GlobalSecretsStore,
    key: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle.select().from(globalSecrets).where(eq(globalSecrets.key, key)).limit(1),
      catch: d1Error("db.globalSecrets.setSecrets"),
    })
    return Option.fromNullishOr(rows[0])
  })
}

// oxlint-disable-next-line c0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the D1Error channel must be named explicitly here.
function runGlobalSecretsEffect<A>(effect: Effect.Effect<A, D1Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect GlobalSecretsStore to non-Effect runtime consumers (Slack credential sync, durable object, sandbox/storage nodes, MCP forge server).
  return Effect.runPromise(effect)
}

/**
 * Promise-facing view of {@link GlobalSecretsStore} for the non-Effect runtime consumers that read
 * or write user secrets outside an Effect program (Slack credential sync, the session durable
 * object, sandbox/storage workflow nodes, and the MCP Context Forge server). Runs the underlying
 * Effect at this boundary.
 */
export interface GlobalSecretsStorePromise {
  setSecrets(
    secrets: Record<string, string> | readonly SecretWriteEntry[],
    options?: { userId?: string },
  ): Promise<{ keys: string[]; created: number; updated: number }>
  listSecretKeys(options?: SecretScopeOptions): Promise<string[]>
  getDecryptedSecrets(options?: { userId?: string }): Promise<Record<string, string>>
}

export function createGlobalSecretsStoreFromD1(
  db: D1Database,
  encryptionKey: string,
): GlobalSecretsStorePromise {
  const store = new GlobalSecretsStore(db, encryptionKey)
  return {
    setSecrets: (secrets, options) => runGlobalSecretsEffect(store.setSecrets(secrets, options)),
    listSecretKeys: (options) => runGlobalSecretsEffect(store.listSecretKeys(options)),
    getDecryptedSecrets: (options) => runGlobalSecretsEffect(store.getDecryptedSecrets(options)),
  }
}
