import { and, eq, inArray } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonArray, stringifyJson } from "../../lib/json"
import { makeD1Drizzle, type D1DrizzleDatabase } from "../../effect/db/d1-drizzle"
import { userMcpcfServerConfigs } from "../../effect/db/schema"
import { d1Error, UserMcpcfMigrationError, type D1Error } from "./errors"

export interface UserMcpcfServerConfigRecord {
  userId: string
  serverId: string
  authTokenSecretKey: string | null
  defaultToolsEnabled: boolean
  disabledTools: string[]
  createdAt: number
  updatedAt: number
}

export interface UserMcpcfServerConfigUpdate {
  userId: string
  serverId: string
  authTokenSecretKey?: string | null
  defaultToolsEnabled?: boolean
  disabledTools?: readonly string[]
}

type UserMcpcfServerConfigRow = typeof userMcpcfServerConfigs.$inferSelect

const USER_MCPCF_GATEWAY_API_TOKEN_SECRET_KEY = "mcpcf/contextforge-api-token"
const USER_MCPCF_MIGRATION_MESSAGE = "MCP user settings database migration has not been applied."

export function getUserMcpcfGatewayApiTokenSecretKey(): string {
  return USER_MCPCF_GATEWAY_API_TOKEN_SECRET_KEY
}

export function getUserMcpcfAuthTokenSecretKey(serverId: string): string {
  return `mcpcf/${serverId}/token`
}

function parseDisabledTools(value: string | null | undefined): string[] {
  return parseJsonArray(value).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
}

