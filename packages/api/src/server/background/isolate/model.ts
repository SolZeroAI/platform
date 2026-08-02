import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { type LanguageModel, type ModelMessage } from "ai"
import type { CompiledOpenCodeConfig } from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
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

type SupportedProviderPackage = "@ai-sdk/openai" | "@ai-sdk/openai-compatible" | "@ai-sdk/anthropic"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

function toSupportedProviderPackage(value: string | undefined): SupportedProviderPackage {
  return Match.value(value).pipe(
    Match.whenOr(
      "@ai-sdk/openai",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/anthropic",
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
  const reasoningOption = Option.getOrElse(
    Option.fromNullishOr(input.reasoningEffort).pipe(
      Option.filter((effort) => effort.length > 0 && input.providerPackage !== "@ai-sdk/anthropic"),
      Option.map((effort): JsonObject => ({ reasoningEffort: effort })),
    ),
    (): JsonObject => ({}),
  )
  const options: JsonObject = {
    ...(input.modelOptions as JsonObject),
    ...reasoningOption,
  }

  return Option.liftPredicate(options, (resolved) => Object.keys(resolved).length > 0).pipe(
    Option.map((resolved) => ({ [input.providerId]: resolved })),
  )
}

function createProviderFetch(input: {
  env: Env
  providerId: string
  providerPackage: SupportedProviderPackage
  modelId: string
  observability?: IsolateModelObservability
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
          // oxlint-disable-next-line effect/avoid-native-fetch -- This IS the AI provider HTTP passthrough being traced; the AI SDK requires a native fetch implementation and no HttpClient layer is provisioned on this path.
          try: () => fetch(request, init),
          catch: (cause) => cause,
        }),
      )
    }).pipe(Effect.provide(makeBackgroundTracingLayer(input.observability)))
    // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK provider fetch boundary requires a Promise; runs the ai.provider.fetch span Effect at that edge.
    return Effect.runPromise(span)
  }
  return tracedFetch
}

function resolveLanguageModel(input: CompiledProviderContext): LanguageModel {
  const { providerPackage, providerOptions } = getSelectedProviderConfig(input)
  const apiKey = stringOption(providerOptions.apiKey)
  const baseURL = stringOption(providerOptions.baseURL)
  const headers = toStringRecord(providerOptions.headers)
  const tracedFetch = createProviderFetch({
    env: input.env,
    providerId: input.providerId,
    providerPackage,
    modelId: input.modelId,
    observability: input.observability,
  })

  return Match.value(providerPackage).pipe(
    Match.when("@ai-sdk/openai", () =>
      createOpenAI({
        name: input.providerId,
        apiKey: Option.getOrUndefined(apiKey),
        baseURL: Option.getOrUndefined(baseURL),
        fetch: tracedFetch,
        headers: Option.getOrUndefined(headers),
      }).responses(input.modelId),
    ),
    Match.when("@ai-sdk/anthropic", () =>
      createAnthropic({
        name: input.providerId,
        apiKey: Option.getOrUndefined(apiKey),
        baseURL: Option.getOrUndefined(baseURL),
        fetch: tracedFetch,
        headers: Option.getOrUndefined(headers),
      })(input.modelId),
    ),
    Match.orElse(() =>
      createOpenAICompatible({
        name: input.providerId,
        apiKey: Option.getOrUndefined(apiKey),
        baseURL: Option.getOrThrowWith(
          baseURL,
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
