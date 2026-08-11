import {
  buildModelId,
  cloudflareAiGatewayByokProviderForModel,
  CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  getCloudflareAiGatewayErrorHelp,
  type CloudflareAiGatewayByokKeyMap,
  type CloudflareAiGatewayByokProvider,
  type S0CloudflareAiGatewayConfig,
  type SharedProviderDefinition,
} from "@solzero/shared"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  getS0DeploymentConfig,
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
  S0ConfigStore,
} from "../db/s0-config"
import type { Env } from "../types"

export { CLOUDFLARE_AI_GATEWAY_PROVIDER_ID } from "@solzero/shared"

export const CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME = "Cloudflare AI Gateway"
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_PACKAGE = "workers-ai-provider"
export const CLOUDFLARE_AI_GATEWAY_API_HOST = "api.cloudflare.com"
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST = "gateway.ai.cloudflare.com"
export const CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET = "CLOUDFLARE_AI_GATEWAY_RUN_TOKEN"
export const CLOUDFLARE_AI_GATEWAY_STORED_KEY_PLACEHOLDER = "s0-cloudflare-ai-gateway-stored-key"
export const CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX = "s0-cloudflare-ai-gateway-byok:"

function actionableErrorResponse(
  response: Response,
  help: NonNullable<ReturnType<typeof getCloudflareAiGatewayErrorHelp>>,
): Response {
  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  headers.set("content-type", "application/json")
  return Response.json(
    {
      error: {
        type: help.kind,
        code: help.kind,
        message: help.apiMessage,
      },
    },
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  )
}

async function normalizeCloudflareAiGatewayErrorResponse(response: Response): Promise<Response> {
  const upstreamBody = await response
    .clone()
    .text()
    .catch(() => "")
  return Option.match(
    Option.fromNullishOr(getCloudflareAiGatewayErrorHelp(upstreamBody, response.status)),
    {
      onNone: () => response,
      onSome: (help) => actionableErrorResponse(response, help),
    },
  )
}

export function normalizeCloudflareAiGatewayResponse(response: Response): Promise<Response> {
  return Match.value(response.ok).pipe(
    Match.when(true, () => Promise.resolve(response)),
    Match.orElse(() => normalizeCloudflareAiGatewayErrorResponse(response)),
  )
}

export interface CloudflareAiGatewaySnapshot {
  readonly config: S0CloudflareAiGatewayConfig
  readonly gatewayId: Option.Option<string>
  readonly bindingConfigured: boolean
  readonly secretsStoreConfigured: boolean
}

export type CloudflareAiGatewayProviderKeySource = "deployment" | "admin" | "none"

export interface CloudflareAiGatewayProviderKeyStatus {
  readonly providerId: CloudflareAiGatewayByokProvider
  readonly name: string
  readonly configured: boolean
  readonly source: CloudflareAiGatewayProviderKeySource
  readonly locked: boolean
  readonly envVarName: string | null
}

export interface CloudflareAiGatewayProviderKeyUpdate {
  readonly providerId: CloudflareAiGatewayByokProvider
  readonly apiKey?: string
  readonly clearApiKey?: boolean
}

class CloudflareAiGatewayProviderKeyConfigError extends Schema.TaggedErrorClass<CloudflareAiGatewayProviderKeyConfigError>()(
  "CloudflareAiGatewayProviderKeyConfigError",
  { message: Schema.String },
) {}

function readStringBinding(env: Env, name: string): Option.Option<string> {
  return Option.fromNullishOr(Reflect.get(env, name)).pipe(
    Option.filter((value): value is string => typeof value === "string"),
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
  )
}

export function cloudflareAiGatewayRestBaseUrl(env: Env): Option.Option<string> {
  return readStringBinding(env, "CLOUDFLARE_ACCOUNT_ID").pipe(
    Option.map(
      (accountId) =>
        `https://${CLOUDFLARE_AI_GATEWAY_API_HOST}/client/v4/accounts/${accountId}/ai/v1`,
    ),
  )
}

