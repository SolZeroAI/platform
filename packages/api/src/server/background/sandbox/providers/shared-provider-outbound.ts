import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  CLOUDFLARE_AI_GATEWAY_API_HOST,
  CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST,
  CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
  cloudflareAiGatewayRestBaseUrl,
  getCloudflareAiGatewaySnapshot,
} from "../../ai-providers/cloudflare-ai-gateway"
import { getLitellmConfigWithPresence } from "../../ai-providers/litellm"
import { decryptSecret } from "../../auth/crypto"
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
  const cloudflareProviderNativeHost = Option.map(
    cloudflareHost,
    () => CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST,
  )
  return [litellmHost, cloudflareHost, cloudflareProviderNativeHost].flatMap((host) =>
    Option.match(host, { onNone: () => [], onSome: (value) => [value] }),
  )
})

export interface SharedProviderCredential {
  readonly kind: "bearer" | "cloudflare-rest" | "cloudflare-provider-native"
  readonly secretName: string
  readonly headers?: Readonly<Record<string, string>>
}

function cloudflareAiGatewayPathPrefix(env: Record<string, unknown>): Option.Option<string> {
  return stringEnvValue(env, "CLOUDFLARE_ACCOUNT_ID").pipe(
    Option.map((accountId) => `/client/v4/accounts/${accountId}/ai/v1/`),
  )
}

function cloudflareAiGatewayProviderNativePathPrefix(
  env: Record<string, unknown>,
): Option.Option<string> {
  return Option.all({
    accountId: stringEnvValue(env, "CLOUDFLARE_ACCOUNT_ID"),
    gatewayId: stringEnvValue(env, "AI_GATEWAY_ID"),
  }).pipe(Option.map(({ accountId, gatewayId }) => `/v1/${accountId}/${gatewayId}/`))
}

export function resolveSharedProviderCredential(
  env: Record<string, unknown>,
  url: URL,
): Option.Option<SharedProviderCredential> {
  return Match.value(url.hostname).pipe(
    Match.when(CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST, () =>
      cloudflareAiGatewayProviderNativePathPrefix(env).pipe(
        Option.filter((pathPrefix) => url.pathname.startsWith(pathPrefix)),
        Option.map(() => ({
          kind: "cloudflare-provider-native" as const,
          secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
        })),
      ),
    ),
    Match.when(CLOUDFLARE_AI_GATEWAY_API_HOST, () =>
      cloudflareAiGatewayPathPrefix(env).pipe(
        Option.filter((pathPrefix) => url.pathname.startsWith(pathPrefix)),
        Option.flatMap(() => stringEnvValue(env, "AI_GATEWAY_ID")),
        Option.map((gatewayId) => ({
          kind: "cloudflare-rest" as const,
          secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
          headers: { "cf-aig-gateway-id": gatewayId },
        })),
      ),
    ),
    Match.orElse(() =>
      Option.some({
        kind: "bearer" as const,
        secretName: S0_CONFIG_LITELLM_API_KEY_SECRET,
      }),
    ),
  )
}

export function sharedProviderPathClass(
  url: URL,
): "anthropic" | "cloudflare-ai-gateway" | "default" {
  return Match.value(
    url.hostname === CLOUDFLARE_AI_GATEWAY_API_HOST ||
      url.hostname === CLOUDFLARE_AI_GATEWAY_PROVIDER_NATIVE_HOST,
  ).pipe(
    Match.when(true, () => "cloudflare-ai-gateway" as const),
    Match.orElse(() =>
      Match.value(url.pathname.startsWith("/anthropic/")).pipe(
        Match.when(true, () => "anthropic" as const),
        Match.orElse(() => "default" as const),
      ),
    ),
  )
}

export function cloudflareAiGatewayByokProxyCiphertext(request: Request): Option.Option<string> {
  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  const credential = authorization ?? request.headers.get("x-api-key") ?? ""
  return Option.liftPredicate(credential, (value) =>
    value.startsWith(CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX),
  ).pipe(Option.map((value) => value.slice(CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX.length)))
}

export const decryptCloudflareAiGatewayByokProxyCredential = Effect.fn(
  "sandbox.sharedProvider.decryptCloudflareAiGatewayByokProxyCredential",
)(function* (request: Request, encryptionKey: string) {
  const ciphertext = cloudflareAiGatewayByokProxyCiphertext(request)
  const decryptCredential = decryptSecret(
    Option.getOrElse(ciphertext, () => ""),
    encryptionKey,
  )
  const hasCiphertext = Effect.succeed(Option.isSome(ciphertext))
  return yield* decryptCredential.pipe(Effect.when(hasCiphertext))
})

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

export function requestWithCloudflareProviderNativeCredential(
  request: Request,
  runToken: string,
  providerApiKey: Option.Option<string>,
): Request {
  const headers = new Headers(request.headers)
  headers.set("cf-aig-authorization", `Bearer ${runToken}`)
  headers.delete("authorization")
  headers.delete("x-api-key")
  Option.match(providerApiKey, {
    onNone: () => undefined,
    onSome: (apiKey) =>
      Match.value(new URL(request.url).pathname.split("/")[4] === "anthropic").pipe(
        Match.when(true, () => headers.set("x-api-key", apiKey)),
        Match.orElse(() => headers.set("authorization", `Bearer ${apiKey}`)),
      ),
  })
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
