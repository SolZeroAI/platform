/* oxlint-disable c0-lint/avoid-untagged-errors, c0-lint/no-manual-effect-channels, c0-lint/no-match-effect-branch, c0-lint/no-ternary -- C0_CONFIG is a low-level KV JSON/secret boundary; the Promise bridge, paginated KV listing, and compact decoders intentionally stay local to this module. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { SecretReference } from "@c0-agent/shared"
import { decryptSecret, encryptSecret } from "../auth/crypto"
import { toError } from "../../lib/effect-errors"
import { parseJson, stringifyJson } from "../../lib/json"

export const C0_CONFIG_KEYS = {
  admin: {
    config: "config/admin",
  },
  auth: {
    config: "config/auth",
    adminPassword: "secrets/auth/admin-password",
    providerClientSecret: (providerId: string) =>
      `secrets/auth/providers/${encodeURIComponent(providerId)}/client-secret`,
  },
  aiProviders: {
    litellmConfig: "config/ai-providers/litellm",
    litellmApiKey: "secrets/ai-providers/litellm/api-key",
    litellmModels: "registry/ai-providers/litellm/models",
  },
  mcpcf: {
    config: "config/mcpcf",
    adminApiToken: "secrets/mcpcf/admin-api-token",
    serverIndex: "registry/mcpcf/server-index",
    server: (serverId: string) => `registry/mcpcf/servers/${encodeURIComponent(serverId)}`,
  },
  aiSearch: {
    sourcePrefix: "registry/ai-search/sources/",
    source: (sourceId: string) => `registry/ai-search/sources/${encodeURIComponent(sourceId)}`,
  },
} as const

export const C0_CONFIG_BINDINGS = {
  admin: "C0_CONFIG_ADMIN",
  auth: "C0_CONFIG_AUTH",
  litellm: "C0_CONFIG_LITELLM",
  mcpcf: "C0_CONFIG_MCPCF",
} as const

export const C0_CONFIG_LOCATIONS = {
  admin: "active stage config:admins",
  auth: "active stage config:auth",
  litellm: "active stage config:aiProviders.litellm",
  mcpcf: "active stage config:mcpcf",
} as const

export function getC0DeploymentConfig<T>(env: object, bindingName: string): Option.Option<T> {
  return Option.fromNullishOr(Reflect.get(env, bindingName)).pipe(
    Option.filter(
      (value): value is T => typeof value === "object" && value !== null && !Array.isArray(value),
    ),
  )
}

export function getC0DeploymentSecret(
  env: object,
  reference: SecretReference | null | undefined,
): Option.Option<string> {
  return Option.fromNullishOr(reference).pipe(
    Option.flatMap((resolved) => Option.fromNullishOr(Reflect.get(env, resolved.env))),
    Option.filter((value): value is string => typeof value === "string"),
    Option.filter((value) => value.length > 0),
  )
}

export interface C0ConfigEncryptedSecretRecord {
  encryptedValue: string
  createdAt: number
  updatedAt: number
}

function requireEncryptionKey(encryptionKey: string | undefined): Effect.Effect<string, Error> {
  return Option.match(Option.fromNullishOr(encryptionKey).pipe(Option.filter(Boolean)), {
    onNone: () => Effect.fail(new Error("REPO_SECRETS_ENCRYPTION_KEY not configured")),
    onSome: (resolved) => Effect.succeed(resolved),
  })
}

function readEncryptedSecretRecord(value: unknown): Option.Option<C0ConfigEncryptedSecretRecord> {
  return Option.fromNullishOr(value).pipe(
    Option.filter(
      (resolved): resolved is Record<string, unknown> =>
        typeof resolved === "object" && resolved !== null && !Array.isArray(resolved),
    ),
    Option.filter(
      (record): record is Record<string, unknown> & { encryptedValue: string } =>
        typeof record.encryptedValue === "string" && record.encryptedValue.length > 0,
    ),
    Option.map((record) => ({
      encryptedValue: record.encryptedValue,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    })),
  )
}

function listKvKeyNames(
  kv: KVNamespace,
  prefix: string,
  cursor: Option.Option<string>,
): Effect.Effect<string[], Error> {
  return Effect.tryPromise({
    try: () =>
      kv.list({
        prefix,
        ...Option.match(cursor, {
          onNone: () => ({}),
          onSome: (value) => ({ cursor: value }),
        }),
      }),
    catch: toError,
  }).pipe(
    Effect.flatMap((page) =>
      page.list_complete
        ? Effect.succeed(page.keys.map((key) => key.name))
        : listKvKeyNames(kv, prefix, Option.some(page.cursor)).pipe(
            Effect.map((remaining) => [...page.keys.map((key) => key.name), ...remaining]),
          ),
    ),
  )
}

export class C0ConfigStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly encryptionKey?: string,
  ) {}

  getJson = Effect.fn("db.c0Config.getJson")(function* <T = unknown>(
    this: C0ConfigStore,
    key: string,
  ) {
    const raw = yield* Effect.tryPromise({
      try: () => this.kv.get(key),
      catch: toError,
    })
    return yield* Option.match(Option.fromNullishOr(raw), {
      onNone: () => Effect.succeed(Option.none<T>()),
      onSome: (resolved) =>
        Effect.try({
          try: () => parseJson(resolved) as T,
          catch: toError,
        }).pipe(Effect.map(Option.some)),
    })
  })

  listKeys = Effect.fn("db.c0Config.listKeys")(function* (this: C0ConfigStore, prefix: string) {
    return yield* listKvKeyNames(this.kv, prefix, Option.none())
  })

  putJson = Effect.fn("db.c0Config.putJson")(function* (
    this: C0ConfigStore,
    key: string,
    value: unknown,
  ) {
    const serialized = stringifyJson(value)
    yield* Effect.tryPromise({
      try: () => this.kv.put(key, serialized),
      catch: toError,
    })
  })

  delete = Effect.fn("db.c0Config.delete")(function* (this: C0ConfigStore, key: string) {
    yield* Effect.tryPromise({
      try: () => this.kv.delete(key),
      catch: toError,
    })
  })

  encryptedSecretConfigured = Effect.fn("db.c0Config.encryptedSecretConfigured")(function* (
    this: C0ConfigStore,
    key: string,
  ) {
    const record = yield* this.getEncryptedSecretRecord(key)
    return Option.isSome(record)
  })

  getEncryptedSecret = Effect.fn("db.c0Config.getEncryptedSecret")(function* (
    this: C0ConfigStore,
    key: string,
  ) {
    const encryptionKey = yield* requireEncryptionKey(this.encryptionKey)
    const record = yield* this.getEncryptedSecretRecord(key)
    return yield* Option.match(record, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (resolved) =>
        decryptSecret(resolved.encryptedValue, encryptionKey).pipe(Effect.map(Option.some)),
    })
  })

  setEncryptedSecret = Effect.fn("db.c0Config.setEncryptedSecret")(function* (
    this: C0ConfigStore,
    key: string,
    plaintext: string,
  ) {
    const encryptionKey = yield* requireEncryptionKey(this.encryptionKey)
    const encryptedValue = yield* encryptSecret(plaintext, encryptionKey)
    yield* this.setEncryptedSecretCiphertext(key, encryptedValue)
  })

  setEncryptedSecretCiphertext = Effect.fn("db.c0Config.setEncryptedSecretCiphertext")(function* (
    this: C0ConfigStore,
    key: string,
    encryptedValue: string,
  ) {
    const existing = yield* this.getEncryptedSecretRecord(key)
    const now = Date.now()
    yield* this.putJson(key, {
      encryptedValue,
      createdAt: Option.getOrElse(
        Option.map(existing, (record) => record.createdAt),
        () => now,
      ),
      updatedAt: now,
    } satisfies C0ConfigEncryptedSecretRecord)
  })

  private getEncryptedSecretRecord = Effect.fn("db.c0Config.getEncryptedSecretRecord")(function* (
    this: C0ConfigStore,
    key: string,
  ) {
    const parsed = yield* this.getJson(key)
    return Option.flatMap(parsed, readEncryptedSecretRecord)
  })
}

function runC0ConfigEffect<A>(effect: Effect.Effect<A, Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary for non-Effect runtime consumers.
  return Effect.runPromise(effect)
}

export interface C0ConfigStorePromise {
  getJson<T = unknown>(key: string): Promise<Option.Option<T>>
  putJson(key: string, value: unknown): Promise<void>
  encryptedSecretConfigured(key: string): Promise<boolean>
  getEncryptedSecret(key: string): Promise<Option.Option<string>>
  setEncryptedSecret(key: string, plaintext: string): Promise<void>
}

export function createC0ConfigStore(kv: KVNamespace, encryptionKey?: string): C0ConfigStorePromise {
  const store = new C0ConfigStore(kv, encryptionKey)
  return {
    getJson: (key) => runC0ConfigEffect(store.getJson(key)),
    putJson: (key, value) => runC0ConfigEffect(store.putJson(key, value)),
    encryptedSecretConfigured: (key) => runC0ConfigEffect(store.encryptedSecretConfigured(key)),
    getEncryptedSecret: (key) => runC0ConfigEffect(store.getEncryptedSecret(key)),
    setEncryptedSecret: (key, plaintext) =>
      runC0ConfigEffect(store.setEncryptedSecret(key, plaintext)),
  }
}
