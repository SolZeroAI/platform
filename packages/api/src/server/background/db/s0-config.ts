/* oxlint-disable s0-lint/avoid-untagged-errors, s0-lint/no-manual-effect-channels, s0-lint/no-match-effect-branch, s0-lint/no-ternary -- S0_CONFIG is a low-level KV JSON/secret boundary; the Promise bridge, paginated KV listing, and compact decoders intentionally stay local to this module. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { SecretReference } from "@solzero/shared"
import { decryptSecret, encryptSecret } from "../auth/crypto"
import { toError } from "../../lib/effect-errors"
import { parseJson, stringifyJson } from "../../lib/json"

export const S0_CONFIG_KEYS = {
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
    cloudflareAiGatewayProviderKey: (providerId: string) =>
      `secrets/ai-providers/cloudflare-ai-gateway/${encodeURIComponent(providerId)}/api-key`,
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

export const S0_CONFIG_BINDINGS = {
  admin: "S0_CONFIG_ADMIN",
  auth: "S0_CONFIG_AUTH",
  cloudflareAiGateway: "S0_CONFIG_CLOUDFLARE_AI_GATEWAY",
  litellm: "S0_CONFIG_LITELLM",
  mcpcf: "S0_CONFIG_MCPCF",
} as const

export const S0_CONFIG_LOCATIONS = {
  admin: "active stage config:admins",
  auth: "active stage config:auth",
  cloudflareAiGateway: "active stage config:aiProviders.cloudflareAiGateway",
  litellm: "active stage config:aiProviders.litellm",
  mcpcf: "active stage config:mcpcf",
} as const

export function getS0DeploymentConfig<T>(env: object, bindingName: string): Option.Option<T> {
  return Option.fromNullishOr(Reflect.get(env, bindingName)).pipe(
    Option.filter(
      (value): value is T => typeof value === "object" && value !== null && !Array.isArray(value),
    ),
  )
}

export function getS0DeploymentSecret(
  env: object,
  reference: SecretReference | null | undefined,
): Option.Option<string> {
  return Option.fromNullishOr(reference).pipe(
    Option.flatMap((resolved) => Option.fromNullishOr(Reflect.get(env, resolved.env))),
    Option.filter((value): value is string => typeof value === "string"),
    Option.filter((value) => value.length > 0),
  )
}

export interface S0ConfigEncryptedSecretRecord {
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

function readEncryptedSecretRecord(value: unknown): Option.Option<S0ConfigEncryptedSecretRecord> {
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

export class S0ConfigStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly encryptionKey?: string,
  ) {}

  getJson = Effect.fn("db.s0Config.getJson")(function* <T = unknown>(
    this: S0ConfigStore,
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

  listKeys = Effect.fn("db.s0Config.listKeys")(function* (this: S0ConfigStore, prefix: string) {
    return yield* listKvKeyNames(this.kv, prefix, Option.none())
  })

  putJson = Effect.fn("db.s0Config.putJson")(function* (
    this: S0ConfigStore,
    key: string,
    value: unknown,
  ) {
    const serialized = stringifyJson(value)
    yield* Effect.tryPromise({
      try: () => this.kv.put(key, serialized),
      catch: toError,
    })
  })

  delete = Effect.fn("db.s0Config.delete")(function* (this: S0ConfigStore, key: string) {
    yield* Effect.tryPromise({
      try: () => this.kv.delete(key),
      catch: toError,
    })
  })

  encryptedSecretConfigured = Effect.fn("db.s0Config.encryptedSecretConfigured")(function* (
    this: S0ConfigStore,
    key: string,
  ) {
    const record = yield* this.getEncryptedSecretRecord(key)
    return Option.isSome(record)
  })

  getEncryptedSecret = Effect.fn("db.s0Config.getEncryptedSecret")(function* (
    this: S0ConfigStore,
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

  setEncryptedSecret = Effect.fn("db.s0Config.setEncryptedSecret")(function* (
    this: S0ConfigStore,
    key: string,
    plaintext: string,
  ) {
    const encryptionKey = yield* requireEncryptionKey(this.encryptionKey)
    const encryptedValue = yield* encryptSecret(plaintext, encryptionKey)
    yield* this.setEncryptedSecretCiphertext(key, encryptedValue)
  })

  setEncryptedSecretCiphertext = Effect.fn("db.s0Config.setEncryptedSecretCiphertext")(function* (
    this: S0ConfigStore,
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
    } satisfies S0ConfigEncryptedSecretRecord)
  })

  private getEncryptedSecretRecord = Effect.fn("db.s0Config.getEncryptedSecretRecord")(function* (
    this: S0ConfigStore,
    key: string,
  ) {
    const parsed = yield* this.getJson(key)
    return Option.flatMap(parsed, readEncryptedSecretRecord)
  })
}

function runS0ConfigEffect<A>(effect: Effect.Effect<A, Error>): Promise<A> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary for non-Effect runtime consumers.
  return Effect.runPromise(effect)
}

export interface S0ConfigStorePromise {
  getJson<T = unknown>(key: string): Promise<Option.Option<T>>
  putJson(key: string, value: unknown): Promise<void>
  encryptedSecretConfigured(key: string): Promise<boolean>
  getEncryptedSecret(key: string): Promise<Option.Option<string>>
  setEncryptedSecret(key: string, plaintext: string): Promise<void>
}

export function createS0ConfigStore(kv: KVNamespace, encryptionKey?: string): S0ConfigStorePromise {
  const store = new S0ConfigStore(kv, encryptionKey)
  return {
    getJson: (key) => runS0ConfigEffect(store.getJson(key)),
    putJson: (key, value) => runS0ConfigEffect(store.putJson(key, value)),
    encryptedSecretConfigured: (key) => runS0ConfigEffect(store.encryptedSecretConfigured(key)),
    getEncryptedSecret: (key) => runS0ConfigEffect(store.getEncryptedSecret(key)),
    setEncryptedSecret: (key, plaintext) =>
      runS0ConfigEffect(store.setEncryptedSecret(key, plaintext)),
  }
}
