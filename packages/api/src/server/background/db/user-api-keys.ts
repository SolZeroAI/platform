import { and, desc, eq, isNull } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { userApiKeys } from "../../effect/db/schema"
import { generateId, hashToken } from "../auth/crypto"
import { d1Error } from "./errors"

const API_KEY_PREFIX = "oiak"
const API_KEY_PATTERN = /^oiak_([a-f0-9]+)_[a-f0-9]+$/

export interface UserApiKeyRecord {
  keyId: string
  userId: string
  label: string | null
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export interface CreatedUserApiKey {
  keyId: string
  key: string
  label: string | null
  createdAt: number
}

interface VerifiedApiKey {
  keyId: string
  userId: string
}

export class UserApiKeyStore {
  private readonly drizzle

  constructor(private readonly db: D1Database) {
    this.drizzle = makeD1Drizzle(db)
  }

  create = Effect.fn("db.userApiKeys.create")(function* (
    this: UserApiKeyStore,
    userId: string,
    label?: string | null,
  ) {
    const keyId = generateId(8)
    const secret = generateId(24)
    const key = `${API_KEY_PREFIX}_${keyId}_${secret}`
    const keyHash = yield* hashToken(key).pipe(Effect.mapError(d1Error("db.userApiKeys.create")))
    const now = Date.now()

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle.insert(userApiKeys).values({
          keyId,
          userId,
          label: label ?? null,
          keyHash,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: null,
          revokedAt: null,
        }),
      catch: d1Error("db.userApiKeys.create"),
    })

    return {
      keyId,
      key,
      label: label ?? null,
      createdAt: now,
    } satisfies CreatedUserApiKey
  })

  listByUserId = Effect.fn("db.userApiKeys.listByUserId")(function* (
    this: UserApiKeyStore,
    userId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(userApiKeys)
          .where(eq(userApiKeys.userId, userId))
          .orderBy(desc(userApiKeys.createdAt)),
      catch: d1Error("db.userApiKeys.listByUserId"),
    })

    return rows.map(
      (row): UserApiKeyRecord => ({
        keyId: row.keyId,
        userId: row.userId,
        label: row.label,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      }),
    )
  })

  revoke = Effect.fn("db.userApiKeys.revoke")(function* (
    this: UserApiKeyStore,
    userId: string,
    keyId: string,
  ) {
    const now = Date.now()
    const revoked = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(userApiKeys)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(userApiKeys.keyId, keyId),
              eq(userApiKeys.userId, userId),
              isNull(userApiKeys.revokedAt),
            ),
          )
          .returning({ keyId: userApiKeys.keyId }),
      catch: d1Error("db.userApiKeys.revoke"),
    })

    return revoked.length > 0
  })

  verify = Effect.fn("db.userApiKeys.verify")(function* (this: UserApiKeyStore, rawApiKey: string) {
    const keyIdOption = Option.fromNullishOr(rawApiKey.match(API_KEY_PATTERN)).pipe(
      Option.flatMap((match) => Option.fromNullishOr(match[1])),
    )
    return yield* Option.match(keyIdOption, {
      onNone: () => Effect.succeed(Option.none<VerifiedApiKey>()),
      onSome: (keyId) => this.verifyKey(rawApiKey, keyId),
    })
  })

  private verifyKey = Effect.fn("db.userApiKeys.verifyKey")(function* (
    this: UserApiKeyStore,
    rawApiKey: string,
    keyId: string,
  ) {
    const rowOption = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({
            keyId: userApiKeys.keyId,
            userId: userApiKeys.userId,
            keyHash: userApiKeys.keyHash,
          })
          .from(userApiKeys)
          .where(and(eq(userApiKeys.keyId, keyId), isNull(userApiKeys.revokedAt)))
          .limit(1),
      catch: d1Error("db.userApiKeys.verify"),
    }).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])))

    return yield* Option.match(rowOption, {
      onNone: () => Effect.succeed(Option.none<VerifiedApiKey>()),
      onSome: (row) => this.compareAndTouch(rawApiKey, row),
    })
  })

  private compareAndTouch = Effect.fn("db.userApiKeys.compareAndTouch")(function* (
    this: UserApiKeyStore,
    rawApiKey: string,
    row: { keyId: string; userId: string; keyHash: string },
  ) {
    const incomingHash = yield* hashToken(rawApiKey).pipe(
      Effect.mapError(d1Error("db.userApiKeys.verify")),
    )
    return yield* Match.value(incomingHash === row.keyHash).pipe(
      Match.when(false, () => Effect.succeed(Option.none<VerifiedApiKey>())),
      Match.orElse(() => this.touchLastUsed(row)),
    )
  })

  private touchLastUsed = Effect.fn("db.userApiKeys.touchLastUsed")(function* (
    this: UserApiKeyStore,
    row: { keyId: string; userId: string },
  ) {
    const now = Date.now()
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(userApiKeys)
          .set({ lastUsedAt: now, updatedAt: now })
          .where(eq(userApiKeys.keyId, row.keyId)),
      catch: d1Error("db.userApiKeys.verify"),
    })
    return Option.some<VerifiedApiKey>({ keyId: row.keyId, userId: row.userId })
  })
}
