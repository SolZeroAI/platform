import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  CLOUDFLARE_AI_GATEWAY_API_HOST,
  CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
  cloudflareAiGatewayRestBaseUrl,
  getCloudflareAiGatewaySnapshot,
} from "../../ai-providers/cloudflare-ai-gateway"
import { getLitellmConfigWithPresence } from "../../ai-providers/litellm"
import type { Env } from "../../types"

export const SHARED_PROVIDER_OUTBOUND_HANDLER = "sharedProvider"
export const S0_CONFIG_LITELLM_API_KEY_SECRET = "S0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY"

function hostnameFromUrl(value: string): Option.Option<string> {
  return Option.some(value).pipe(
    Option.filter((candidate) => URL.canParse(candidate)),
    Option.map((candidate) => new URL(candidate).hostname),
  )
}

export const resolveSharedProviderOutboundHosts = Effect.fn(
  "sandbox.sharedProvider.resolveOutboundHosts",
)(function* (env: Env) {
  const { configured, config } = yield* getLitellmConfigWithPresence(env)
  const litellmHost = Match.value(Boolean(configured && config.enabled && config.baseUrl)).pipe(
    Match.when(true, () => hostnameFromUrl(config.baseUrl)),
    Match.orElse(() => Option.none<string>()),
  )
  const cloudflareHost = getCloudflareAiGatewaySnapshot(env).pipe(
    Option.filter(
      ({ config: gatewayConfig, gatewayId }) =>
        gatewayConfig.enabled &&
        Option.isSome(gatewayId) &&
        Option.isSome(cloudflareAiGatewayRestBaseUrl(env)) &&
        Option.isSome(stringEnvValue(env, CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET)),
    ),
    Option.map(() => CLOUDFLARE_AI_GATEWAY_API_HOST),
  )
  return [litellmHost, cloudflareHost].flatMap((host) =>
    Option.match(host, { onNone: () => [], onSome: (value) => [value] }),
  )
})

export interface SharedProviderCredential {
  readonly secretName: string
  readonly headers?: Readonly<Record<string, string>>
}

function cloudflareAiGatewayPathPrefix(env: Record<string, unknown>): Option.Option<string> {
  return stringEnvValue(env, "CLOUDFLARE_ACCOUNT_ID").pipe(
    Option.map((accountId) => `/client/v4/accounts/${accountId}/ai/v1/`),
  )
}

export function resolveSharedProviderCredential(
  env: Record<string, unknown>,
  url: URL,
): Option.Option<SharedProviderCredential> {
  return Match.value(url.hostname === CLOUDFLARE_AI_GATEWAY_API_HOST).pipe(
    Match.when(false, () => Option.some({ secretName: S0_CONFIG_LITELLM_API_KEY_SECRET })),
    Match.orElse(() =>
      cloudflareAiGatewayPathPrefix(env).pipe(
        Option.filter((pathPrefix) => url.pathname.startsWith(pathPrefix)),
        Option.flatMap(() => stringEnvValue(env, "AI_GATEWAY_ID")),
        Option.map((gatewayId) => ({
          secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
          headers: { "cf-aig-gateway-id": gatewayId },
        })),
      ),
    ),
  )
}

export function sharedProviderPathClass(
  url: URL,
): "anthropic" | "cloudflare-ai-gateway" | "default" {
  return Match.value(url.hostname === CLOUDFLARE_AI_GATEWAY_API_HOST).pipe(
    Match.when(true, () => "cloudflare-ai-gateway" as const),
    Match.orElse(() =>
      Match.value(url.pathname.startsWith("/anthropic/")).pipe(
        Match.when(true, () => "anthropic" as const),
        Match.orElse(() => "default" as const),
      ),
    ),
  )
}

export function resolveSharedProviderApiKey(
  env: Record<string, unknown>,
  secretName: string,
): Option.Option<string> {
  return stringEnvValue(env, secretName)
}

export async function sharedProviderRequestModel(request: Request): Promise<string | null> {
  const isJsonRequest = Option.fromNullishOr(request.headers.get("content-type")).pipe(
    Option.map((contentType) => contentType.toLowerCase().includes("application/json")),
    Option.getOrElse(() => false),
  )
  return Match.value(isJsonRequest).pipe(
    Match.when(false, () => Promise.resolve(null)),
    Match.orElse(() =>
      request
        .clone()
        .json()
        .then(requestModelFromBody)
        .then(Option.getOrNull)
        .catch(() => null),
    ),
  )
}

function requestModelFromBody(body: unknown): Option.Option<string> {
  return Option.fromNullishOr(body).pipe(
    Option.filter(
      (candidate): candidate is Record<string, unknown> =>
        typeof candidate === "object" && !Array.isArray(candidate),
    ),
    Option.map((record) => Reflect.get(record, "model")),
    Option.filter((model): model is string => typeof model === "string" && model.length > 0),
  )
}

export function requestWithSharedProviderCredential(
  request: Request,
  apiKey: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Request {
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${apiKey}`)
  Object.entries(extraHeaders ?? {}).forEach(([name, value]) => headers.set(name, value))
  headers.delete("cookie")
  return new Request(sharedProviderTargetUrl(request), sharedProviderRequestInit(request, headers))
}

function sharedProviderTargetUrl(request: Request): string {
  const url = new URL(request.url)
  return `https://${url.hostname}${url.pathname}${url.search}`
}

function sharedProviderRequestInit(request: Request, headers: Headers): RequestInit {
  return Match.value(request.method === "GET" || request.method === "HEAD").pipe(
    Match.when(true, () => ({
      headers,
      method: request.method,
    })),
    Match.orElse(() => ({
      body: request.body,
      headers,
      method: request.method,
    })),
  )
}

function stringEnvValue(env: Record<string, unknown>, key: string): Option.Option<string> {
  const value = Reflect.get(env, key)
  return Option.flatMap(
    Option.liftPredicate(value, (candidate): candidate is string => typeof candidate === "string"),
    (text) => Option.liftPredicate(text.trim(), (trimmed) => trimmed.length > 0),
  )
}
