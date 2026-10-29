import type { S0LitellmConfig } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
  S0_CONFIG_LOCATIONS,
  S0ConfigStore,
  getS0DeploymentConfig,
  getS0DeploymentSecret,
} from "../db/s0-config"
import { makeControlPlaneFromEnv } from "../../effect/db/control-plane-db"
import { CronRunsStore, sanitizeCronErrorMessage, type CronRunTrigger } from "../db/cron-runs"
import {
  type LitellmApiKeyPresence,
  type LitellmCatalogProvider,
  type LitellmModelDefinition,
  type LitellmModelRecord,
  type LitellmModelRegistry,
  type LitellmModelRegistryPresence,
  type LitellmProviderConfig,
  type LitellmProviderConfigPresence,
  type LitellmProviderConfigUpdate,
  type LitellmProviderSnapshot,
  type LitellmSyncResult,
} from "./litellm-types"
import { toError } from "../../lib/effect-errors"
import { parseJson } from "../../lib/json"
import {
  buildModelDefinition,
  buildProviderConfig,
  normalizeModelInfoResponse,
  readConfig,
  readRegistry,
} from "./litellm-models"
import type { Env } from "../types"

export const LITELLM_MODEL_SYNC_JOB_ID = "litellm-model-sync"
export const LITELLM_MODEL_SYNC_STANDARD_CRON = "0 14 * * *"
export const LITELLM_MODEL_SYNC_DST_CRON = "0 13 * * *"

export const LITELLM_MODEL_SYNC_CRONS = [
  LITELLM_MODEL_SYNC_DST_CRON,
  LITELLM_MODEL_SYNC_STANDARD_CRON,
] as const

const MODEL_INFO_PATH = "/v1/model/info"

class LitellmConfigError extends Schema.TaggedError<LitellmConfigError>()("LitellmConfigError", {
  message: Schema.String,
}) {}

type LitellmSecretReference = NonNullable<S0LitellmConfig["apiKey"]>

/** Fails with `message` when `condition` holds, otherwise no-ops. */
function failWhen(condition: boolean, message: string) {
  const failure = Effect.fail(new LitellmConfigError({ message }))
  const guard = Effect.succeed(condition)

  return Effect.when(failure, guard)
}

function getStore(env: Env): S0ConfigStore {
  return new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
}

function deploymentConfigPresence(value: Option.Option<S0LitellmConfig>) {
  return {
    configured: true,
    source: "deployment" as const,
    locked: true,
    envVarName: S0_CONFIG_LOCATIONS.litellm,
    config: readConfig(value),
  } satisfies LitellmProviderConfigPresence
}

function kvConfigPresence(value: Option.Option<unknown>) {
  const source = Match.value(Option.isSome(value)).pipe(
    Match.when(true, () => "kv" as const),
    Match.orElse(() => "default" as const),
  )

  return {
    configured: Option.isSome(value),
    source,
    locked: false,
    envVarName: null,
    config: readConfig(value),
  } satisfies LitellmProviderConfigPresence
}

function readKvConfigPresence(env: Env) {
  return getStore(env)
    .getJson(S0_CONFIG_KEYS.aiProviders.litellmConfig)
    .pipe(Effect.map(kvConfigPresence))
}

export const getLitellmConfigWithPresence = Effect.fn("aiProviders.litellm.getConfig")(function* (
  env: Env,
) {
  const deploymentValue = getS0DeploymentConfig<S0LitellmConfig>(env, S0_CONFIG_BINDINGS.litellm)

  return yield* Option.match(deploymentValue, {
    onNone: () => readKvConfigPresence(env),
    onSome: () => Effect.succeed(deploymentConfigPresence(deploymentValue)),
  })
})

export const getLitellmModelRegistryWithPresence = Effect.fn(
  "aiProviders.litellm.getModelRegistryWithPresence",
)(function* (env: Env) {
  const value = yield* getStore(env).getJson(S0_CONFIG_KEYS.aiProviders.litellmModels)

  const source = Match.value(Option.isSome(value)).pipe(
    Match.when(true, () => "kv" as const),
    Match.orElse(() => "none" as const),
  )

  return {
    registry: Option.getOrNull(readRegistry(value)),
    source,
    locked: false,
    envVarName: null,
  } satisfies LitellmModelRegistryPresence
})

