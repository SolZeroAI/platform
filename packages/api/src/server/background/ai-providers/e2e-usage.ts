/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary, s0-lint/prefer-option-over-null, effect/avoid-direct-json -- Native provider accounting projects only allowlisted metadata at the SDK/HTTP boundary; missing measurements stay null. */
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import type { Env } from "../types"

type Tokens = number | null
type Cache = "hit" | "miss" | "bypass" | "unknown"
type Usage = { inputTokens: Tokens; outputTokens: Tokens; cachedInputTokens: Tokens }
type Metadata = Usage & {
  cache: Cache
  httpStatus: number | null
  status: "success" | "error"
}
const unknownUsage: Usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null }
const usageLogger = Logger.withConsoleLog(Logger.make(({ message }) => String(message)))

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function tokens(value: unknown): Tokens {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Reads native measured usage, before the provider SDK substitutes missing counts with zero. */
export function nativeWorkersAiUsage(value: unknown): Usage {
  const envelope = record(value)
  const body = record(envelope?.result) ?? envelope
  const usage = record(body?.usage)
  return {
    inputTokens: tokens(usage?.prompt_tokens),
    outputTokens: tokens(usage?.completion_tokens),
    cachedInputTokens: tokens(record(usage?.prompt_tokens_details)?.cached_tokens),
  }
}

export function gatewayCacheStatus(headers: Headers, bypass = false): Cache {
  const value = headers.get("cf-aig-cache-status")?.toUpperCase()
  if (value === "HIT") return "hit"
  if (bypass) return "bypass"
  if (value === "MISS") return "miss"
  return "unknown"
}

/** One safe record per actual dispatch; no request identifiers or content enter this logger. */
export function startApplicationAiUsage(
  env: Env,
  model: unknown,
  cacheLayer: "gateway" | "none" = "gateway",
) {
  const enabled =
    env.E2E_AI_USAGE === true &&
    typeof model === "string" &&
    env.STAGE === "dev" &&
    /^s0-e2e(?:-[a-z0-9-]+)?-api-dev$/.test(env.WORKER_NAME)
  const startedAt = new Date().toISOString()
  let completed = false
  function finish(metadata: Partial<Metadata>) {
    if (!enabled || completed) return
    completed = true
    // An explicit projection prevents accidental spreading of response bodies or headers.
    const event = {
      schemaVersion: 1,
      source: "application",
      model:
        typeof model === "string" && /^@cf\/openai\/gpt-oss-(20b|120b)$/.test(model)
          ? model
          : "unknown",
      cache: metadata.cache ?? "unknown",
      cacheLayer,
      requests: 1,
      operations: 0,
      inputTokens: tokens(metadata.inputTokens),
      outputTokens: tokens(metadata.outputTokens),
      cachedInputTokens: tokens(metadata.cachedInputTokens),
      status: metadata.status ?? "error",
      httpStatus: tokens(metadata.httpStatus),
      startedAt,
    }
    // Telemetry must never replace the original provider result or failure.
    try {
      // oxlint-disable-next-line effect/effect-run-in-body -- Synchronous native provider telemetry sink; the Effect logger emits a single content-free line at the runtime boundary.
      Effect.runSync(
        Effect.logInfo(`E2E_AI_USAGE ${JSON.stringify(event)}`).pipe(
          Effect.provide(Logger.layer([usageLogger])),
        ),
      )
    } catch {
      // Preserve provider behavior if console telemetry is unavailable.
    }
  }
  return finish
}

/** Observe a binding without changing run options, return values, errors, or stream bytes. */
export function withApplicationAiUsage(binding: Ai, env: Env): Ai {
  if (env.E2E_AI_USAGE !== true) return binding
  async function run(...args: Parameters<Ai["run"]>) {
    const finish = startApplicationAiUsage(env, args[0])
    const bypass = record(record(args[2])?.gateway)?.skipCache === true
    try {
      const output = await binding.run(...args)
      if (!(output instanceof ReadableStream)) {
        finish({
          ...nativeWorkersAiUsage(output),
          cache: bypass ? "bypass" : "unknown",
          status: "success",
        })
        return output
      }
      // Binding streams hide HTTP headers. The SDK maps absent usage to zero, so
      // do not guess counts or parse the stream a second time for accounting.
      const reader = output.getReader()
      return new ReadableStream({
        async pull(controller) {
          try {
            const result = await reader.read()
            if (result.done) {
              finish({ ...unknownUsage, cache: bypass ? "bypass" : "unknown", status: "success" })
              controller.close()
            } else controller.enqueue(result.value)
          } catch (error) {
            finish({ status: "error", cache: bypass ? "bypass" : "unknown" })
            controller.error(error)
          }
        },
        async cancel(reason) {
          finish({ status: "error", cache: bypass ? "bypass" : "unknown" })
          return reader.cancel(reason)
        },
      })
    } catch (error) {
      finish({ status: "error", cache: bypass ? "bypass" : "unknown" })
      throw error
    }
  }
  return new Proxy(binding, {
    get(target, property) {
      if (property === "run") return run
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
