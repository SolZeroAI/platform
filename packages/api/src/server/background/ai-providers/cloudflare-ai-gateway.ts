import {
  buildModelId,
  type S0CloudflareAiGatewayConfig,
  type SharedProviderDefinition,
} from "@solzero/shared"
import * as Option from "effect/Option"
import { getS0DeploymentConfig, S0_CONFIG_BINDINGS } from "../db/s0-config"
import type { Env } from "../types"

export const CLOUDFLARE_AI_GATEWAY_PROVIDER_ID = "cloudflare-ai-gateway"
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_NAME = "Cloudflare AI Gateway"
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_PACKAGE = "workers-ai-provider"
export const CLOUDFLARE_AI_GATEWAY_API_HOST = "api.cloudflare.com"
export const CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET = "CLOUDFLARE_AI_GATEWAY_RUN_TOKEN"

export interface CloudflareAiGatewaySnapshot {
  readonly config: S0CloudflareAiGatewayConfig
  readonly gatewayId: Option.Option<string>
  readonly bindingConfigured: boolean
}

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
  }
}

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
