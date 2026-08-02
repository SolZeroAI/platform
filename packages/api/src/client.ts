import { Effect, type Redacted } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi"
import { C0Api } from "./http"
import { ControlPlaneAuth } from "./http/security"

export type C0ApiClient = HttpApiClient.ForApi<typeof C0Api>

function applyControlPlaneHeaders(
  request: HttpClientRequest.HttpClientRequest,
  options: {
    bearerToken?: string | Redacted.Redacted
  },
) {
  let nextRequest = request
  if (options.bearerToken !== undefined) {
    nextRequest = HttpClientRequest.bearerToken(nextRequest, options.bearerToken)
  }
  return nextRequest
}

export function controlPlaneAuthClient(options: { bearerToken?: string | Redacted.Redacted }) {
  return HttpApiMiddleware.layerClient(ControlPlaneAuth, ({ request, next }) =>
    next(applyControlPlaneHeaders(request, options)),
  )
}

export function makeC0ApiClient(options: {
  baseUrl: string | URL
  bearerToken?: string | Redacted.Redacted
}): Effect.Effect<C0ApiClient> {
  const client = HttpApiClient.make(C0Api, {
    baseUrl: options.baseUrl,
  }).pipe(Effect.provide(FetchHttpClient.layer))

  if (options.bearerToken === undefined) {
    return client as Effect.Effect<C0ApiClient>
  }

  return client.pipe(
    Effect.provide(controlPlaneAuthClient({ bearerToken: options.bearerToken })),
  ) as Effect.Effect<C0ApiClient>
}
