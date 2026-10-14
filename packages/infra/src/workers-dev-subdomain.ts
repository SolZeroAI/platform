import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { requiredConfigString, withWorkersDevOrigins, type StageMetadata } from "@solzero/shared"

const CloudflareSubdomainPayload = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.optional(Schema.String),
      }),
    ),
  ),
  result: Schema.optional(
    Schema.Struct({
      subdomain: Schema.optional(Schema.String),
    }),
  ),
})

type CloudflareSubdomainPayload = typeof CloudflareSubdomainPayload.Type

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
const encodeSubdomainBody = Schema.encodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      subdomain: Schema.String,
    }),
  ),
)

function toError(error: unknown): Error {
  return Match.value(error instanceof Error).pipe(
    // SAFETY: the Match.when guard established `error instanceof Error`.
    Match.when(true, () => error as Error),
    Match.orElse(() => new Error(String(error))),
  )
}

function requestSubdomain(accountId: string, token: string, init: RequestInit) {
  return Effect.tryPromise({
    try: () =>
      fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }).then((response) =>
        response
          .text()
          .then((text) => subdomainOrThrow(response.status, decodeSubdomainPayload(text))),
      ),
    catch: toError,
  })
}

function readAccountSubdomain(accountId: string, token: string) {
  return requestSubdomain(accountId, token, { method: "GET" })
}

function createAccountSubdomain(accountId: string, token: string, subdomain: string) {
  return requestSubdomain(accountId, token, {
    method: "PUT",
    body: encodeSubdomainBody({ subdomain }),
  })
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
  return Config.string("CLOUDFLARE_WORKERS_SUBDOMAIN").pipe(
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
