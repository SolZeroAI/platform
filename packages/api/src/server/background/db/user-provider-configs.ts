import {
  cloneDefaultOpenCodePermission,
  DEFAULT_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  parseStoredOpenCodePermission,
  stringifyOpenCodePermission,
  type OpenCodePermission,
  type ProviderModelDefinition,
} from "@solzero/shared"
import { asc, and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonRecord, stringifyJson } from "../../lib/json"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { userProviderConfigs, userProviderPreferences } from "../../effect/db/schema"
import { decryptSecret, encryptSecret } from "../auth/crypto"
import { D1Error, UserProviderPreferenceMigrationError, d1Error } from "./errors"

export type UserProviderScope = "shared_override" | "custom_provider"

export interface UserProviderSharedOverrideInput {
  providerId: string
  displayName: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface UserProviderCustomInput {
  providerId: string
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
  apiKey?: string
  clearApiKey?: boolean
}

export interface UserProviderSettingsUpdate {
  defaultModel: string | null
  defaultIsolateStepLimit: number
  opencodePermission: OpenCodePermission | null
  sharedOverrides: UserProviderSharedOverrideInput[]
  customProviders: UserProviderCustomInput[]
}

type UserProviderConfigRow = typeof userProviderConfigs.$inferSelect & {
  scope: UserProviderScope
}

type UserProviderPreferenceRow = typeof userProviderPreferences.$inferSelect

interface StoredCustomProviderPayload {
  name: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, ProviderModelDefinition>
}

const OPENCODE_PERMISSION_PREFERENCE_COLUMN = "opencode_permission_json"
const USER_PROVIDER_OPENCODE_PERMISSION_MIGRATION_MESSAGE =
  "OpenCode permission settings database migration has not been applied. Run D1 migration 0024_opencode_permission_preferences.sql."

export interface UserProviderSettingsSnapshot {
  defaultModel: string | null
  defaultIsolateStepLimit: number
  opencodePermission: OpenCodePermission | null
  defaultOpenCodePermission: OpenCodePermission
  sharedOverrides: Array<{
    providerId: string
    displayName: string
    hasApiKey: boolean
  }>
  customProviders: Array<{
    providerId: string
    name: string
    npm?: string
    options?: Record<string, unknown>
    models: Record<string, ProviderModelDefinition>
    hasApiKey: boolean
  }>
}

export interface RuntimeUserProviderRecord {
  providerId: string
  scope: UserProviderScope
  displayName: string
  npm?: string
  options?: Record<string, unknown>
  models?: Record<string, ProviderModelDefinition>
  apiKey: string | null
}

function toCustomProviderSnapshot(
  row: UserProviderConfigRow,
): UserProviderSettingsSnapshot["customProviders"][number] {
  const payload = parseStoredCustomProviderPayload(
    row.providerJson,
    row.displayName || row.providerId,
  )
  return {
    providerId: row.providerId,
    name: payload.name,
    npm: payload.npm,
    options: payload.options,
    models: payload.models,
    hasApiKey: Boolean(row.apiKeyEncrypted),
  }
}

function buildCustomRuntimeRecord(
  row: UserProviderConfigRow,
  apiKey: string | null,
): RuntimeUserProviderRecord {
  const payload = parseStoredCustomProviderPayload(
    row.providerJson,
    row.displayName || row.providerId,
  )
  return {
    providerId: row.providerId,
    scope: row.scope,
    displayName: payload.name,
    npm: payload.npm,
    options: payload.options,
    models: payload.models,
    apiKey,
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

function isMissingOpenCodePermissionPreferenceColumn(errorValue: unknown): boolean {
  const messages = getErrorMessages(errorValue).join("\n")
  return (
    messages.includes(OPENCODE_PERMISSION_PREFERENCE_COLUMN) &&
    (/no such column/i.test(messages) ||
      /no column named/i.test(messages) ||
      /Failed query:/i.test(messages))
  )
}

function isD1Error(errorValue: unknown): errorValue is D1Error {
  return Boolean(
    errorValue &&
    typeof errorValue === "object" &&
    (errorValue as { _tag?: unknown })._tag === "D1Error",
  )
}

function describeUserProviderD1Error(error: D1Error): string {
  return Option.getOrElse(
    Option.fromIterable(getErrorMessages(error.cause)).pipe(
      Option.map((message) => message.trim()),
      Option.filter((message) => message.length > 0),
      Option.filter((message) => message === USER_PROVIDER_OPENCODE_PERMISSION_MIGRATION_MESSAGE),
    ),
    () => `Provider settings database operation failed: ${error.operation}`,
  )
}

export class UserProviderConfigsStore {
  private readonly drizzle

  constructor(
    private readonly db: D1Database,
    private readonly encryptionKey: string,
  ) {
    this.drizzle = makeD1Drizzle(db)
  }

  getSettingsSnapshot = Effect.fn("db.userProviderConfigs.getSettingsSnapshot")(function* (
    this: UserProviderConfigsStore,
    userId: string,
  ) {
    const rows = yield* this.listConfigRows(userId)
    const preference = yield* this.getPreference(userId)

    const sharedOverrides: UserProviderSettingsSnapshot["sharedOverrides"] = rows
      .filter((row) => row.scope === "shared_override")
      .map((row) => ({
        providerId: row.providerId,
        displayName: row.displayName,
        hasApiKey: Boolean(row.apiKeyEncrypted),
      }))

    const customProviders: UserProviderSettingsSnapshot["customProviders"] = rows
      .filter((row) => row.scope !== "shared_override")
      .map(toCustomProviderSnapshot)

    return {
      defaultModel: resolvePreferenceModel(preference),
      defaultIsolateStepLimit: resolvePreferenceStepLimit(preference),
      opencodePermission: Option.getOrNull(resolvePreferenceOpenCodePermission(preference)),
      defaultOpenCodePermission: cloneDefaultOpenCodePermission(),
      sharedOverrides,
      customProviders,
    } satisfies UserProviderSettingsSnapshot
  })

  listRuntimeConfigs = Effect.fn("db.userProviderConfigs.listRuntimeConfigs")(function* (
    this: UserProviderConfigsStore,
    userId: string,
  ) {
    const rows = yield* this.listConfigRows(userId)
    const preference = yield* this.getPreference(userId)

    const providers = yield* Effect.forEach(rows, (row) => this.toRuntimeProviderRecord(row), {
      concurrency: "unbounded",
    })

    return {
      defaultModel: resolvePreferenceModel(preference),
      defaultIsolateStepLimit: resolvePreferenceStepLimit(preference),
      opencodePermission: Option.getOrNull(resolvePreferenceOpenCodePermission(preference)),
      providers,
    }
  })

  private toRuntimeProviderRecord = Effect.fn("db.userProviderConfigs.toRuntimeProviderRecord")(
    function* (this: UserProviderConfigsStore, row: UserProviderConfigRow) {
      const apiKey = yield* this.decryptApiKey(row.apiKeyEncrypted)
      return Match.value(row.scope === "shared_override").pipe(
        Match.when(
          true,
          (): RuntimeUserProviderRecord => ({
            providerId: row.providerId,
            scope: row.scope,
            displayName: row.displayName,
            apiKey,
          }),
        ),
        Match.orElse(() => buildCustomRuntimeRecord(row, apiKey)),
      )
    },
  )

  private decryptApiKey = Effect.fn("db.userProviderConfigs.decryptApiKey")(function* (
    this: UserProviderConfigsStore,
    apiKeyEncrypted: string | null,
  ) {
    return yield* Option.match(Option.fromNullishOr(apiKeyEncrypted).pipe(Option.filter(Boolean)), {
      onNone: () => Effect.succeed<string | null>(null),
      onSome: (encrypted) =>
        decryptSecret(encrypted, this.encryptionKey).pipe(
          Effect.mapError(d1Error("db.userProviderConfigs.listRuntimeConfigs")),
        ),
    })
  })

  replaceSettings = Effect.fn("db.userProviderConfigs.replaceSettings")(function* (
    this: UserProviderConfigsStore,
    userId: string,
    input: UserProviderSettingsUpdate,
  ) {
    const existingRows = yield* this.listConfigRows(userId)
    const existingByProviderId = new Map(existingRows.map((row) => [row.providerId, row] as const))
    const retainedProviderIds = new Set<string>([
      ...input.sharedOverrides.map((override) => override.providerId),
      ...input.customProviders.map((provider) => provider.providerId),
    ])
    const now = Date.now()

    yield* Effect.forEach(
      input.sharedOverrides,
      (override) =>
        this.writeSharedOverride(
          userId,
          override,
          Option.fromNullishOr(existingByProviderId.get(override.providerId)),
          now,
        ),
      { concurrency: "unbounded" },
    )

    yield* Effect.forEach(
      input.customProviders,
      (provider) =>
        this.writeCustomProvider(
          userId,
          provider,
          Option.fromNullishOr(existingByProviderId.get(provider.providerId)),
          now,
        ),
      { concurrency: "unbounded" },
    )

    const removedRows = existingRows.filter((row) => !retainedProviderIds.has(row.providerId))
    yield* Effect.forEach(
      removedRows,
      (row) =>
        Effect.tryPromise({
          try: () =>
            this.drizzle
              .delete(userProviderConfigs)
              .where(
                and(
                  eq(userProviderConfigs.userId, userId),
                  eq(userProviderConfigs.providerId, row.providerId),
                ),
              ),
          catch: d1Error("db.userProviderConfigs.replaceSettings"),
        }),
      { concurrency: "unbounded" },
    )

    const existingPreference = yield* this.getPreference(userId)
    const opencodePermissionJson = Option.getOrNull(
      stringifyOpenCodePermissionOption(Option.fromNullishOr(input.opencodePermission)),
    )
    yield* this.writePreference(
      userId,
      input,
      existingPreference,
      opencodePermissionJson,
      now,
    ).pipe(
      Effect.catch((error) =>
        Match.value(isMissingOpenCodePermissionPreferenceColumn(error.cause)).pipe(
          Match.when(true, () =>
            Option.match(Option.fromNullishOr(opencodePermissionJson), {
              onNone: () => this.writePreferenceWithoutOpenCodePermission(userId, input, now),
              onSome: () =>
                Effect.fail(
                  new D1Error({
                    operation: "db.userProviderConfigs.replaceSettings",
                    cause: new UserProviderPreferenceMigrationError({
                      message: USER_PROVIDER_OPENCODE_PERMISSION_MIGRATION_MESSAGE,
                    }),
                  }),
                ),
            }),
          ),
          Match.orElse(() => Effect.fail(error)),
        ),
      ),
    )
  })

  private writePreference = Effect.fn("db.userProviderConfigs.writePreference")(function* (
    this: UserProviderConfigsStore,
    userId: string,
    input: UserProviderSettingsUpdate,
    existingPreference: Option.Option<UserProviderPreferenceRow>,
    opencodePermissionJson: string | null,
    now: number,
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(userProviderPreferences)
          .values({
            userId,
            defaultModel: input.defaultModel,
            defaultIsolateStepLimit: input.defaultIsolateStepLimit,
            opencodePermissionJson,
            createdAt: Option.getOrElse(
              Option.map(existingPreference, (preference) => preference.createdAt),
              () => now,
            ),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userProviderPreferences.userId,
            set: {
              defaultModel: input.defaultModel,
              defaultIsolateStepLimit: input.defaultIsolateStepLimit,
              opencodePermissionJson,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.userProviderConfigs.replaceSettings"),
    })
  })

  private writePreferenceWithoutOpenCodePermission = Effect.fn(
    "db.userProviderConfigs.writePreferenceWithoutOpenCodePermission",
  )(function* (
    this: UserProviderConfigsStore,
    userId: string,
    input: UserProviderSettingsUpdate,
    now: number,
  ) {
    const existingPreferenceRows = yield* this.getPreferenceWithoutOpenCodePermission(userId)
    const existingPreference = Option.fromNullishOr(existingPreferenceRows[0])
    yield* Effect.tryPromise({
      try: () =>
        this.db
          .prepare(
            `INSERT INTO user_provider_preferences (
              user_id,
              default_model,
              default_isolate_step_limit,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              default_model = excluded.default_model,
              default_isolate_step_limit = excluded.default_isolate_step_limit,
              updated_at = excluded.updated_at`,
          )
          .bind(
            userId,
            input.defaultModel,
            input.defaultIsolateStepLimit,
            Option.getOrElse(
              Option.map(existingPreference, (preference) => preference.createdAt),
              () => now,
            ),
            now,
          )
          .run(),
      catch: d1Error("db.userProviderConfigs.replaceSettings"),
    })
  })

  private writeSharedOverride = Effect.fn("db.userProviderConfigs.writeSharedOverride")(function* (
    this: UserProviderConfigsStore,
    userId: string,
    override: UserProviderSharedOverrideInput,
    existing: Option.Option<UserProviderConfigRow>,
    now: number,
  ) {
    const apiKeyEncrypted = yield* this.resolveEncryptedApiKey(
      Option.getOrElse(
        Option.flatMap(existing, (row) => Option.fromNullishOr(row.apiKeyEncrypted)),
        () => null,
      ),
      override.apiKey,
      override.clearApiKey,
    )
    const createdAt = Option.getOrElse(
      Option.map(existing, (row) => row.createdAt),
      () => now,
    )

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(userProviderConfigs)
          .values({
            userId,
            providerId: override.providerId,
            scope: "shared_override",
            displayName: override.displayName,
            npm: null,
            providerJson: "{}",
            apiKeyEncrypted,
            createdAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [userProviderConfigs.userId, userProviderConfigs.providerId],
            set: {
              scope: "shared_override",
              displayName: override.displayName,
              npm: null,
              providerJson: "{}",
              apiKeyEncrypted,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.userProviderConfigs.replaceSettings"),
    })
  })

  private writeCustomProvider = Effect.fn("db.userProviderConfigs.writeCustomProvider")(function* (
    this: UserProviderConfigsStore,
    userId: string,
    provider: UserProviderCustomInput,
    existing: Option.Option<UserProviderConfigRow>,
    now: number,
  ) {
    const apiKeyEncrypted = yield* this.resolveEncryptedApiKey(
      Option.getOrElse(
        Option.flatMap(existing, (row) => Option.fromNullishOr(row.apiKeyEncrypted)),
        () => null,
      ),
      provider.apiKey,
      provider.clearApiKey,
    )
    const payload: StoredCustomProviderPayload = {
      name: provider.name,
      npm: provider.npm,
      options: provider.options,
      models: provider.models,
    }
    const createdAt = Option.getOrElse(
      Option.map(existing, (row) => row.createdAt),
      () => now,
    )

    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(userProviderConfigs)
          .values({
            userId,
            providerId: provider.providerId,
            scope: "custom_provider",
            displayName: provider.name,
            npm: provider.npm ?? null,
            providerJson: stringifyJson(payload),
            apiKeyEncrypted,
            createdAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [userProviderConfigs.userId, userProviderConfigs.providerId],
            set: {
              scope: "custom_provider",
              displayName: provider.name,
              npm: provider.npm ?? null,
              providerJson: stringifyJson(payload),
              apiKeyEncrypted,
              updatedAt: now,
            },
          }),
      catch: d1Error("db.userProviderConfigs.replaceSettings"),
    })
  })

  private resolveEncryptedApiKey = Effect.fn("db.userProviderConfigs.resolveEncryptedApiKey")(
    function* (
      this: UserProviderConfigsStore,
      existingEncrypted: string | null,
      nextPlaintext: string | undefined,
      clearApiKey: boolean | undefined,
    ) {
      return yield* Match.value(Boolean(clearApiKey)).pipe(
        Match.when(true, () => Effect.succeed<string | null>(null)),
        Match.orElse(() => this.encryptOrKeep(existingEncrypted, nextPlaintext)),
      )
    },
  )

  private encryptOrKeep = Effect.fn("db.userProviderConfigs.encryptOrKeep")(function* (
    this: UserProviderConfigsStore,
    existingEncrypted: string | null,
    nextPlaintext: string | undefined,
  ) {
    return yield* Option.match(
      Option.fromNullishOr(nextPlaintext?.trim()).pipe(Option.filter((value) => value.length > 0)),
      {
        onNone: () => Effect.succeed<string | null>(existingEncrypted),
        onSome: (plaintext) =>
          encryptSecret(plaintext, this.encryptionKey).pipe(
            Effect.mapError(d1Error("db.userProviderConfigs.replaceSettings")),
          ),
      },
    )
  })

  private listConfigRows = Effect.fn("db.userProviderConfigs.listConfigRows")(function* (
    this: UserProviderConfigsStore,
    userId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(userProviderConfigs)
          .where(eq(userProviderConfigs.userId, userId))
          .orderBy(asc(userProviderConfigs.scope), asc(userProviderConfigs.providerId)),
      catch: d1Error("db.userProviderConfigs.listConfigRows"),
    })
    return rows.map(
      (row): UserProviderConfigRow => ({ ...row, scope: row.scope as UserProviderScope }),
    )
  })

  private getPreference = Effect.fn("db.userProviderConfigs.getPreference")(function* (
    this: UserProviderConfigsStore,
    userId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(userProviderPreferences)
          .where(eq(userProviderPreferences.userId, userId))
          .limit(1),
      catch: d1Error("db.userProviderConfigs.getPreference"),
    }).pipe(
      Effect.catchIf(
        (error) => isMissingOpenCodePermissionPreferenceColumn(error.cause),
        () => this.getPreferenceWithoutOpenCodePermission(userId),
      ),
    )
    return Option.fromNullishOr(rows[0])
  })

  private getPreferenceWithoutOpenCodePermission = Effect.fn(
    "db.userProviderConfigs.getPreferenceWithoutOpenCodePermission",
  )(function* (this: UserProviderConfigsStore, userId: string) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({
            userId: userProviderPreferences.userId,
            defaultModel: userProviderPreferences.defaultModel,
            defaultIsolateStepLimit: userProviderPreferences.defaultIsolateStepLimit,
            createdAt: userProviderPreferences.createdAt,
            updatedAt: userProviderPreferences.updatedAt,
          })
          .from(userProviderPreferences)
          .where(eq(userProviderPreferences.userId, userId))
          .limit(1),
      catch: d1Error("db.userProviderConfigs.getPreferenceWithoutOpenCodePermission"),
    })
    return rows.map(
      (row): UserProviderPreferenceRow => ({
        ...row,
        opencodePermissionJson: null,
      }),
    )
  })
}