export const getLitellmModelRegistry = Effect.fn("aiProviders.litellm.getModelRegistry")(function* (
  env: Env,
) {
  const { registry } = yield* getLitellmModelRegistryWithPresence(env)

  return registry
})

function deploymentApiKeyReference(env: Env): Option.Option<LitellmSecretReference> {
  return Option.flatMap(
    getS0DeploymentConfig<S0LitellmConfig>(env, S0_CONFIG_BINDINGS.litellm),
    (config) => Option.fromNullishOr(config.apiKey),
  )
}

// A deployment config that names an API key binding must provide it. A missing binding is a defect.
function requireDeploymentApiKey(env: Env, reference: LitellmSecretReference) {
  return Effect.fromOption(getS0DeploymentSecret(env, reference)).pipe(
    Effect.catch(() =>
      Effect.die(new Error(`${reference.env} is required by ${S0_CONFIG_LOCATIONS.litellm}`)),
    ),
  )
}

function deploymentApiKeyPresence(apiKey: Option.Option<string>) {
  return {
    configured: true,
    source: "deployment" as const,
    locked: true,
    envVarName: `${S0_CONFIG_LOCATIONS.litellm}.apiKey`,
    apiKey,
  } satisfies LitellmApiKeyPresence
}

function deploymentApiKeyStatus(env: Env, reference: LitellmSecretReference) {
  return requireDeploymentApiKey(env, reference).pipe(
    Effect.map(() => deploymentApiKeyPresence(Option.none<string>())),
  )
}

function readDeploymentApiKeyPresence(env: Env, reference: LitellmSecretReference) {
  return requireDeploymentApiKey(env, reference).pipe(
    Effect.map((apiKey) => deploymentApiKeyPresence(Option.some(apiKey))),
  )
}

function kvApiKeyStatus(configured: boolean) {
  const source = Match.value(configured).pipe(
    Match.when(true, () => "kv" as const),
    Match.orElse(() => "none" as const),
  )

  return {
    configured,
    source,
    locked: false,
    envVarName: null,
    apiKey: Option.none<string>(),
  } satisfies LitellmApiKeyPresence
}

function readKvApiKeyStatus(env: Env) {
  return getStore(env)
    .encryptedSecretConfigured(S0_CONFIG_KEYS.aiProviders.litellmApiKey)
    .pipe(Effect.map(kvApiKeyStatus))
}

export const getLitellmApiKeyStatus = Effect.fn("aiProviders.litellm.getApiKeyStatus")(function* (
  env: Env,
) {
  return yield* Option.match(deploymentApiKeyReference(env), {
    onNone: () => readKvApiKeyStatus(env),
    onSome: (reference) => deploymentApiKeyStatus(env, reference),
  })
})

function kvApiKeyPresence(apiKey: Option.Option<string>) {
  return {
    configured: Option.isSome(apiKey),
    source: "kv" as const,
    locked: false,
    envVarName: null,
    apiKey,
  } satisfies LitellmApiKeyPresence
}

function readKvApiKeyPresence(store: S0ConfigStore) {
  return store
    .getEncryptedSecret(S0_CONFIG_KEYS.aiProviders.litellmApiKey)
    .pipe(Effect.map(kvApiKeyPresence))
}

function readConfiguredKvApiKey(store: S0ConfigStore, configured: boolean) {
  return Match.value(configured).pipe(
    Match.when(false, () => Effect.succeed(kvApiKeyStatus(false))),
    Match.orElse(() => readKvApiKeyPresence(store)),
  )
}

function readKvApiKeyWithPresence(env: Env) {
  const store = getStore(env)

  return store
    .encryptedSecretConfigured(S0_CONFIG_KEYS.aiProviders.litellmApiKey)
    .pipe(Effect.flatMap((configured) => readConfiguredKvApiKey(store, configured)))
}

