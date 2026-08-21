/* oxlint-disable anti-slop/no-unknown-parameters -- Shared Promise/catch helpers. Callers pass rejected values that stay unknown until these functions parse Error and string. */
import * as Match from "effect/Match"
import * as P from "effect/Predicate"

export type ErrorDetails = {
  readonly message: string
  readonly name?: string
}

function messageOrFallback(message: string, fallback: string | undefined) {
  return Match.value(message !== "" || fallback === undefined).pipe(
    Match.when(true, () => message),
    Match.orElse(() => fallback ?? message),
  )
}

export const isError = P.isError

export function getErrorMessage(error: unknown, fallback?: string) {
  return Match.value(error).pipe(
    Match.when(isError, (error) => messageOrFallback(error.message, fallback)),
    Match.when(P.isString, (message) => messageOrFallback(message, fallback)),
    Match.orElse(() => fallback ?? String(error)),
  )
}

export function getErrorLogValue(error: unknown) {
  return Match.value(error).pipe(
    Match.when(isError, (error) => error),
    Match.orElse(() => String(error)),
  )
}

export function getErrorDetails(error: unknown): ErrorDetails {
  return Match.value(error).pipe(
    Match.when(isError, (error) => ({
      message: error.message,
      name: error.name,
    })),
    Match.orElse(() => ({
      message: String(error),
    })),
  )
}

export function getErrorStack(error: unknown) {
  return Match.value(error).pipe(
    Match.when(isError, (error) => error.stack ?? "NO_STACK_TRACE"),
    Match.orElse(() => "NO_STACK_TRACE"),
  )
}