export function cloudflareAiGatewayProviderNativeBaseUrl(
  env: Env,
  modelId: string,
): Option.Option<string> {
  const provider = Option.fromNullishOr(cloudflareAiGatewayByokProviderForModel(modelId))
  return Option.all({
    accountId: readStringBinding(env, "CLOUDFLARE_ACCOUNT_ID"),
    gatewayId: readGatewayId(env),
    provider,
  }).pipe(
    Option.map(
      ({ accountId, gatewayId, provider: resolved }) =>
        `https://${CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST}/v1/${accountId}/${gatewayId}/${resolved.providerSlug}`,
    ),
  )
}

function readGatewayId(env: Env): Option.Option<string> {
  return readStringBinding(env, "AI_GATEWAY_ID")
}

function createCloudflareAiGatewaySnapshot(
  env: Env,
  config: S0CloudflareAiGatewayConfig,
): CloudflareAiGatewaySnapshot {
  const gatewayId = readGatewayId(env)
  return {
    config,
    gatewayId,
    bindingConfigured: Reflect.get(env, "AI_GATEWAY") !== undefined,
    secretsStoreConfigured: Option.isSome(readStringBinding(env, "AI_GATEWAY_SECRETS_STORE_ID")),
  }
}

function configStore(env: Env): S0ConfigStore {
  return new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
}

function deploymentProviderKeyReference(
  config: S0CloudflareAiGatewayConfig,
  providerId: CloudflareAiGatewayByokProvider,
) {
  return Option.fromNullishOr(config.providerKeys?.[providerId])
}

const getCloudflareAiGatewayProviderKeyStatus = Effect.fn(
  "aiProviders.cloudflareAiGateway.getProviderKeyStatus",
)(function* (env: Env, provider: (typeof CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS)[number]) {
  const config = Option.map(getCloudflareAiGatewaySnapshot(env), (snapshot) => snapshot.config)
  const deploymentReference = Option.flatMap(config, (resolved) =>
    deploymentProviderKeyReference(resolved, provider.id),
  )
  const adminConfigured = yield* configStore(env).encryptedSecretConfigured(
    S0_CONFIG_KEYS.aiProviders.cloudflareAiGatewayProviderKey(provider.id),
  )
  const adminSource = Match.value(adminConfigured).pipe(
    Match.when(true, () => "admin" as const),
    Match.orElse(() => "none" as const),
  )
  const adminStatus = {
    providerId: provider.id,
    name: provider.name,
    configured: adminConfigured,
    source: adminSource,
    locked: false,
    envVarName: null,
  }
  return Option.getOrElse(
    Option.map(deploymentReference, (reference) => ({
      providerId: provider.id,
      name: provider.name,
      configured: true,
      source: "deployment" as const,
      locked: true,
      envVarName: reference.env,
    })),
    () => adminStatus,
  )
})

export const getCloudflareAiGatewayProviderKeyStatuses = Effect.fn(
  "aiProviders.cloudflareAiGateway.getProviderKeyStatuses",
)(function* (env: Env) {
  return yield* Effect.forEach(
    CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS,
    (provider) => getCloudflareAiGatewayProviderKeyStatus(env, provider),
    { concurrency: "unbounded" },
  )
})

function readRuntimeProviderKey(
  store: S0ConfigStore,
  status: CloudflareAiGatewayProviderKeyStatus,
) {
  const isAdminKey = Effect.succeed(status.source === "admin")
  return store
    .getEncryptedSecret(
      S0_CONFIG_KEYS.aiProviders.cloudflareAiGatewayProviderKey(status.providerId),
    )
    .pipe(
      Effect.when(isAdminKey),
      Effect.map(Option.flatten),
      Effect.map((apiKey) => Option.map(apiKey, (value) => [status.providerId, value])),
    )
}

export const getCloudflareAiGatewayRuntimeProviderKeys = Effect.fn(
  "aiProviders.cloudflareAiGateway.getRuntimeProviderKeys",
)(function* (env: Env) {
  const statuses = yield* getCloudflareAiGatewayProviderKeyStatuses(env)
  const store = configStore(env)
  const entries = yield* Effect.forEach(
    statuses,
    (status) => readRuntimeProviderKey(store, status),
    { concurrency: "unbounded" },
  )
  return Object.fromEntries(Arr.getSomes(entries)) as CloudflareAiGatewayByokKeyMap
})