export const getLitellmApiKeyWithPresence = Effect.fn("aiProviders.litellm.getApiKeyWithPresence")(
  function* (env: Env) {
    return yield* Option.match(deploymentApiKeyReference(env), {
      onNone: () => readKvApiKeyWithPresence(env),
      onSome: (reference) => readDeploymentApiKeyPresence(env, reference),
    })
  },
)

export const getLitellmApiKey = Effect.fn("aiProviders.litellm.getApiKey")(function* (env: Env) {
  const presence = yield* getLitellmApiKeyWithPresence(env)

  return presence.apiKey
})

export const updateLitellmProviderConfig = Effect.fn("aiProviders.litellm.updateProviderConfig")(
  function* (env: Env, update: LitellmProviderConfigUpdate) {
    const store = getStore(env)
    const existing = yield* getLitellmConfigWithPresence(env)
    yield* failWhen(
      existing.locked,
      `LiteLLM config is managed by ${existing.envVarName ?? "deployment configuration"}; remove it from the active stage config to edit it in Admin`,
    )

    const apiKeyStatus = yield* getLitellmApiKeyStatus(env)

    const apiKey = Option.fromNullishOr(update.apiKey).pipe(
      Option.map((value) => value.trim()),
      Option.filter((value) => value.length > 0),
    )

    yield* failWhen(
      Option.isSome(apiKey) && apiKeyStatus.locked,
      `LiteLLM API key is managed by ${apiKeyStatus.envVarName ?? "deployment configuration"}; remove the apiKey reference from the active stage config to edit it in Admin`,
    )

    const registry = yield* getLitellmModelRegistry(env)
    const now = Date.now()

    const config = yield* Effect.try({
      try: () => buildProviderConfig(update, registry, existing.config.createdAt, now),
      catch: toError,
    })

    yield* store.putJson(S0_CONFIG_KEYS.aiProviders.litellmConfig, config)
    yield* Option.match(apiKey, {
      onNone: () => Effect.void,
      onSome: (value) => store.setEncryptedSecret(S0_CONFIG_KEYS.aiProviders.litellmApiKey, value),
    })

    return config
  },
)

const fetchLitellmModelInfo = Effect.fn("aiProviders.litellm.fetchModelInfo")(function* (
  config: LitellmProviderConfig,
  apiKey: string,
) {
  const url = new URL(MODEL_INFO_PATH, `${config.baseUrl}/`)

  const response = yield* Effect.tryPromise({
    try: () =>
      // oxlint-disable-next-line effect/avoid-native-fetch -- External LiteLLM proxy boundary from a Worker cron/admin action; HttpClient is not wired into this background module.
      fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }),
    catch: toError,
  })

  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: toError,
  })

  yield* failWhen(
    !response.ok,
    `LiteLLM model info request failed (${response.status}): ${text.slice(0, 500)}`,
  )

  return yield* Effect.try({
    try: () => parseJson(text),
    catch: toError,
  })
})

const insertSyncRun = Effect.fn("aiProviders.litellm.insertSyncRun")(function* (
  env: Env,
  input: {
    cron?: string | null
    trigger: CronRunTrigger
    startedAt: number
    status: "success" | "failure" | "skipped"
    result?: Record<string, unknown>
    error?: unknown
    actorUserId?: string | null
    actorEmail?: string | null
  },
) {
  const finishedAt = Date.now()

  const errorMessage = Option.liftPredicate(input.error, Boolean).pipe(
    Option.map(sanitizeCronErrorMessage),
    Option.getOrNull,
  )

  return yield* new CronRunsStore(makeControlPlaneFromEnv(env)).insertRun({
    jobId: LITELLM_MODEL_SYNC_JOB_ID,
    cron: input.cron ?? null,
    trigger: input.trigger,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt,
    result: input.result ?? {},
    errorMessage,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
  })
})

interface LitellmSyncInput {
  trigger: CronRunTrigger
  cron?: string | null
  actorUserId?: string | null
  actorEmail?: string | null
}