type UserProviderRuntimeConfigs = Effect.Success<
  ReturnType<UserProviderConfigsStore["listRuntimeConfigs"]>
>

// oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: A is the type parameter, so the DB error channel must be named explicitly here.
function runUserProviderConfigsEffect<A>(effect: Effect.Effect<A, D1Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect UserProviderConfigsStore to the non-Effect provider catalog module.
  return Effect.runPromise(effect).catch((errorValue: unknown) => {
    const error = Match.value(errorValue).pipe(
      Match.when(isD1Error, (d1) => new Error(describeUserProviderD1Error(d1))),
      Match.orElse((other) => other),
    )
    throw error
  })
}

/**
 * Promise-facing view of {@link UserProviderConfigsStore} for the non-Effect provider catalog
 * module. Runs the underlying Effect at this boundary.
 */
export interface UserProviderConfigsStorePromise {
  getSettingsSnapshot(userId: string): Promise<UserProviderSettingsSnapshot>
  listRuntimeConfigs(userId: string): Promise<UserProviderRuntimeConfigs>
  replaceSettings(userId: string, input: UserProviderSettingsUpdate): Promise<void>
}

export function createUserProviderConfigsStoreFromD1(
  db: D1Database,
  encryptionKey: string,
): UserProviderConfigsStorePromise {
  const store = new UserProviderConfigsStore(db, encryptionKey)
  return {
    getSettingsSnapshot: (userId) =>
      runUserProviderConfigsEffect(store.getSettingsSnapshot(userId)),
    listRuntimeConfigs: (userId) => runUserProviderConfigsEffect(store.listRuntimeConfigs(userId)),
    replaceSettings: (userId, input) =>
      runUserProviderConfigsEffect(store.replaceSettings(userId, input)),
  }
}

