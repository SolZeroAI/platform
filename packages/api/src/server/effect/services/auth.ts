import type { ApiEnv } from "infra/types/env"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { HttpServerRequest } from "effect/unstable/http"
import {
  ControlPlaneAuth,
  CurrentPrincipal,
  InternalServerError,
  UnauthorizedError,
  type AuthPrincipal,
} from "@c0/api"
import { UserApiKeyStore } from "../../background/db/user-api-keys"
import { getSessionContextFromHeaders } from "../../lib/better-auth"
import { CloudflareContext } from "./cloudflare"

const API_KEY_PREFIX = "oiak_"

export const CurrentRequest = HttpServerRequest.HttpServerRequest

const verifyApiKey = Effect.fn("auth.verifyApiKey")(function* (rawApiKey: string, env: ApiEnv) {
  const store = new UserApiKeyStore(env.DB)
  const verified = yield* store
    .verify(rawApiKey)
    .pipe(
      Effect.catch(() =>
        Effect.fail(new InternalServerError({ message: "Failed to verify API key" })),
      ),
    )
  const account = yield* Option.match(verified, {
    onNone: () => Effect.fail(new UnauthorizedError({ message: "Unauthorized" })),
    onSome: Effect.succeed,
  })
  return {
    kind: "api_key",
    keyId: account.keyId,
    userId: account.userId,
  } satisfies AuthPrincipal
})

function nonEmptyHeader(headers: Headers, name: string): Option.Option<string> {
  return Option.fromNullishOr(headers.get(name)?.trim()).pipe(Option.filter(Boolean))
}

function rejectAuthorization(message = "Unauthorized"): never {
  throw new UnauthorizedError({ message })
}

function apiKeyFromAuthorization(value: string): Option.Option<string> {
  return Match.value(value).pipe(
    Match.when(
      (candidate) => candidate.startsWith("ApiKey "),
      (candidate) => Option.some(candidate.slice("ApiKey ".length).trim()),
    ),
    Match.when(
      (candidate) => candidate.startsWith(`Bearer ${API_KEY_PREFIX}`),
      (candidate) => Option.some(candidate.slice("Bearer ".length).trim()),
    ),
    Match.orElse(() => rejectAuthorization()),
  )
}

function explicitApiKey(headers: Headers): Option.Option<string> {
  const authorization = nonEmptyHeader(headers, "authorization")
  const apiKey = nonEmptyHeader(headers, "x-api-key")
  return Match.value({
    hasApiKey: Option.isSome(apiKey),
    hasAuthorization: Option.isSome(authorization),
  }).pipe(
    Match.when({ hasApiKey: true, hasAuthorization: true }, () =>
      rejectAuthorization("Multiple authentication credentials supplied"),
    ),
    Match.when({ hasApiKey: true }, () => apiKey),
    Match.when({ hasAuthorization: false }, () => Option.none<string>()),
    Match.orElse(() => Option.flatMap(authorization, apiKeyFromAuthorization)),
  )
}

const verifyUserSession = Effect.fn("auth.verifyUserSession")(function* (
  request: Request,
  env: ApiEnv,
) {
  const sessionContext = yield* getSessionContextFromHeaders(env, request.headers)
  const resolved = yield* Option.match(Option.fromNullishOr(sessionContext), {
    onNone: () => Effect.fail(new UnauthorizedError({ message: "Unauthorized" })),
    onSome: Effect.succeed,
  })
  return {
    kind: "user_session",
    userId: resolved.user.id,
    sessionContext: resolved,
  } satisfies AuthPrincipal
})

export const authenticateControlPlaneRequest = Effect.fn("auth.authenticateControlPlaneRequest")(
  function* (request: Request, env: ApiEnv) {
    const apiKey = yield* Effect.try({
      try: () => explicitApiKey(request.headers),
      catch: (cause) =>
        Match.value(cause).pipe(
          Match.when(Match.instanceOf(UnauthorizedError), (errorValue) => errorValue),
          Match.orElse(() => new UnauthorizedError({ message: "Unauthorized" })),
        ),
    })
    return yield* Option.match(apiKey, {
      onNone: () => verifyUserSession(request, env),
      onSome: (value) => verifyApiKey(value, env),
    })
  },
)

// `handler` is typed `never` because the HttpApiMiddleware `bearerAuth`/`apiKey` callback
// contract erases the handler's Effect channels at this boundary; we re-provide the resolved
// principal and let the framework cast restore the expected shape.
const providePrincipal = (handler: never, principal: AuthPrincipal) =>
  Effect.provideService(handler, CurrentPrincipal, principal)

const authenticateCurrentRequest = (handler: never) =>
  Effect.gen(function* () {
    const { env } = yield* CloudflareContext
    const request = requestFromSource(yield* CurrentRequest)
    const principal = yield* authenticateControlPlaneRequest(request, env)
    return yield* providePrincipal(handler, principal)
  }) as never

export const ControlPlaneAuthLive = Layer.succeed(ControlPlaneAuth, {
  bearerAuth: (handler: never) => authenticateCurrentRequest(handler),
  apiKey: (handler: never) => authenticateCurrentRequest(handler),
} as never)

export const AuthMiddlewareLive = ControlPlaneAuthLive

export function requestFromSource(request: HttpServerRequest.HttpServerRequest) {
  return Match.value(request.source).pipe(
    Match.when(Match.instanceOf(Request), (source) => source),
    Match.orElse(
      () =>
        new Request(request.url, {
          method: request.method,
          headers: new Headers(request.headers),
        }),
    ),
  )
}

export const getWebRequest = Effect.map(CurrentRequest, requestFromSource)