function skipDisabledSync(env: Env, input: LitellmSyncInput, startedAt: number) {
  return insertSyncRun(env, {
    ...input,
    startedAt,
    status: "skipped",
    result: { reason: "disabled" },
  }).pipe(
    Effect.map(
      (run) =>
        ({
          status: "skipped" as const,
          models: 0,
          registryUpdatedAt: null,
          reason: "disabled",
          run,
        }) satisfies LitellmSyncResult,
    ),
  )
}

function recordSyncFailure(env: Env, input: LitellmSyncInput, startedAt: number, error: unknown) {
  return insertSyncRun(env, {
    ...input,
    startedAt,
    status: "failure",
    result: {},
    error,
  }).pipe(
    Effect.map(
      (run) =>
        ({
          status: "failure" as const,
          models: 0,
          registryUpdatedAt: null,
          reason: sanitizeCronErrorMessage(error),
          run,
        }) satisfies LitellmSyncResult,
    ),
  )
}

function runEnabledSync(
  env: Env,
  input: LitellmSyncInput,
  config: LitellmProviderConfig,
  startedAt: number,
) {
  return Effect.gen(function* () {
    yield* failWhen(!config.baseUrl, "LiteLLM base URL is required")
    const apiKey = yield* getLitellmApiKey(env)

    const resolvedApiKey = yield* Option.match(apiKey, {
      onNone: () =>
        Effect.fail(new LitellmConfigError({ message: "LiteLLM API key is not configured" })),
      onSome: Effect.succeed,
    })

    const body = yield* fetchLitellmModelInfo(config, resolvedApiKey)
    const now = Date.now()
    const registry = normalizeModelInfoResponse(body, config, now)
    yield* getStore(env).putJson(S0_CONFIG_KEYS.aiProviders.litellmModels, registry)

    const run = yield* insertSyncRun(env, {
      ...input,
      startedAt,
      status: "success",
      result: {
        models: Object.keys(registry.models).length,
        registryUpdatedAt: registry.updatedAt,
      },
    })

    return {
      status: "success" as const,
      models: Object.keys(registry.models).length,
      registryUpdatedAt: registry.updatedAt,
      run,
    } satisfies LitellmSyncResult
  }).pipe(Effect.catch((error) => recordSyncFailure(env, input, startedAt, error)))
}

export const syncLitellmModels = Effect.fn("aiProviders.litellm.syncModels")(function* (
  env: Env,
  input: LitellmSyncInput,
) {
  const startedAt = Date.now()
  const { config } = yield* getLitellmConfigWithPresence(env)

  return yield* Match.value(config.enabled).pipe(
    Match.when(false, () => skipDisabledSync(env, input, startedAt)),
    Match.orElse(() => runEnabledSync(env, input, config, startedAt)),
  )
})

export const getLitellmProviderSnapshot = Effect.fn("aiProviders.litellm.getProviderSnapshot")(
  function* (env: Env) {
    const [configPresence, registryPresence, apiKeyStatus, cronStatus] = yield* Effect.all(
      [
        getLitellmConfigWithPresence(env),
        getLitellmModelRegistryWithPresence(env),
        getLitellmApiKeyStatus(env),
        new CronRunsStore(makeControlPlaneFromEnv(env)).getJobStatus(LITELLM_MODEL_SYNC_JOB_ID),
      ],
      { concurrency: "unbounded" },
    )

    return {
      configured: configPresence.configured,
      apiKeyConfigured: apiKeyStatus.configured,
      configSource: configPresence.source,
      configLocked: configPresence.locked,
      configEnvVarName: configPresence.envVarName,
      apiKeySource: apiKeyStatus.source,
      apiKeyLocked: apiKeyStatus.locked,
      apiKeyEnvVarName: apiKeyStatus.envVarName,
      registrySource: registryPresence.source,
      registryLocked: registryPresence.locked,
      registryEnvVarName: registryPresence.envVarName,
      config: configPresence.config,
      registry: registryPresence.registry,
      cronStatus,
    } satisfies LitellmProviderSnapshot
  },
)

