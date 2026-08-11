import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { type LanguageModel, type ModelMessage } from "ai"
import { createWorkersAI } from "workers-ai-provider"
import type { CompiledOpenCodeConfig } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
  normalizeCloudflareAiGatewayResponse,
} from "../ai-providers/cloudflare-ai-gateway"
import { compileOpenCodeConfigForModel } from "../provider-catalog"
import {
  BackgroundTracing,
  makeBackgroundTracingLayer,
  type CloudflareTracing,
} from "../observability/tracing"
import type { Env } from "../types"

interface IsolateModelObservability {
  readonly tracing?: CloudflareTracing
}

interface CompiledProviderContext {
  env: Env
  providerId: string
  modelId: string
  config: CompiledOpenCodeConfig
  observability?: IsolateModelObservability
}

export interface IsolateModelContext {
  providerId: string
  modelId: string
  runtimeModelId: string
  model: LanguageModel
  providerOptions?: Record<string, JsonObject>
}

type SupportedProviderPackage =
  | "@ai-sdk/openai"
  | "@ai-sdk/openai-compatible"
  | "@ai-sdk/anthropic"
  | "workers-ai-provider"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
function toSupportedProviderPackage(value: string | undefined): SupportedProviderPackage {
  return Match.value(value).pipe(
    Match.whenOr(
      "@ai-sdk/openai",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/anthropic",
      "workers-ai-provider",
      (resolved) => resolved,
    ),
    Match.orElse(() => "@ai-sdk/openai-compatible" as const),
  )
}

