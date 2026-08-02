import { parseJson } from "../../../lib/json"
import { describeError, toError } from "../../../lib/effect-errors"
import {
  createNodeContext,
  getPositiveInteger,
  getString,
  renderJsonTemplate,
  renderTemplate,
  stringifyTemplateValue,
  type WorkflowNodeExecutionInput,
} from "./common"
import { workflowNodeFail, workflowNodeFailWhen } from "./errors"
import { recordWorkflowNodeRunEvent } from "./events"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"

export type WorkflowHttpNodeExecutionInput = WorkflowNodeExecutionInput

const workflowHttpNodeTypes = new Set(["http-request"])
const workflowHttpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
const workflowResponseTypes = new Set(["auto", "json", "text"])

export function isWorkflowHttpNodeType(nodeType: string): boolean {
  return workflowHttpNodeTypes.has(nodeType)
}

const requireString = (value: Option.Option<string>, message: string) =>
  Option.match(value, {
    onNone: () => workflowNodeFail(message),
    onSome: (resolved) => Effect.succeed(resolved),
  })

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export const executeWorkflowHttpNode = Effect.fn("workflows.executeHttpNode")(function* (
  input: WorkflowHttpNodeExecutionInput,
) {
  return yield* Match.value(input.node.type).pipe(
    Match.when("http-request", () => runHttpRequestNode(input)),
    Match.orElse((nodeType) => workflowNodeFail(`Unsupported workflow HTTP node '${nodeType}'`)),
  )
})

function getBoolean(value: unknown): Option.Option<boolean> {
  return Match.value(value).pipe(
    Match.when(Match.boolean, (bool) => Option.some(bool)),
    Match.when(Match.string, (stringValue) =>
      Match.value(stringValue).pipe(
        Match.when("true", () => Option.some(true)),
        Match.when("false", () => Option.some(false)),
        Match.orElse(() => Option.none<boolean>()),
      ),
    ),
    Match.orElse(() => Option.none<boolean>()),
  )
}

function requireObjectRecord(value: unknown, message: string): Record<string, unknown> {
  return Match.value(isObjectRecord(value)).pipe(
    Match.when(true, () => value as Record<string, unknown>),
    Match.orElse(() => {
      throw new Error(message)
    }),
  )
}

function getJsonRecord(value: unknown, label: string): Record<string, unknown> {
  return Match.value(value).pipe(
    Match.when(Match.null, () => ({})),
    Match.when(Match.undefined, () => ({})),
    Match.when("", () => ({})),
    Match.when(Match.string, (stringValue) =>
      requireObjectRecord(parseJson(stringValue), `${label} must be a JSON object`),
    ),
    Match.orElse((other) => requireObjectRecord(other, `${label} must be an object`)),
  )
}

