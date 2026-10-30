import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { requiredConfigString, withWorkersDevOrigins, type StageMetadata } from "@solzero/shared"

class CloudflareApiError extends Schema.Class<CloudflareApiError>("CloudflareApiError")({
  message: Schema.optional(Schema.String),
}) {}

class CloudflareSubdomainResult extends Schema.Class<CloudflareSubdomainResult>(
  "CloudflareSubdomainResult",
)({
  subdomain: Schema.optional(Schema.String),
}) {}

class CloudflareSubdomainPayload extends Schema.Class<CloudflareSubdomainPayload>(
  "CloudflareSubdomainPayload",
)({
  success: Schema.optional(Schema.Boolean),
  errors: Schema.optional(Schema.Array(CloudflareApiError)),
  result: Schema.optional(CloudflareSubdomainResult),
}) {}

class CloudflareSubdomainBody extends Schema.Class<CloudflareSubdomainBody>(
  "CloudflareSubdomainBody",
)({
  subdomain: Schema.String,
}) {}

function cloudflareErrorMessage(status: number, payload: CloudflareSubdomainPayload): string {
  const details = (payload.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => typeof message === "string" && message.length > 0)
    .join("; ")

  return Match.value(details.length > 0).pipe(
    Match.when(
      true,
      () => `Cloudflare workers.dev subdomain request failed (${status}): ${details}`,
    ),
    Match.orElse(() => `Cloudflare workers.dev subdomain request failed (${status})`),
  )
}

function subdomainOrThrow(status: number, payload: CloudflareSubdomainPayload): string {
  const subdomain = payload.result?.subdomain?.trim() ?? ""
  const ok = status >= 200 && status < 300 && payload.success === true && subdomain.length > 0

  return Match.value(ok).pipe(
    Match.when(true, () => subdomain),
    Match.orElse(() => {
      throw new Error(cloudflareErrorMessage(status, payload))
    }),
  )
}

const decodeSubdomainPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(CloudflareSubdomainPayload),
)

const encodeSubdomainBody = Schema.encodeSync(Schema.fromJsonString(CloudflareSubdomainBody))

function toError(error: unknown): Error {
  return Match.value(error instanceof Error).pipe(
    // SAFETY: the Match.when guard established `error instanceof Error`.
    Match.when(true, () => error as Error),
    Match.orElse(() => new Error(String(error))),
  )
}

const requestSubdomain = Effect.fn("infra.requestWorkersDevSubdomain")(function* (
  token: string,
  request: HttpClientRequest.HttpClientRequest,
) {
  const response = yield* HttpClient.execute(
    request.pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("Content-Type", "application/json"),
    ),
  ).pipe(
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(toError),
  )

  const text = yield* response.text.pipe(Effect.mapError(toError))

  return yield* Effect.try({
    try: () => subdomainOrThrow(response.status, decodeSubdomainPayload(text)),
    catch: toError,
  })
})

function subdomainUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`
}

function readAccountSubdomain(accountId: string, token: string) {
  return requestSubdomain(token, HttpClientRequest.get(subdomainUrl(accountId)))
}

function createAccountSubdomain(accountId: string, token: string, subdomain: string) {
  return requestSubdomain(
    token,
    HttpClientRequest.put(subdomainUrl(accountId)).pipe(
      HttpClientRequest.bodyText(
        encodeSubdomainBody(new CloudflareSubdomainBody({ subdomain })),
        "application/json",
      ),
    ),
  )
}

function proposedSubdomain(accountId: string): string {
  return `s0${accountId.replaceAll("-", "").slice(0, 16)}`
}

function fetchOrCreateSubdomain(accountId: string) {
  return Effect.gen(function* () {
    const token = yield* requiredConfigString("CLOUDFLARE_API_TOKEN")
    const existing = yield* readAccountSubdomain(accountId, token).pipe(Effect.option)

    return yield* Option.match(existing, {
      onSome: (subdomain) => Effect.succeed(subdomain),
      onNone: () =>
        createAccountSubdomain(accountId, token, proposedSubdomain(accountId)).pipe(Effect.orDie),
    })
  })
}

function readWorkersDevSubdomain(accountId: string) {
  return Config.String("CLOUDFLARE_WORKERS_SUBDOMAIN").pipe(
    Config.withDefault(""),
    Effect.map((value) => value.trim()),
    Effect.flatMap((configured) =>
      Match.value(configured.length > 0).pipe(
        Match.when(true, () => Effect.succeed(configured)),
        Match.orElse(() => fetchOrCreateSubdomain(accountId)),
      ),
    ),
  )
}

export function resolveDeployedWorkersDevOrigin(input: {
  readonly appName: string
  readonly stageMetadata: StageMetadata
}) {
  const applicable =
    input.stageMetadata.infra.alchemyStateStore === "cloudflare" &&
    input.stageMetadata.infra.zone === "localhost"

  const workersDevOrigin = requiredConfigString("CLOUDFLARE_ACCOUNT_ID").pipe(
    Effect.flatMap((accountId) => readWorkersDevSubdomain(accountId)),
    Effect.map((subdomain) =>
      withWorkersDevOrigins(input.stageMetadata, {
        appName: input.appName,
        subdomain,
      }),
    ),
  )

  return Match.value(applicable).pipe(
    Match.when(true, () => workersDevOrigin),
    Match.orElse(() => Effect.succeed(input.stageMetadata)),
  )
}