function toStringRecord(value: unknown): Option.Option<Record<string, string>> {
  return Option.liftPredicate(
    value,
    (resolved) => typeof resolved === "object" && resolved !== null && !Array.isArray(resolved),
  ).pipe(
    Option.map((resolved) =>
      Object.entries(resolved as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    Option.filter((entries) => entries.length > 0),
    Option.map((entries) => Object.fromEntries(entries)),
  )
}

function toRecordOrEmpty(value: unknown): Record<string, unknown> {
  return Option.getOrElse(
    Option.liftPredicate(
      value,
      (resolved) => Boolean(resolved) && typeof resolved === "object",
    ).pipe(Option.map((resolved) => resolved as Record<string, unknown>)),
    (): Record<string, unknown> => ({}),
  )
}

function stringOption(value: unknown): Option.Option<string> {
  return Option.liftPredicate(value, (resolved): resolved is string => typeof resolved === "string")
}

function getSelectedProviderConfig(input: CompiledProviderContext) {
  const provider = Option.getOrThrowWith(
    Option.fromNullishOr(input.config.provider[input.providerId]),
    () => new Error(`Provider '${input.providerId}' is missing from compiled config`),
  )

  const providerOptions = toRecordOrEmpty(provider.options)
  const model = provider.models?.[input.modelId]
  const modelOptions = toRecordOrEmpty(model?.options)
  const providerPackage = toSupportedProviderPackage(model?.provider?.npm ?? provider.npm)

  return {
    providerPackage,
    providerOptions,
    modelOptions,
  }
}

function buildProviderOptions(input: {
  providerId: string
  providerPackage: SupportedProviderPackage
  modelOptions: Record<string, unknown>
  reasoningEffort?: string
}): Option.Option<Record<string, JsonObject>> {
  const reasoningOption = Match.value(input.providerPackage).pipe(
    Match.when("@ai-sdk/anthropic", (): JsonObject => ({})),
    Match.when("workers-ai-provider", () =>
      Option.getOrElse(
        Option.fromNullishOr(input.reasoningEffort).pipe(
          Option.filter((effort) => effort.length > 0),
          Option.map(
            (effort): JsonObject => ({
              reasoning_effort: Match.value(effort).pipe(
                Match.when("none", () => null),
                Match.orElse((value) => value),
              ),
            }),
          ),
        ),
        (): JsonObject => ({}),
      ),
    ),
    Match.orElse(() =>
      Option.getOrElse(
        Option.fromNullishOr(input.reasoningEffort).pipe(
          Option.filter((effort) => effort.length > 0),
          Option.map((effort): JsonObject => ({ reasoningEffort: effort })),
        ),
        (): JsonObject => ({}),
      ),
    ),
  )
  const options: JsonObject = {
    ...(input.modelOptions as JsonObject),
    ...reasoningOption,
  }
  const providerOptionsKey = Match.value(input.providerPackage).pipe(
    Match.when("workers-ai-provider", () => "workers-ai"),
    Match.orElse(() => input.providerId),
  )

  return Option.liftPredicate(options, (resolved) => Object.keys(resolved).length > 0).pipe(
    Option.map((resolved) => ({ [providerOptionsKey]: resolved })),
  )
}

function requireAiGatewayBinding(env: Env): Ai {
  return Option.getOrThrowWith(
    Option.fromNullishOr(env.AI_GATEWAY),
    () => new Error("Cloudflare AI Gateway is enabled but the AI_GATEWAY binding is missing"),
  )
}

function requireAiGatewayId(env: Env): string {
  return Option.getOrThrowWith(
    Option.fromNullishOr(env.AI_GATEWAY_ID).pipe(
      Option.filter((gatewayId) => gatewayId.trim().length > 0),
    ),
    () => new Error("Cloudflare AI Gateway is enabled but AI_GATEWAY_ID is missing"),
  )
}

async function executeProviderFetch(
  input: {
    providerId: string
    fetchImplementation?: typeof fetch
  },
  request: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const response = await Option.match(Option.fromNullishOr(input.fetchImplementation), {
    // oxlint-disable-next-line effect/avoid-native-fetch -- This IS the AI provider HTTP passthrough being traced; the AI SDK requires a native fetch implementation and no HttpClient layer is provisioned on this path.
    onNone: () => fetch(request, init),
    onSome: (fetchImplementation) => fetchImplementation(request, init),
  })
  return Match.value(input.providerId === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID).pipe(
    Match.when(true, () => normalizeCloudflareAiGatewayResponse(response)),
    Match.orElse(() => response),
  )
}

function createProviderFetch(input: {
  env: Env
  providerId: string
  providerPackage: SupportedProviderPackage
  modelId: string
  observability?: IsolateModelObservability
  fetchImplementation?: typeof fetch
}): typeof fetch {
  function tracedFetch(
    request: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const url = Match.value(typeof request === "string" || request instanceof URL).pipe(
      Match.when(true, () => request as string | URL),
      Match.orElse(() => (request as Request).url),
    )
    const parsed = new URL(String(url))
    const method =
      init?.method ??
      Match.value(request instanceof Request).pipe(
        Match.when(true, () => (request as Request).method),
        Match.orElse(() => "GET"),
      )
    const span = Effect.gen(function* () {
      const backgroundTracing = yield* BackgroundTracing
      return yield* backgroundTracing.withSpan(
        "ai.provider.fetch",
        {
          "ai.provider": input.providerId,
          "ai.provider_package": input.providerPackage,
          "ai.model": input.modelId,
          "http.request.method": method,
          "server.address": parsed.hostname,
          "url.path": parsed.pathname,
        },
        Effect.tryPromise({
          try: () => executeProviderFetch(input, request, init),
          catch: (cause) => cause,
        }),
      )
    }).pipe(Effect.provide(makeBackgroundTracingLayer(input.observability)))
    // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK provider fetch boundary requires a Promise; runs the ai.provider.fetch span Effect at that edge.
    return Effect.runPromise(span)
  }
  return tracedFetch
}

function createCloudflareAiGatewayProviderNativeFetch(input: {
  env: Env
  storedKey: boolean
}): typeof fetch {
  return async function cloudflareAiGatewayProviderNativeFetch(request, init) {
    const providerRequest = new Request(request, init)
    const headers = new Headers(providerRequest.headers)
    const runToken = Option.getOrThrowWith(
      stringOption(Reflect.get(input.env, CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET)).pipe(
        Option.filter((value) => value.trim().length > 0),
      ),
      () => new Error("Cloudflare AI Gateway run token is missing"),
    )
    headers.set("cf-aig-authorization", `Bearer ${runToken}`)
    Match.value(input.storedKey).pipe(
      Match.when(true, () => {
        headers.delete("authorization")
        headers.delete("x-api-key")
      }),
      Match.orElse(() => undefined),
    )
    // oxlint-disable-next-line effect/avoid-native-fetch -- Provider-native AI Gateway execution is the outbound AI provider boundary required for stored and per-request BYOK.
    return fetch(new Request(providerRequest, { headers }))
  }
}

function resolveLanguageModel(input: CompiledProviderContext): LanguageModel {
  const { providerPackage, providerOptions } = getSelectedProviderConfig(input)
  const apiKey = stringOption(providerOptions.apiKey)
  const baseURL = stringOption(providerOptions.baseURL)
  const headers = toStringRecord(providerOptions.headers)
  const cloudflareProviderNativeFetch = Match.value(
    input.providerId === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID &&
      providerPackage !== "workers-ai-provider",
  ).pipe(
    Match.when(true, () =>
      Option.some(
        createCloudflareAiGatewayProviderNativeFetch({
          env: input.env,
          storedKey: providerOptions.s0CloudflareStoredKey === true,
        }),
      ),
    ),
    Match.orElse(() => Option.none<typeof fetch>()),
  )
  const tracedFetch = createProviderFetch({
    env: input.env,
    providerId: input.providerId,
    providerPackage,
    modelId: input.modelId,
    observability: input.observability,
    fetchImplementation: Option.getOrUndefined(cloudflareProviderNativeFetch),
  })
  const resolvedApiKey = Option.getOrUndefined(apiKey)
  const resolvedBaseUrl = baseURL

  return Match.value(providerPackage).pipe(
    Match.when("workers-ai-provider", () =>
      createWorkersAI({
        binding: requireAiGatewayBinding(input.env),
        gateway: { id: requireAiGatewayId(input.env) },
      })(input.modelId),
    ),
    Match.when("@ai-sdk/openai", () =>
      createOpenAI({
        name: input.providerId,
        apiKey: resolvedApiKey,
        baseURL: Option.getOrUndefined(resolvedBaseUrl),
        fetch: tracedFetch,
        headers: Option.getOrUndefined(headers),
      }).responses(input.modelId),
    ),
    Match.when("@ai-sdk/anthropic", () =>
      createAnthropic({
        name: input.providerId,
        apiKey: resolvedApiKey,
        baseURL: Option.getOrUndefined(resolvedBaseUrl),
        fetch: tracedFetch,
        headers: Option.getOrUndefined(headers),
      })(input.modelId),
    ),
    Match.orElse(() =>
      createOpenAICompatible({
        name: input.providerId,
        apiKey: resolvedApiKey,
        baseURL: Option.getOrThrowWith(
          resolvedBaseUrl,
          () => new Error(`Provider '${input.providerId}' is missing a baseURL`),
        ),
        fetch: tracedFetch,
        headers: Option.getOrUndefined(headers),
        includeUsage: providerOptions.includeUsage === true,
      })(input.modelId),
    ),
  )
}

export const compileIsolateModelContext = Effect.fn("isolate.model.compileContext")(
  function* (input: {
    env: Env
    observability?: IsolateModelObservability
    userId: string
    model: string
    reasoningEffort?: string
  }) {
    const compiled = yield* Effect.tryPromise({
      try: () =>
        compileOpenCodeConfigForModel(input.env, input.userId, input.model, {
          sharedProviderCredentialMode: "direct",
        }),
      catch: (cause) => cause,
    })
    const providerContext = {
      ...compiled,
      env: input.env,
      observability: input.observability,
    }
    const { modelOptions, providerPackage } = getSelectedProviderConfig(providerContext)

    return {
      providerId: compiled.providerId,
      modelId: compiled.modelId,
      runtimeModelId: compiled.runtimeModelId,
      model: resolveLanguageModel(providerContext),
      providerOptions: Option.getOrUndefined(
        buildProviderOptions({
          providerId: compiled.providerId,
          providerPackage,
          modelOptions,
          reasoningEffort: input.reasoningEffort,
        }),
      ),
    } satisfies IsolateModelContext
  },
)

function buildUserPrompt(input: { prompt: string; repoWarning?: string | null }): string {
  return Option.match(
    Option.fromNullishOr(input.repoWarning).pipe(Option.filter((warning) => warning.length > 0)),
    {
      onNone: () => input.prompt.trim(),
      onSome: (warning) =>
        [
          "User request:",
          input.prompt.trim(),
          ["Repository warning:", warning.trim()].join("\n"),
        ].join("\n\n"),
    },
  )
}

export function buildIsolateModelMessages(input: {
  prompt: string
  repoWarning?: string | null
}): ModelMessage[] {
  return [
    {
      role: "user",
      content: buildUserPrompt({
        prompt: input.prompt,
        repoWarning: input.repoWarning,
      }),
    },
  ]
}
