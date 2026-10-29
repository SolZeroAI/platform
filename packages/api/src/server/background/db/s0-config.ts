import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { SecretReference } from "@solzero/shared"
import { decryptSecret, encryptSecret } from "../auth/crypto"
import { toError } from "../../lib/effect-errors"
import { parseJson, stringifyJson } from "../../lib/json"
import { runEffectPromise } from "../../lib/effect-promise"
import type { Env } from "../types"

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

type DeploymentBindings = { readonly [bindingName: string]: unknown }

function readDeploymentBinding(env: Env, bindingName: string): unknown {
  // Worker env objects keep deployment config and secrets on string binding names.
  const bindings: DeploymentBindings = env

  return bindings[bindingName]
}

export function getS0DeploymentConfig<Config>(
  env: Env,
  bindingName: string,
): Option.Option<Config> {
  const value = readDeploymentBinding(env, bindingName)
  const accepted = typeof value === "object" && value !== null && !Array.isArray(value)

  // SAFETY: accepted is true only for a non-array object. Config is the deployment object stored on this binding.
  return Match.value(accepted).pipe(
    Match.when(true, () => Option.some(value as Config)),
    Match.orElse(() => Option.none<Config>()),
  )
}

export function getS0DeploymentSecret(
  env: Env,
  reference: SecretReference | null | undefined,
): Option.Option<string> {
  return Option.fromNullishOr(reference).pipe(
    Option.flatMap((resolved) => Option.fromNullishOr(readDeploymentBinding(env, resolved.env))),
    Option.filter((value): value is string => typeof value === "string"),
    Option.filter((value) => value.length > 0),
  )
}

export interface S0ConfigEncryptedSecretRecord {
  encryptedValue: string
  createdAt: number
  updatedAt: number
}

export class S0ConfigEncryptionKeyMissingError extends Schema.TaggedError<S0ConfigEncryptionKeyMissingError>()(
  "S0ConfigEncryptionKeyMissingError",
  { message: Schema.String },
) {}

function requireEncryptionKey(encryptionKey: string | undefined) {
  return Effect.fromOption(Option.fromNullishOr(encryptionKey).pipe(Option.filter(Boolean))).pipe(
    Effect.mapError(
      () =>
        new S0ConfigEncryptionKeyMissingError({
          message: "REPO_SECRETS_ENCRYPTION_KEY not configured",
        }),
    ),
  )
}

function timestampOrZero(value: unknown) {
  return Option.liftPredicate(value, P.isNumber).pipe(Option.getOrElse(() => 0))
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
      createdAt: timestampOrZero(record.createdAt),
      updatedAt: timestampOrZero(record.updatedAt),
    })),
  )
}

function nextKvCursor(page: KVNamespaceListResult<unknown, string>) {
  return Match.value(page).pipe(
    Match.when({ list_complete: false }, (more) => Option.some(Option.some(more.cursor))),
    Match.orElse(() => Option.none<Option.Option<string>>()),
  )
}

function listKvKeyNames(kv: KVNamespace, prefix: string) {
  return Stream.paginate(Option.none<string>(), (cursor) =>
    Effect.tryPromise({
      try: () =>
        kv.list({
          prefix,
          ...Option.match(cursor, {
            onNone: () => ({}),
            onSome: (value) => ({ cursor: value }),
          }),
        }),
      catch: toError,
    }).pipe(Effect.map((page) => [page.keys.map((key) => key.name), nextKvCursor(page)] as const)),
  ).pipe(Stream.runCollect)
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

    return yield* Effect.transposeOption(
      Option.map(Option.fromNullishOr(raw), (resolved) =>
        Effect.try({
          // SAFETY: parseJson(resolved) was stored by this service in the T shape.
          try: () => parseJson(resolved) as T,
          catch: toError,
        }),
      ),
    )
  })

  listKeys = Effect.fn("db.s0Config.listKeys")(function* (this: S0ConfigStore, prefix: string) {
    return yield* listKvKeyNames(this.kv, prefix)
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

    return yield* Effect.transposeOption(
      Option.map(record, (resolved) => decryptSecret(resolved.encryptedValue, encryptionKey)),
    )
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
    getJson: (key) => runEffectPromise(store.getJson(key)),
    putJson: (key, value) => runEffectPromise(store.putJson(key, value)),
    encryptedSecretConfigured: (key) => runEffectPromise(store.encryptedSecretConfigured(key)),
    getEncryptedSecret: (key) => runEffectPromise(store.getEncryptedSecret(key)),
    setEncryptedSecret: (key, plaintext) =>
      runEffectPromise(store.setEncryptedSecret(key, plaintext)),
  }
}
