import * as Match from "effect/Match"

// Centralized error-normalization helpers shared across server modules. Keeping these in one
// place removes copy-pasted `raise`/`toError`/`describeError` micro-helpers from individual files
// while staying inside the idiomatic `Match.value(...)` style used throughout the codebase.

/** Normalize an unknown thrown/rejected value into a real `Error`, preserving existing instances. */
export function toError(value: unknown): Error {
  return Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error),
    Match.orElse((other) => new Error(String(other))),
  )
}

/** Like {@link toError}, but uses `fallbackMessage` for non-`Error` values instead of stringifying. */
export function toErrorWithFallback(value: unknown, fallbackMessage: string): Error {
  return Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error),
    Match.orElse(() => new Error(fallbackMessage)),
  )
}

/** Human-readable message from an unknown value (`Error.message`, else `String(value)`). */
export function describeError(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse((other) => String(other)),
  )
}

/** Human-readable message from an unknown value, falling back to `fallback` for non-`Error`s. */
export function errorMessageOr(value: unknown, fallback: string): string {
  return Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse(() => fallback),
  )
}

/**
 * Centralized throwing boundary for genuinely unreachable invariants in non-Effect (Promise/sync)
 * code paths where threading a typed Effect failure would change an exported signature. Prefer a
 * typed `Effect.fail`/`Schema.TaggedError` or `Option.getOrThrowWith` wherever the call site is
 * already inside an Effect pipeline.
 */
export function raise(message: string): never {
  throw new Error(message)
}
