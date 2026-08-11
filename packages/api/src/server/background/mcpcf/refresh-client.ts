import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { toError } from "../../lib/effect-errors"

export interface McpcfRefreshConfig {
  baseUrl: string
}

export interface McpcfRefreshClient {
  fetchServers: typeof fetchServers
  fetchServerTools: typeof fetchServerTools
}

class McpcfRefreshHttpError extends Schema.TaggedErrorClass<McpcfRefreshHttpError>()(
  "McpcfRefreshHttpError",
  {
    message: Schema.String,
    status: Schema.Number,
    statusText: Schema.String,
  },
) {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeCollectionResponse(body: unknown, key: string): unknown[] {
  return Match.value(body).pipe(
    Match.when(Array.isArray, (items) => items),
    Match.when(isRecord, (record) =>
      Option.fromNullishOr(record[key] ?? record.items ?? record.data ?? record.results).pipe(
        Option.filter(Array.isArray),
        Option.getOrElse((): unknown[] => []),
      ),
    ),
    Match.orElse((): unknown[] => []),
  )
}

function nextCursorFromResponse(body: unknown) {
  return Match.value(body).pipe(
    Match.when(isRecord, (record) =>
      Option.fromNullishOr(record.nextCursor ?? record.next_cursor).pipe(
        Option.filter((value): value is string => typeof value === "string"),
        Option.map((value) => value.trim()),
        Option.filter((value) => value.length > 0),
      ),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  return Effect.tryPromise({
    // oxlint-disable-next-line effect/avoid-native-fetch -- MCPCF admin API HTTP boundary; the refresh client exposes Effect and wraps the platform fetch here.
    try: () => fetch(input, init),
    catch: toError,
  }).pipe(
    Effect.flatMap((response) =>
      Match.value(response.ok).pipe(
        Match.when(true, () => Effect.tryPromise({ try: () => response.json(), catch: toError })),
        Match.orElse(() =>
          Effect.fail(
            new McpcfRefreshHttpError({
              message: `HTTP ${response.status} ${response.statusText}`.trim(),
              status: response.status,
              statusText: response.statusText,
            }),
          ),
        ),
      ),
    ),
  )
}

function fetchServersPage(input: {
  config: McpcfRefreshConfig
  adminApiToken: string
  page: number
  cursor: Option.Option<string>
  accumulated: readonly unknown[]
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Recursive pagination needs an explicit return type to avoid TypeScript circular inference.
}): Effect.Effect<unknown[], Error | McpcfRefreshHttpError> {
  return Match.value(input.page >= 50).pipe(
    Match.when(true, () => Effect.succeed([...input.accumulated])),
    Match.orElse(() =>
      Effect.gen(function* () {
        const url = new URL(`${input.config.baseUrl}/servers`)
        url.searchParams.set("limit", "100")
        Option.match(input.cursor, {
          onSome: (cursor) => url.searchParams.set("cursor", cursor),
          onNone: () => undefined,
        })
        const body = yield* fetchJson(url, {
          headers: {
            Authorization: `Bearer ${input.adminApiToken}`,
          },
        })
        const accumulated = [...input.accumulated, ...normalizeCollectionResponse(body, "servers")]
        const cursor = nextCursorFromResponse(body)
        return yield* Option.match(cursor, {
          onSome: (nextCursor) =>
            fetchServersPage({
              config: input.config,
              adminApiToken: input.adminApiToken,
              page: input.page + 1,
              cursor: Option.some(nextCursor),
              accumulated,
            }),
          onNone: () => Effect.succeed(accumulated),
        })
      }),
    ),
  )
}

function fetchServers(input: { config: McpcfRefreshConfig; adminApiToken: string }) {
  return fetchServersPage({
    config: input.config,
    adminApiToken: input.adminApiToken,
    page: 0,
    cursor: Option.none(),
    accumulated: [],
  })
}

function fetchServerTools(input: {
  config: McpcfRefreshConfig
  adminApiToken: string
  serverId: string
}) {
  const url = new URL(`${input.config.baseUrl}/servers/${encodeURIComponent(input.serverId)}/tools`)
  return fetchJson(url, {
    headers: {
      Authorization: `Bearer ${input.adminApiToken}`,
    },
  }).pipe(Effect.map((body) => normalizeCollectionResponse(body, "tools")))
}

export const defaultMcpcfRefreshClient: McpcfRefreshClient = {
  fetchServers,
  fetchServerTools,
}
