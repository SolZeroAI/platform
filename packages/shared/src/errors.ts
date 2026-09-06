/* oxlint-disable anti-slop/no-unknown-parameters -- Shared Promise/catch helpers. Callers pass rejected values that stay unknown until these functions parse Error and string. */
import * as Match from "effect/Match"
import * as P from "effect/Predicate"

function messageOrFallback(message: string, fallback: string | undefined) {
  return Match.value(message !== "" || fallback === undefined).pipe(
    Match.when(true, () => message),
    Match.orElse(() => fallback ?? message),
  )
}

const isError = P.isError

export function getErrorMessage(error: unknown, fallback?: string) {
  return Match.value(error).pipe(
    Match.when(isError, (error) => messageOrFallback(error.message, fallback)),
    Match.when(P.isString, (message) => messageOrFallback(message, fallback)),
    Match.orElse(() => fallback ?? String(error)),
  )
}
