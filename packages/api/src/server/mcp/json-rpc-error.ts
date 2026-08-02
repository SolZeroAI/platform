import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

const parseRequestJson = Effect.fn("mcp.jsonRpc.parseRequestJson")(function* (request: Request) {
  return yield* Effect.tryPromise({
    try: () => request.clone().json() as Promise<unknown>,
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed<unknown>(null)))
})

const messageFromBody = (body: unknown): unknown =>
  Match.value(Array.isArray(body)).pipe(
    Match.when(true, () => (body as unknown[])[0]),
    Match.orElse(() => body),
  )

const idFromMessage = (message: unknown): Option.Option<string | number> =>
  Option.fromNullishOr(message).pipe(
    Option.filter((value): value is Record<string, unknown> => typeof value === "object"),
    Option.flatMap((record) => Option.fromNullishOr(record.id)),
    Option.filter((id): id is string | number => typeof id === "string" || typeof id === "number"),
  )

/** Best-effort extraction of the JSON-RPC request id, `None` when absent/null/unparseable. */
export const getJsonRpcRequestId = Effect.fn("mcp.jsonRpc.requestId")(function* (request: Request) {
  const isJson = Boolean(request.headers.get("content-type")?.includes("application/json"))
  const body = yield* Match.value(isJson).pipe(
    Match.when(true, () => parseRequestJson(request)),
    Match.orElse(() => Effect.succeed<unknown>(null)),
  )
  return idFromMessage(messageFromBody(body))
})

export const createJsonRpcErrorResponse = Effect.fn("mcp.jsonRpc.errorResponse")(function* (
  request: Request,
  input: {
    message: string
    code?: number
    status?: number
    data?: Record<string, unknown>
  },
) {
  const requestId = yield* getJsonRpcRequestId(request)
  const dataFields = Option.match(Option.fromNullishOr(input.data), {
    onNone: () => ({}),
    onSome: (data) => ({ data }),
  })
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: input.code ?? -32603,
        message: input.message,
        ...dataFields,
      },
      id: Option.getOrNull(requestId),
    },
    { status: input.status ?? 500 },
  )
})