function isAnthropicDefinition(model: LitellmModelRecord): boolean {
  return model.aiSdkAdapter === "@ai-sdk/anthropic"
}

function modelDefinitions(
  registry: LitellmModelRegistry,
  include: (model: LitellmModelRecord) => boolean,
): Record<string, LitellmModelDefinition> {
  return Object.fromEntries(
    Object.entries(registry.models)
      .filter(([, model]) => include(model))
      .map(([modelId, model]) => [modelId, buildModelDefinition(model)] as const),
  )
}

function buildCatalog(
  config: LitellmProviderConfig,
  registry: LitellmModelRegistry,
  apiKey: Option.Option<string>,
) {
  const resolvedApiKey = Option.getOrNull(apiKey)

  const providers: LitellmCatalogProvider[] = [
    {
      provider: {
        providerId: "litellm",
        name: "LiteLLM",
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: config.baseUrl,
          timeout: 600000,
          includeUsage: true,
        },
        models: modelDefinitions(registry, (model) => !isAnthropicDefinition(model)),
      },
      apiKey: resolvedApiKey,
    },
    {
      provider: {
        providerId: "litellm-anthropic",
        name: "LiteLLM Anthropic",
        npm: "@ai-sdk/anthropic",
        options: {
          baseURL: `${config.baseUrl}/anthropic/v1`,
        },
        models: modelDefinitions(registry, isAnthropicDefinition),
      },
      apiKey: resolvedApiKey,
    },
  ].filter((entry) => Object.keys(entry.provider.models).length > 0)

  const defaultModel = Option.liftPredicate(config.defaultModel, (modelId): modelId is string =>
    Boolean(modelId),
  ).pipe(
    Option.flatMap((modelId) =>
      Option.fromNullishOr(providers.find((entry) => Boolean(entry.provider.models[modelId]))).pipe(
        Option.map((entry) => `${entry.provider.providerId}/${modelId}`),
      ),
    ),
    Option.getOrNull,
  )

  return { defaultModel, providers }
}

export const buildLitellmCatalogProviders = Effect.fn("aiProviders.litellm.buildCatalogProviders")(
  function* (env: Env) {
    const [{ configured, config }, registry, apiKey] = yield* Effect.all(
      [getLitellmConfigWithPresence(env), getLitellmModelRegistry(env), getLitellmApiKey(env)],
      { concurrency: "unbounded" },
    )

    return Option.fromNullishOr(registry).pipe(
      Option.filter(
        (models) => configured && config.enabled && Object.keys(models.models).length > 0,
      ),
      Option.map((models) => buildCatalog(config, models, apiKey)),
    )
  },
)

export function isNineAmAmericaNewYork(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const hour = parts.find((part) => part.type === "hour")?.value
  const minute = parts.find((part) => part.type === "minute")?.value

  return hour === "09" && minute === "00"
}

function skipOffScheduleSync(env: Env, input: { cron: string; scheduledTime: number }) {
  return insertSyncRun(env, {
    trigger: "scheduled",
    cron: input.cron,
    startedAt: Date.now(),
    status: "skipped",
    result: { reason: "not_9am_america_new_york", scheduledTime: input.scheduledTime },
  }).pipe(
    Effect.map(
      (run) =>
        ({
          status: "skipped" as const,
          models: 0,
          registryUpdatedAt: null,
          reason: "not_9am_america_new_york",
          run,
        }) satisfies LitellmSyncResult,
    ),
  )
}

export const runScheduledLitellmSync = Effect.fn("aiProviders.litellm.runScheduledSync")(function* (
  env: Env,
  input: { cron: string; scheduledTime: number },
) {
  return yield* Match.value(isNineAmAmericaNewYork(new Date(input.scheduledTime))).pipe(
    Match.when(false, () => skipOffScheduleSync(env, input)),
    Match.orElse(() => syncLitellmModels(env, { trigger: "scheduled", cron: input.cron })),
  )
})