function renderHeaders(
  value: unknown,
  context: Record<string, unknown>,
  label: string,
): Record<string, string> {
  const headers = getJsonRecord(value, label)
  return Object.fromEntries(
    Arr.filterMap(Object.entries(headers), ([key, headerValue]) =>
      Match.value(headerValue).pipe(
        Match.when(Match.null, () => Result.failVoid),
        Match.when(Match.undefined, () => Result.failVoid),
        Match.orElse((resolved) =>
          Result.succeed([key, renderTemplate(stringifyTemplateValue(resolved), context)] as [
            string,
            string,
          ]),
        ),
      ),
    ),
  )
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function buildRedactedUrl(parsed: URL): string {
  const redactedParams = new URLSearchParams()
  Arr.forEach(Array.from(parsed.searchParams.keys()), (key) => {
    redactedParams.set(key, "redacted")
  })
  parsed.search = redactedParams.toString()
  return parsed.toString()
}

function redactSearchParams(parsed: URL): string {
  return Match.value(parsed.search.length > 0).pipe(
    Match.when(true, () => buildRedactedUrl(parsed)),
    Match.orElse(() => parsed.toString()),
  )
}

function sanitizeParsedUrl(url: string): string {
  const parsed = new URL(url)
  parsed.username = ""
  parsed.password = ""
  return redactSearchParams(parsed)
}

function sanitizeUrlForLog(url: string): string {
  return Match.value(URL.canParse(url)).pipe(
    Match.when(false, () => url),
    Match.orElse(() => sanitizeParsedUrl(url)),
  )
}

function getHeaderNames(headers: Record<string, string>): string {
  return [...new Set(Object.keys(headers).map((header) => header.toLowerCase()))]
    .sort((left, right) => left.localeCompare(right))
    .join(",")
}

function getHeaderValue(headers: Record<string, string>, name: string): Option.Option<string> {
  const lowerName = name.toLowerCase()
  return Arr.findFirst(Object.entries(headers), ([key]) => key.toLowerCase() === lowerName).pipe(
    Option.map(([, headerValue]) => headerValue),
  )
}

function isJsonContentType(headers: Record<string, string>): boolean {
  return Option.getOrElse(getHeaderValue(headers, "content-type"), () => "")
    .toLowerCase()
    .includes("json")
}

function getContentLength(value: string | undefined): number {
  return Option.match(Option.fromNullishOr(value), {
    onNone: () => 0,
    onSome: (resolved) => new TextEncoder().encode(resolved).length,
  })
}

function hasConfiguredBody(value: unknown): boolean {
  return Match.value(value).pipe(
    Match.when(Match.null, () => false),
    Match.when(Match.undefined, () => false),
    Match.when("", () => false),
    Match.orElse(() => true),
  )
}

function looksLikeJsonDocument(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function renderJsonRequestBody(value: string, context: Record<string, unknown>): string {
  const rendered = renderJsonTemplate(value, context)
  parseJson(rendered)
  return rendered
}

function renderRequestBodyString(
  value: string,
  context: Record<string, unknown>,
  headers: Record<string, string>,
): string {
  return Match.value(!isJsonContentType(headers) || !looksLikeJsonDocument(value)).pipe(
    Match.when(true, () => renderTemplate(value, context)),
    Match.orElse(() => renderJsonRequestBody(value, context)),
  )
}

type ParsedResponseBody =
  | { ok: true; jsonBody: unknown; responseBody: unknown }
  | { ok: false; error: unknown }

function tryParseResponseBody(text: string, responseType: string): ParsedResponseBody {
  return Match.value(text.length > 0).pipe(
    Match.when(false, () => ({ ok: true as const, jsonBody: null, responseBody: null })),
    Match.orElse(() =>
      Result.match(
        Result.try(() => parseJson(text)),
        {
          onSuccess: (jsonBody) => ({ ok: true as const, jsonBody, responseBody: jsonBody }),
          onFailure: (error) =>
            Match.value(responseType === "json").pipe(
              Match.when(true, () => ({ ok: false as const, error })),
              Match.orElse(() => ({ ok: true as const, jsonBody: null, responseBody: text })),
            ),
        },
      ),
    ),
  )
}

const recordNodeEvent = (
  input: WorkflowHttpNodeExecutionInput,
  event: Parameters<typeof recordWorkflowNodeRunEvent>[1],
) => recordWorkflowNodeRunEvent(input, event)

type RequestLog = {
  method: string
  url: string
  headerNames: string
  hasBody: boolean
  bodyBytes: number
  timeoutMs: number | null
  responseType: string
  failOnHttpError: boolean
}

type ResponseLog = {
  status: number
  statusText: string
  ok: boolean
  url: string
  contentType: string | null
  bodyBytes: number
  durationMs: number
}

const failHttpFetch = Effect.fn("workflows.failHttpFetch")(function* (params: {
  input: WorkflowHttpNodeExecutionInput
  requestLog: RequestLog
  requestStartedAt: number
  error: unknown
}) {
  const durationMs = Date.now() - params.requestStartedAt
  const message = describeError(params.error)
  yield* Effect.logError("workflowHttpRequestFailed").pipe(
    Effect.annotateLogs({
      workflowId: params.input.workflowId,
      runId: params.input.runId,
      nodeId: params.input.node.id,
      nodeType: params.input.node.type,
      request: params.requestLog,
      durationMs,
      error: message,
    }),
  )
  yield* recordNodeEvent(params.input, {
    eventType: "http_request_failed",
    level: "error",
    message: `${params.input.node.label} HTTP request failed before response`,
    data: { request: params.requestLog, durationMs, error: message },
  })
  return yield* Effect.fail(toError(params.error))
})

const failHttpJsonInvalid = Effect.fn("workflows.failHttpJsonInvalid")(function* (params: {
  input: WorkflowHttpNodeExecutionInput
  requestLog: RequestLog
  responseLog: ResponseLog
  error: unknown
}) {
  yield* Effect.logError("workflowHttpResponseJsonInvalid").pipe(
    Effect.annotateLogs({
      workflowId: params.input.workflowId,
      runId: params.input.runId,
      nodeId: params.input.node.id,
      nodeType: params.input.node.type,
      request: params.requestLog,
      response: params.responseLog,
      error: describeError(params.error),
    }),
  )
  yield* recordNodeEvent(params.input, {
    eventType: "http_request_failed",
    level: "error",
    message: `${params.input.node.label} response body was not valid JSON`,
    data: {
      request: params.requestLog,
      response: params.responseLog,
      error: describeError(params.error),
    },
  })
  return yield* workflowNodeFail("Response body was not valid JSON")
})

const failHttpStatus = Effect.fn("workflows.failHttpStatus")(function* (params: {
  input: WorkflowHttpNodeExecutionInput
  requestLog: RequestLog
  responseLog: ResponseLog
  status: number
}) {
  yield* Effect.logWarning("workflowHttpRequestStatusFailed").pipe(
    Effect.annotateLogs({
      workflowId: params.input.workflowId,
      runId: params.input.runId,
      nodeId: params.input.node.id,
      nodeType: params.input.node.type,
      request: params.requestLog,
      response: params.responseLog,
    }),
  )
  yield* recordNodeEvent(params.input, {
    eventType: "http_request_failed",
    level: "error",
    message: `HTTP request failed with status ${params.status}`,
    data: { request: params.requestLog, response: params.responseLog },
  })
  return yield* workflowNodeFail(`HTTP request failed with status ${params.status}`)
})

const resolveJsonBody = Effect.fn("workflows.resolveHttpJsonBody")(function* (params: {
  input: WorkflowHttpNodeExecutionInput
  text: string
  responseType: string
  requestLog: RequestLog
  responseLog: ResponseLog
}) {
  const parsed = tryParseResponseBody(params.text, params.responseType)
  return yield* Match.value(parsed).pipe(
    Match.when({ ok: false }, (failure) =>
      failHttpJsonInvalid({
        input: params.input,
        requestLog: params.requestLog,
        responseLog: params.responseLog,
        error: failure.error,
      }),
    ),
    Match.orElse((success) =>
      Effect.succeed({ jsonBody: success.jsonBody, responseBody: success.responseBody }),
    ),
  )
})

const runHttpRequestNode = Effect.fn("workflows.runHttpRequestNode")(function* (
  input: WorkflowHttpNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const context = createNodeContext(input)
  const urlTemplate = yield* requireString(
    Option.orElse(getString(input.inputs.url), () => getString(options.url)),
    "Request URL is required",
  )
  const url = renderTemplate(urlTemplate, context)
  yield* workflowNodeFailWhen(
    !url.startsWith("http://") && !url.startsWith("https://"),
    "Request URL must start with http:// or https://",
  )

  const method = Option.getOrElse(
    Option.orElse(getString(input.inputs.method), () => getString(options.method)),
    () => "GET",
  ).toUpperCase()
  yield* workflowNodeFailWhen(
    !workflowHttpMethods.has(method),
    `Unsupported request method '${method}'`,
  )

  const optionHeaders = renderHeaders(options.headers, context, "Request headers")
  const inputHeaders = Match.value("headers" in input.inputs).pipe(
    Match.when(true, () => renderHeaders(input.inputs.headers, context, "Request input headers")),
    Match.orElse(() => ({})),
  )
  const baseHeaders = { ...optionHeaders, ...inputHeaders }
  const bodyValue = Match.value(hasConfiguredBody(options.body)).pipe(
    Match.when(true, () => options.body),
    Match.orElse(() =>
      Match.value("body" in input.inputs).pipe(
        Match.when(true, () => input.inputs.body),
        Match.orElse(() => options.body),
      ),
    ),
  )
  const canHaveBody = method !== "GET" && method !== "HEAD"
  const body = Match.value(bodyValue === null || bodyValue === undefined || !canHaveBody).pipe(
    Match.when(true, () => undefined),
    Match.orElse(() =>
      Match.value(typeof bodyValue === "string").pipe(
        Match.when(true, () => renderRequestBodyString(bodyValue as string, context, baseHeaders)),
        Match.orElse(() =>
          // oxlint-disable-next-line effect/avoid-direct-json -- Serializes a non-string request body as 2-space pretty-printed JSON sent on the wire; the sanctioned `stringifyJson` helper is compact and would change the outbound request payload bytes.
          JSON.stringify(bodyValue, null, 2),
        ),
      ),
    ),
  )
  const needsJsonContentType =
    body !== undefined &&
    typeof bodyValue !== "string" &&
    !Object.keys(baseHeaders).some((key) => key.toLowerCase() === "content-type")
  const headers = Match.value(needsJsonContentType).pipe(
    Match.when(true, () => ({ ...baseHeaders, "Content-Type": "application/json" })),
    Match.orElse(() => baseHeaders),
  )

  const timeoutMs = Option.getOrUndefined(
    Option.orElse(getPositiveInteger(input.inputs.timeoutMs), () =>
      getPositiveInteger(options.timeoutMs),
    ),
  )
  const responseType = Option.getOrElse(
    Option.orElse(getString(input.inputs.responseType), () => getString(options.responseType)),
    () => "auto",
  )
  yield* workflowNodeFailWhen(
    !workflowResponseTypes.has(responseType),
    `Unsupported response type '${responseType}'`,
  )

  const failOnHttpError = Option.getOrElse(getBoolean(options.failOnHttpError), () => false)
  const requestStartedAt = Date.now()
  const requestLog: RequestLog = {
    method,
    url: sanitizeUrlForLog(url),
    headerNames: getHeaderNames(headers),
    hasBody: body !== undefined,
    bodyBytes: getContentLength(body),
    timeoutMs: timeoutMs ?? null,
    responseType,
    failOnHttpError,
  }
  yield* Effect.logInfo("workflowHttpRequestStarted").pipe(
    Effect.annotateLogs({
      workflowId: input.workflowId,
      runId: input.runId,
      nodeId: input.node.id,
      nodeType: input.node.type,
      request: requestLog,
    }),
  )
  yield* recordNodeEvent(input, {
    eventType: "http_request_started",
    message: `${input.node.label} HTTP request started`,
    data: { request: requestLog },
  })

  const signal = Option.match(Option.fromNullishOr(timeoutMs), {
    onNone: () => undefined,
    onSome: (ms) => AbortSignal.timeout(ms),
  })
  const response = yield* Effect.tryPromise({
    try: () =>
      // oxlint-disable-next-line effect/avoid-native-fetch -- External HTTP boundary (user-authored workflow request) inside a workflow node executor; native fetch is required at this external API edge.
      fetch(url, { method, headers, body, signal }),
    catch: toError,
  }).pipe(Effect.catch((error) => failHttpFetch({ input, requestLog, requestStartedAt, error })))

  const responseHeaders = headersToRecord(response.headers)
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: toError,
  })
  const contentType = response.headers.get("content-type") ?? ""
  const responseLog: ResponseLog = {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    url: sanitizeUrlForLog(response.url),
    contentType: contentType || null,
    bodyBytes: getContentLength(text),
    durationMs: Date.now() - requestStartedAt,
  }
  const shouldParseJson =
    responseType === "json" || (responseType === "auto" && contentType.includes("json"))
  const parsedBody = yield* Match.value(shouldParseJson).pipe(
    Match.when(false, () =>
      Effect.succeed({ jsonBody: null as unknown, responseBody: text as unknown }),
    ),
    Match.orElse(() => resolveJsonBody({ input, text, responseType, requestLog, responseLog })),
  )

  const shouldFailOnHttpStatus = Effect.succeed(failOnHttpError && !response.ok)
  yield* failHttpStatus({ input, requestLog, responseLog, status: response.status }).pipe(
    Effect.when(shouldFailOnHttpStatus),
  )

  yield* Effect.logInfo("workflowHttpRequestCompleted").pipe(
    Effect.annotateLogs({
      workflowId: input.workflowId,
      runId: input.runId,
      nodeId: input.node.id,
      nodeType: input.node.type,
      request: requestLog,
      response: responseLog,
    }),
  )
  yield* recordNodeEvent(input, {
    eventType: "http_request_completed",
    message: `${input.node.label} returned ${response.status}`,
    data: { request: requestLog, response: responseLog },
  })

  return {
    outputs: {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: responseHeaders,
      body: parsedBody.responseBody,
      json: parsedBody.jsonBody,
      text,
    },
  }
})
