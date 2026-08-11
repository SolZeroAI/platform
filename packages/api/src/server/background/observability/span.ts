import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { stringifyJson } from "../../lib/json"

export type CloudflareTracing = NonNullable<ExecutionContext["tracing"]>
export type CloudflareSpan = Parameters<Parameters<CloudflareTracing["enterSpan"]>[1]>[0]

export function setCloudflareSpanAttributes(
  span: CloudflareSpan | undefined,
  fields: Record<string, unknown>,
): void {
  Option.match(Option.fromNullishOr(span), {
    onNone: () => undefined,
    onSome: (resolved) =>
      Object.entries(fields).forEach(([key, value]) =>
        Option.match(spanAttributeValue(value), {
          onNone: () => undefined,
          onSome: (attribute) => resolved.setAttribute(key, attribute),
        }),
      ),
  })
}

export function toSpanAttributes(
  fields: Record<string, unknown>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) =>
      Option.match(spanAttributeValue(value), {
        onNone: (): Array<[string, string | number | boolean]> => [],
        onSome: (attribute) => [[key, attribute]],
      }),
    ),
  )
}

export function errorAttributes(error: unknown): Record<string, string | number | boolean> {
  const normalized = normalizeError(error)
  return {
    error: true,
    "error.message": normalized.message,
    "error.name": normalized.name,
  }
}

export function causeFailureAttributes(
  cause: Cause.Cause<unknown>,
): Record<string, string | number | boolean> {
  return errorAttributes(Cause.squash(cause))
}

export function normalizeError(error: unknown): Error {
  return Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (value) => value),
    Match.orElse((value) => new Error(String(value))),
  )
}

export function completedSpanAttributes<E>(
  exit: Exit.Exit<unknown, E>,
  durationMs: number,
): Record<string, string | number | boolean> {
  return Exit.match(exit, {
    onFailure: (cause) => ({
      ...causeFailureAttributes(cause),
      duration_ms: durationMs,
    }),
    onSuccess: () => ({
      status: "ok",
      duration_ms: durationMs,
    }),
  })
}

export function runCloudflarePromiseSpan<A>(
  span: CloudflareSpan,
  attributes: Record<string, unknown>,
  handler: (span: CloudflareSpan) => Promise<A>,
): Promise<A> {
  const startedAt = Date.now()
  setCloudflareSpanAttributes(span, attributes)
  return Promise.resolve(handler(span)).then(
    (result) => finalizePromiseSpanSuccess(span, startedAt, result),
    (error) => finalizePromiseSpanFailure(span, startedAt, error),
  )
}

function finalizePromiseSpanSuccess<A>(span: CloudflareSpan, startedAt: number, result: A): A {
  setCloudflareSpanAttributes(span, {
    status: "ok",
    duration_ms: Date.now() - startedAt,
  })
  return result
}

function finalizePromiseSpanFailure(
  span: CloudflareSpan,
  startedAt: number,
  error: unknown,
): never {
  setCloudflareSpanAttributes(span, {
    ...errorAttributes(error),
    duration_ms: Date.now() - startedAt,
  })
  throw error
}

export function runEffectInCloudflareSpan<A, E, R>(options: {
  readonly name: string
  readonly tracing?: CloudflareTracing
  readonly attributes: Record<string, unknown>
  readonly context: Context.Context<R>
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span bridge: A/E/R are intrinsic to running the caller's effect inside Cloudflare's imperative span callback.
  readonly effect: Effect.Effect<A, E, R>
  readonly completedAttributes?: (
    exit: Exit.Exit<A, E>,
    durationMs: number,
  ) => Record<string, unknown>
  readonly onSpanEnd?: () => void
  readonly onSpanStart?: (span: CloudflareSpan) => void
}) {
  return Effect.callback<A, E>((resume, signal) => {
    const startedAt = Date.now()
    // oxlint-disable-next-line s0-lint/prefer-option-over-null -- Mutable interrupt handle assigned by the Effect.runCallbackWith bridge; it is a low-level imperative finalizer.
    let interrupt: ((interruptor?: number | undefined) => void) | undefined
    const interruptChild = () => {
      interrupt?.()
    }
    signal.addEventListener("abort", interruptChild, { once: true })

    function finalizeExit(
      span: CloudflareSpan | undefined,
      exit: Exit.Exit<A, E>,
    ): Exit.Exit<A, E> {
      setCloudflareSpanAttributes(
        span,
        options.completedAttributes?.(exit, Date.now() - startedAt) ??
          completedSpanAttributes(exit, Date.now() - startedAt),
      )
      return exit
    }

    function runInstrumented(span: CloudflareSpan | undefined): Promise<Exit.Exit<A, E>> {
      setCloudflareSpanAttributes(span, options.attributes)
      return new Promise<Exit.Exit<A, E>>((resolve) => {
        interrupt = Effect.runCallbackWith(options.context)(options.effect, {
          onExit: (exit) => resolve(finalizeExit(span, exit)),
        })
        Option.match(Option.liftPredicate(signal.aborted, Boolean), {
          onNone: () => undefined,
          onSome: () => interruptChild(),
        })
      })
    }

    function enterTracingSpan(span: CloudflareSpan): Promise<Exit.Exit<A, E>> {
      options.onSpanStart?.(span)
      return runInstrumented(span).finally(() => {
        options.onSpanEnd?.()
      })
    }

    const spanResult = Option.match(Option.fromNullishOr(options.tracing), {
      onNone: () => runInstrumented(undefined),
      onSome: (tracing) => tracing.enterSpan(options.name, enterTracingSpan),
    })

    Promise.resolve(spanResult).then(
      (exit) => {
        signal.removeEventListener("abort", interruptChild)
        Exit.match(exit, {
          onSuccess: (value) => resume(Effect.succeed(value)),
          onFailure: (cause) => resume(Effect.failCause(cause)),
        })
      },
      (defect) => {
        signal.removeEventListener("abort", interruptChild)
        resume(Effect.die(defect))
      },
    )

    // oxlint-disable-next-line s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback -- Effect.callback register returns its interrupt finalizer for Cloudflare span interop.
    return Effect.sync(() => {
      signal.removeEventListener("abort", interruptChild)
      interruptChild()
    })
  })
}

function spanAttributeValue(value: unknown): Option.Option<string | number | boolean> {
  return Match.value(value).pipe(
    Match.when(Match.string, (resolved) => Option.some<string | number | boolean>(resolved)),
    Match.when(Match.number, (resolved) => Option.some<string | number | boolean>(resolved)),
    Match.when(Match.boolean, (resolved) => Option.some<string | number | boolean>(resolved)),
    Match.whenOr(Match.null, Match.undefined, () => Option.none<string | number | boolean>()),
    Match.orElse((resolved) =>
      Match.value(typeof resolved === "object").pipe(
        Match.when(true, () => Option.fromNullishOr(stringifyJson(resolved))),
        Match.orElse(() => Option.some<string | number | boolean>(String(resolved))),
      ),
    ),
  )
}