export const updateCloudflareAiGatewayProviderKeys = Effect.fn(
  "aiProviders.cloudflareAiGateway.updateProviderKeys",
)(function* (env: Env, updates: readonly CloudflareAiGatewayProviderKeyUpdate[]) {
  const statuses = yield* getCloudflareAiGatewayProviderKeyStatuses(env)
  const statusByProviderId = new Map(statuses.map((status) => [status.providerId, status]))
  const store = configStore(env)
  yield* Effect.forEach(
    updates,
    (update) =>
      Effect.gen(function* () {
        const status = yield* Effect.fromOption(
          Option.fromNullishOr(statusByProviderId.get(update.providerId)),
        ).pipe(
          Effect.mapError(
            () =>
              new CloudflareAiGatewayProviderKeyConfigError({
                message: `Unknown Cloudflare AI Gateway provider '${update.providerId}'`,
              }),
          ),
        )
        const apiKey = update.apiKey?.trim() ?? ""
        const mutation = apiKey.length > 0 || update.clearApiKey === true
        const rejectLockedMutation = Effect.fail(
          new CloudflareAiGatewayProviderKeyConfigError({
            message: `${status.name} API key is managed by ${status.envVarName ?? "deployment configuration"}`,
          }),
        )
        const isLockedMutation = Effect.succeed(status.locked && mutation)
        yield* rejectLockedMutation.pipe(Effect.when(isLockedMutation))
        const key = S0_CONFIG_KEYS.aiProviders.cloudflareAiGatewayProviderKey(update.providerId)
        const setApiKey = store.setEncryptedSecret(key, apiKey)
        const hasApiKey = Effect.succeed(apiKey.length > 0)
        yield* setApiKey.pipe(Effect.when(hasApiKey))
        const deleteApiKey = store.delete(key)
        const shouldDeleteApiKey = Effect.succeed(
          apiKey.length === 0 && update.clearApiKey === true,
        )
        yield* deleteApiKey.pipe(Effect.when(shouldDeleteApiKey))
      }),
    { concurrency: "unbounded" },
  )
  return yield* getCloudflareAiGatewayProviderKeyStatuses(env)
})

function createCloudflareAiGatewayCatalogProvider(env: Env, config: S0CloudflareAiGatewayConfig) {
  const options = Option.match(cloudflareAiGatewayRestBaseUrl(env), {
    onNone: () => undefined,
    onSome: (baseURL) => ({ baseURL }),
  })
  return {
    provider: {
      providerId: CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
      name: CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME,
      npm: CLOUDFLARE_AI_GATEWAY_PROVIDER_PACKAGE,
      options,
      models: config.models,
    },
    defaultModel: buildModelId(CLOUDFLARE_AI_GATEWAY_PROVIDER_ID, config.defaultModel),
  }
}

export function getCloudflareAiGatewaySnapshot(
  env: Env,
): Option.Option<CloudflareAiGatewaySnapshot> {
  return getS0DeploymentConfig<S0CloudflareAiGatewayConfig>(
    env,
    S0_CONFIG_BINDINGS.cloudflareAiGateway,
  ).pipe(Option.map((config) => createCloudflareAiGatewaySnapshot(env, config)))
}

export function buildCloudflareAiGatewayCatalogProvider(env: Env): Option.Option<{
  readonly provider: SharedProviderDefinition
  readonly defaultModel: string
}> {
  return getCloudflareAiGatewaySnapshot(env).pipe(
    Option.filter(
      ({ config, gatewayId, bindingConfigured }) =>
        config.enabled &&
        bindingConfigured &&
        Option.isSome(gatewayId) &&
        Object.keys(config.models).length > 0,
    ),
    Option.map(({ config }) => createCloudflareAiGatewayCatalogProvider(env, config)),
  )
}
