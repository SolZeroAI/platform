import type { TelemetryOptions } from "ai"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { runEffectInCloudflareSpan, toSpanAttributes, type CloudflareTracing } from "./span"

export type { CloudflareTracing } from "./span"

export interface LocalSpanContext {
  readonly traceId: string
  readonly spanId: string
}

interface ActiveLocalSpanContext extends LocalSpanContext {
  readonly parentSpanId?: string
}

interface BackgroundTracingLayerOptions {
  readonly tracing?: CloudflareTracing
  readonly parentContext?: LocalSpanContext
}

interface BackgroundSpanOptions {
  readonly parentContext?: LocalSpanContext
}

export interface BackgroundTracingService {
  readonly currentContext: ReturnType<typeof currentSpanContext>
  readonly withSpan: <A, E, R>(
    name: string,
    attributes: Record<string, unknown>,
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span service method forwards the caller's Effect channels unchanged.
    effect: Effect.Effect<A, E, R>,
    options?: BackgroundSpanOptions,
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span service method returns the caller's Effect channels unchanged.
  ) => Effect.Effect<A, E, R>
}

const HEX_16_BYTES = /^[a-f0-9]{32}$/
const HEX_8_BYTES = /^[a-f0-9]{16}$/
const CurrentLocalSpanContext = Context.Reference<Option.Option<ActiveLocalSpanContext>>(
  "s0/api/CurrentLocalSpanContext",
  {
    defaultValue: () => Option.none(),
  },
)

export const LOCAL_TRACE_ID_HEADER = "x-s0-local-trace-id"
export const LOCAL_PARENT_SPAN_ID_HEADER = "x-s0-local-parent-span-id"
export class BackgroundTracing extends Context.Service<
  BackgroundTracing,
  BackgroundTracingService
>()("s0/api/BackgroundTracing") {}

export function createLocalSpanContext(): LocalSpanContext {
  return {
    traceId: randomHex(16),
    spanId: randomHex(8),
  }
}

export function localSpanLogAnnotations(
  context: LocalSpanContext,
): Record<"s0.local_trace_id" | "s0.local_span_id" | "trace.id" | "span.id", string> {
  // Cloudflare custom spans do not expose spanContext() yet, so application logs
  // carry s0-local correlation ids instead of claiming native OTEL trace/span ids.
  // The trace.id/span.id aliases make Cloudflare Logs queries line up with the
  // same attributes on our custom spans while the explicit s0.* fields document
  // that these are application-managed ids.
  // Remove these fields when native spanContext is available:
  // https://developers.cloudflare.com/workers/observability/traces/custom-spans/#spancontext
  return {
    "s0.local_trace_id": context.traceId,
    "s0.local_span_id": context.spanId,
    "trace.id": context.traceId,
    "span.id": context.spanId,
  }
}

const currentSpanContext = Effect.fn("background.tracing.currentSpanContext")(function* () {
  const fiberContext = yield* CurrentLocalSpanContext
  return Option.match(fiberContext, {
    onNone: () => Option.none<LocalSpanContext>(),
    onSome: (context) =>
      Option.some({
        traceId: context.traceId,
        spanId: context.spanId,
      }),
  })
})

function makeBackgroundTracing(
  options: BackgroundTracingLayerOptions = {},
): BackgroundTracingService {
  return {
    currentContext: currentSpanContext(),
    withSpan(name, attributes, effect, spanOptions = {}) {
      return runBackgroundSpan(name, attributes, effect, {
        tracing: options.tracing,
        parentContext: spanOptions.parentContext ?? options.parentContext,
      })
    },
  }
}

export function makeBackgroundTracingLayer(options: BackgroundTracingLayerOptions = {}) {
  return Layer.succeed(BackgroundTracing, makeBackgroundTracing(options))
}

export function localSpanHeaders(context: LocalSpanContext): Record<string, string> {
  return {
    [LOCAL_TRACE_ID_HEADER]: context.traceId,
    [LOCAL_PARENT_SPAN_ID_HEADER]: context.spanId,
  }
}

// oxlint-disable-next-line s0-lint/prefer-option-over-null -- Interop reader consumed by Promise-side Durable Object plumbing and the header round-trip test, which branch on `undefined`; will return Option once those callers convert to Effect.
export function localSpanContextFromHeaders(headers: Headers): LocalSpanContext | undefined {
  const traceId = headers.get(LOCAL_TRACE_ID_HEADER)?.trim().toLowerCase()
  const spanId = headers.get(LOCAL_PARENT_SPAN_ID_HEADER)?.trim().toLowerCase()
  return Option.getOrUndefined(
    Option.all({
      traceId: Option.fromNullishOr(traceId).pipe(
        Option.filter((value) => HEX_16_BYTES.test(value)),
      ),
      spanId: Option.fromNullishOr(spanId).pipe(Option.filter((value) => HEX_8_BYTES.test(value))),
    }),
  )
}

const runBackgroundSpan = <A, E, R>(
  name: string,
  attributes: Record<string, unknown>,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span combinator: the `Effect<A, E, R>` parameter channel is intrinsic to the combinator contract.
  effect: Effect.Effect<A, E, R>,
  options: BackgroundSpanOptions & { readonly tracing?: CloudflareTracing } = {},
) =>
  Effect.gen(function* () {
    const currentContext = yield* Effect.context<R>()
    const fiberContext = yield* CurrentLocalSpanContext
    const parentContext = Option.fromNullishOr(
      options.parentContext ?? Option.getOrUndefined(fiberContext),
    )
    const traceId = Option.match(parentContext, {
      onNone: () => randomHex(16),
      onSome: (context) => context.traceId,
    })
    const parentSpanId = Option.match(parentContext, {
      onNone: (): Record<string, never> => ({}),
      onSome: (context) => ({ parentSpanId: context.spanId }),
    })
    const localContext: ActiveLocalSpanContext = {
      traceId,
      spanId: randomHex(8),
      ...parentSpanId,
    }
    const spanAttributes = toSpanAttributes(attributes)
    const localSpanAttributes = localSpanLogAnnotations(localContext)
    const logAnnotations = {
      ...spanAttributes,
      ...localSpanAttributes,
      spanName: name,
    }

    const instrumented = effect.pipe(
      Effect.annotateLogs(logAnnotations),
      Effect.provideService(CurrentLocalSpanContext, Option.some(localContext)),
      Effect.provideService(
        BackgroundTracing,
        makeBackgroundTracing({ tracing: options.tracing, parentContext: localContext }),
      ),
    )

    return yield* runEffectInCloudflareSpan({
      name,
      tracing: options.tracing,
      attributes: { ...spanAttributes, ...localSpanAttributes },
      context: currentContext,
      effect: instrumented,
    })
  })

export function aiTelemetrySettings(
  functionId: string,
  metadata: Record<string, unknown>,
): TelemetryOptions & { readonly metadata: Record<string, string | number | boolean> } {
  const attributes = toSpanAttributes(metadata)
  return {
    functionId,
    isEnabled: true,
    metadata: attributes,
    includeRuntimeContext: Object.fromEntries(
      Object.keys(attributes).map((attribute) => [attribute, true]),
    ),
    recordInputs: false,
    recordOutputs: false,
  }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
