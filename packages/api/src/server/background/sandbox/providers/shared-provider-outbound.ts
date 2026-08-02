import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { getLitellmConfigWithPresence } from "../../ai-providers/litellm"
import type { Env } from "../../types"

export const SHARED_PROVIDER_OUTBOUND_HANDLER = "sharedProvider"
export const C0_CONFIG_LITELLM_API_KEY_SECRET = "C0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY"

function hostnameFromUrl(value: string): Option.Option<string> {
  try {
    return Option.some(new URL(value).hostname)
  } catch {
    return Option.none()
  }
}

export const resolveSharedProviderOutboundHost = Effect.fn(
  "sandbox.sharedProvider.resolveOutboundHost",
)(function* (env: Env) {
  const { configured, config } = yield* getLitellmConfigWithPresence(env)
  return Match.value(Boolean(configured && config.enabled && config.baseUrl)).pipe(
    Match.when(true, () => hostnameFromUrl(config.baseUrl)),
    Match.orElse(() => Option.none<string>()),
  )
})

export function sharedProviderSecretName(_url: URL): string {
  return C0_CONFIG_LITELLM_API_KEY_SECRET
}

export function sharedProviderPathClass(url: URL): "anthropic" | "default" {
  return Match.value(url.pathname.startsWith("/anthropic/")).pipe(
    Match.when(true, () => "anthropic" as const),
    Match.orElse(() => "default" as const),
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

export function requestWithSharedProviderCredential(request: Request, apiKey: string): Request {
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${apiKey}`)
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
