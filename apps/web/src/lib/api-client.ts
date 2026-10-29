import { S0Api, type S0ApiClient } from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** The typed `S0Api` client for same-origin browser calls. The session cookie authenticates them. */
const s0ApiClient = HttpApiClient.make(S0Api, { baseUrl: "/api" }).pipe(
  Effect.provide(FetchHttpClient.layer),
)

export type ApiRequest<A> = (client: S0ApiClient) => Effect.Effect<A, unknown>

/** The `_tag` of every error class `S0Api` declares. */
const s0ApiErrorTags = new Set([
  "BadRequestError",
  "UnauthorizedError",
  "ForbiddenError",
  "NotFoundError",
  "ConflictError",
  "InternalServerError",
  "UpstreamError",
])

/**
 * The user-facing message of an API failure: the server's message for a declared error, or
 * `fallback` for a transport or decoding failure.
 */
export function apiErrorMessage(cause: unknown, fallback: string): string {
  return Predicate.hasProperty(cause, "_tag") &&
    Predicate.isString(cause._tag) &&
    s0ApiErrorTags.has(cause._tag) &&
    Predicate.hasProperty(cause, "message") &&
    Predicate.isString(cause.message)
    ? cause.message
    : fallback
}

/** Whether `caught`, a `runApi` rejection, carries the declared `S0Api` error with `tag`. */
export function hasApiErrorTag(caught: unknown, tag: string): boolean {
  return Predicate.hasProperty(caught, "cause") && Predicate.isTagged(caught.cause, tag)
}

/**
 * Runs one typed API request at a React boundary. Rejects with an `Error` that carries the server
 * message, or with the signal's reason (an `AbortError`, as `fetch` does) when the caller aborts.
 */
export function runApi<A>(
  request: ApiRequest<A>,
  options: { readonly signal?: AbortSignal; readonly fallbackMessage?: string } = {},
): Promise<A> {
  return Effect.runPromise(
    s0ApiClient.pipe(
      Effect.flatMap(request),
      Effect.mapError(
        (cause) =>
          new Error(apiErrorMessage(cause, options.fallbackMessage ?? "Request failed"), { cause }),
      ),
    ),
    { signal: options.signal },
  ).catch((cause: unknown) =>
    Promise.reject(options.signal?.aborted ? options.signal.reason : cause),
  )
}