function resolvePreferenceModel(preference: Option.Option<UserProviderPreferenceRow>) {
  return Option.getOrElse(
    Option.flatMap(preference, (row) => Option.fromNullishOr(row.defaultModel)),
    () => null,
  )
}

function resolvePreferenceStepLimit(preference: Option.Option<UserProviderPreferenceRow>): number {
  return normalizeIsolateStepLimit(
    Option.getOrUndefined(Option.map(preference, (row) => row.defaultIsolateStepLimit)),
    DEFAULT_ISOLATE_STEP_LIMIT,
  )
}

function resolvePreferenceOpenCodePermission(
  preference: Option.Option<UserProviderPreferenceRow>,
): Option.Option<OpenCodePermission> {
  return Option.flatMap(preference, (row) =>
    parseStoredOpenCodePermission(row.opencodePermissionJson),
  )
}

function stringifyOpenCodePermissionOption(
  permission: Option.Option<OpenCodePermission>,
): Option.Option<string> {
  return Option.map(permission, (resolved) => stringifyOpenCodePermission(resolved))
}

function parseStoredCustomProviderPayload(
  value: string,
  fallbackName: string,
): StoredCustomProviderPayload {
  const parsed = parseStoredJsonObject(value)
  return {
    name: Option.getOrElse(readStoredStringOption(parsed.name), () => fallbackName),
    npm: Option.getOrUndefined(readStoredStringOption(parsed.npm)),
    options: Option.getOrUndefined(readStoredRecordOption(parsed.options)),
    models: Option.getOrElse(readStoredRecordOption(parsed.models), () => ({})) as Record<
      string,
      ProviderModelDefinition
    >,
  }
}

function parseStoredJsonObject(value: string): Record<string, unknown> {
  return parseJsonRecord(value)
}

function readStoredStringOption(value: unknown): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.filter((resolved): resolved is string => typeof resolved === "string"),
    Option.map((resolved) => resolved.trim()),
    Option.filter((resolved) => resolved.length > 0),
  )
}

function readStoredRecordOption(value: unknown): Option.Option<Record<string, unknown>> {
  return Option.fromNullishOr(value).pipe(
    Option.filter((resolved) => typeof resolved === "object" && !Array.isArray(resolved)),
    Option.map((resolved) => resolved as Record<string, unknown>),
  )
}