function normalizeDisabledTools(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

function rowToConfig(row: UserMcpcfServerConfigRow): UserMcpcfServerConfigRecord {
  return {
    userId: row.userId,
    serverId: row.serverId,
    authTokenSecretKey: row.authTokenSecretKey,
    defaultToolsEnabled: row.defaultToolsEnabled === 1,
    disabledTools: parseDisabledTools(row.disabledToolsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function errorMessageHead(record: Record<string, unknown>): string[] {
  return Option.match(
    Option.fromNullishOr(record.message).pipe(
      Option.filter((message): message is string => typeof message === "string"),
    ),
    {
      onNone: () => [] as string[],
      onSome: (message) => [message],
    },
  )
}

function collectErrorChainMessages(current: unknown): string[] {
  return Option.match(
    Option.fromNullishOr(current).pipe(Option.filter((value) => typeof value === "object")),
    {
      onNone: () => [],
      onSome: (value) => [
        ...errorMessageHead(value as Record<string, unknown>),
        ...collectErrorChainMessages((value as Record<string, unknown>).cause),
      ],
    },
  )
}

function getErrorMessages(errorValue: unknown): string[] {
  const chainMessages = collectErrorChainMessages(errorValue)
  return Match.value(typeof errorValue === "string").pipe(
    Match.when(true, () => [...chainMessages, errorValue as string]),
    Match.orElse(() => chainMessages),
  )
}

function isMissingUserMcpcfConfigTableError(errorValue: unknown): boolean {
  const messages = getErrorMessages(errorValue).join("\n")
  return (
    messages.includes("user_mcpcf_server_configs") &&
    (/no such table/i.test(messages) || /Failed query:/i.test(messages))
  )
}

export class UserMcpcfServerConfigStore {
  private readonly drizzle

  constructor(drizzle: D1DrizzleDatabase) {
    this.drizzle = drizzle
  }

  get = Effect.fn("db.userMcpcf.get")(function* (
    this: UserMcpcfServerConfigStore,
    userId: string,
    serverId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(userMcpcfServerConfigs)
          .where(
            and(
              eq(userMcpcfServerConfigs.userId, userId),
              eq(userMcpcfServerConfigs.serverId, serverId),
            ),
          )
          .limit(1),
      catch: d1Error("db.userMcpcf.get"),
    }).pipe(
      Effect.catchIf(
        (error) => isMissingUserMcpcfConfigTableError(error.cause),
        () => Effect.succeed([] as UserMcpcfServerConfigRow[]),
      ),
    )
    return Option.map(Option.fromNullishOr(rows[0]), rowToConfig)
  })

  listByUserAndServerIds = Effect.fn("db.userMcpcf.listByUserAndServerIds")(function* (
    this: UserMcpcfServerConfigStore,
    userId: string,
    serverIds: readonly string[],
  ) {
    const uniqueServerIds = [...new Set(serverIds.map((serverId) => serverId.trim()))].filter(
      Boolean,
    )
    return yield* Match.value(uniqueServerIds.length === 0).pipe(
      Match.when(true, () => Effect.succeed([] as UserMcpcfServerConfigRecord[])),
      Match.orElse(() => this.queryByServerIds(userId, uniqueServerIds)),
    )
  })

  private queryByServerIds = Effect.fn("db.userMcpcf.queryByServerIds")(function* (
    this: UserMcpcfServerConfigStore,
    userId: string,
    uniqueServerIds: readonly string[],
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(userMcpcfServerConfigs)
          .where(
            and(
              eq(userMcpcfServerConfigs.userId, userId),
              inArray(userMcpcfServerConfigs.serverId, [...uniqueServerIds]),
            ),
          ),
      catch: d1Error("db.userMcpcf.listByUserAndServerIds"),
    }).pipe(
      Effect.catchIf(
        (error) => isMissingUserMcpcfConfigTableError(error.cause),
        () => Effect.succeed([] as UserMcpcfServerConfigRow[]),
      ),
    )
    return rows.map(rowToConfig)
  })

  upsert = Effect.fn("db.userMcpcf.upsert")(function* (
    this: UserMcpcfServerConfigStore,
    update: UserMcpcfServerConfigUpdate,
  ) {
    const existing = yield* this.get(update.userId, update.serverId)
    const now = Date.now()

    const authTokenSecretKey = Match.value(update.authTokenSecretKey === undefined).pipe(
      Match.when(true, () =>
        Option.getOrElse(
          Option.flatMap(existing, (record) => Option.fromNullishOr(record.authTokenSecretKey)),
          () => null,
        ),
      ),
      Match.orElse(() => update.authTokenSecretKey ?? null),
    )

    const existingEnabled = Option.getOrElse(
      Option.map(existing, (record) => record.defaultToolsEnabled),
      () => true,
    )
    const defaultToolsEnabled = Option.match(Option.fromNullishOr(update.defaultToolsEnabled), {
      onNone: () => Number(existingEnabled),
      onSome: (enabled) => Number(Boolean(enabled)),
    })

    const disabledTools = Match.value(update.disabledTools === undefined).pipe(
      Match.when(true, () =>
        Option.getOrElse(
          Option.map(existing, (record) => record.disabledTools),
          () => [] as string[],
        ),
      ),
      Match.orElse(() => normalizeDisabledTools(update.disabledTools)),
    )
    const disabledToolsJson = stringifyJson(disabledTools)
    const createdAt = Option.getOrElse(
      Option.map(existing, (record) => record.createdAt),
      () => now,
    )

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(userMcpcfServerConfigs)
          .values({
            userId: update.userId,
            serverId: update.serverId,
            authTokenSecretKey,
            defaultToolsEnabled,
            disabledToolsJson,
            createdAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [userMcpcfServerConfigs.userId, userMcpcfServerConfigs.serverId],
            set: {
              authTokenSecretKey,
              defaultToolsEnabled,
              disabledToolsJson,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.userMcpcf.upsert"),
    }).pipe(
      Effect.catchIf(
        (error) => isMissingUserMcpcfConfigTableError(error.cause),
        () => Effect.fail(new UserMcpcfMigrationError({ message: USER_MCPCF_MIGRATION_MESSAGE })),
      ),
    )

    const saved = yield* this.get(update.userId, update.serverId)
    return yield* Option.match(saved, {
      onNone: () =>
        Effect.fail(new UserMcpcfMigrationError({ message: USER_MCPCF_MIGRATION_MESSAGE })),
      onSome: (record) => Effect.succeed(record),
    })
  })
}

function runUserMcpcfEffect<A>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the error channel must be named explicitly here.
  effect: Effect.Effect<A, D1Error | UserMcpcfMigrationError>,
): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect UserMcpcfServerConfigStore to the non-Effect MCP Context Forge server.
  return Effect.runPromise(effect)
}

/**
 * Promise-facing view of {@link UserMcpcfServerConfigStore} for the non-Effect MCP Context Forge
 * server. Runs the underlying Effect at this boundary.
 */
export interface UserMcpcfServerConfigStorePromise {
  listByUserAndServerIds(
    userId: string,
    serverIds: readonly string[],
  ): Promise<UserMcpcfServerConfigRecord[]>
}

export function createUserMcpcfServerConfigStoreFromD1(
  db: D1Database,
): UserMcpcfServerConfigStorePromise {
  const store = new UserMcpcfServerConfigStore(makeD1Drizzle(db))
  return {
    listByUserAndServerIds: (userId, serverIds) =>
      runUserMcpcfEffect(store.listByUserAndServerIds(userId, serverIds)),
  }
}
