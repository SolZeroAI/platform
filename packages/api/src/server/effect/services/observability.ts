import type { ApiEnv } from "infra/types/env"
import { getStageMetadataSync, type StageMetadataInput } from "@solzero/shared"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Logger from "effect/Logger"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as R from "effect/Record"
import { HttpServerError, type HttpServerResponse } from "effect/unstable/http"
import {
  createLocalSpanContext,
  localSpanLogAnnotations,
  type LocalSpanContext,
} from "../../background/observability/tracing"
import {
  causeFailureAttributes,
  normalizeError,
  runCloudflarePromiseSpan,
  runEffectInCloudflareSpan,
  setCloudflareSpanAttributes,
  spanAttributeInput,
  toSpanAttributes,
  type CloudflareSpan,
  type CloudflareTracing,
} from "../../background/observability/span"

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "cf-access-jwt-assertion",
])

export type TracedExecutionContext = ExecutionContext & {
  readonly tracing: CloudflareTracing
}

export function createNoopTracing(): CloudflareTracing {
  class NoopSpan {
    get isTraced() {
      return false
    }
    setAttribute() {}
    end() {}
  }
  const enterNoopSpan: CloudflareTracing["enterSpan"] = (_name, callback, ...args) =>
    callback(new NoopSpan(), ...args)
  return {
    Span: NoopSpan,
    enterSpan: enterNoopSpan,
    startActiveSpan: enterNoopSpan,
  }
}

export interface RequestObservabilityShape {
  readonly requestId: string
  readonly requestIdSrc: "x-request-id" | "cf-ray" | "generated"
  readonly method: string
  readonly path: string
  readonly hostname: string
  readonly stage: string
  readonly workerName: string
  readonly logFormat: "pretty" | "json"
  readonly consoleOutputEnabled: boolean
  readonly traceparent: string | null
  readonly tracestate: string | null
  readonly cfRay: string | null
  readonly startedAt: number
  readonly localTraceContext: LocalSpanContext
  routeBranch: string
  userId: string | null
  oktaUserId: string | null
}

export interface RequestLogger {
  readonly set: (fields: Record<string, unknown>) => void
  readonly emit: (fields: Record<string, unknown>) => void
  readonly info: (event: string, fields?: Record<string, unknown>) => void
  readonly warn: (event: string, fields?: Record<string, unknown>) => void
  readonly debug: (event: string, fields?: Record<string, unknown>) => void
  readonly error: (error: unknown, fields?: Record<string, unknown>) => void
}

type VoidEffect = typeof Effect.void

export interface EffectRequestLoggerService {
  readonly set: (fields: Record<string, unknown>) => VoidEffect
  readonly emit: (fields: Record<string, unknown>) => VoidEffect
  readonly info: (event: string, fields?: Record<string, unknown>) => VoidEffect
  readonly warn: (event: string, fields?: Record<string, unknown>) => VoidEffect
  readonly debug: (event: string, fields?: Record<string, unknown>) => VoidEffect
  readonly error: (error: unknown, fields?: Record<string, unknown>) => VoidEffect
}

export class EffectRequestLogger extends Context.Service<
  EffectRequestLogger,
  EffectRequestLoggerService
>()("s0/api/EffectRequestLogger") {}

export interface RequestObservabilityService {
  readonly context: RequestObservabilityShape
  readonly log: RequestLogger
  readonly effectLog: EffectRequestLoggerService
  readonly tracing: CloudflareTracing
  readonly activateCloudflareSpan: (span: CloudflareSpan) => () => void
  readonly annotateRequestSpan: (fields: Record<string, unknown>) => void
  readonly withCloudflareSpan: <A>(
    name: string,
    attributes: Record<string, unknown>,
    handler: (span: CloudflareSpan) => Promise<A>,
  ) => Promise<A>
}

export class RequestObservability extends Context.Service<
  RequestObservability,
  RequestObservabilityService
>()("s0/api/RequestObservability") {}

export function makeRequestObservability(
  request: Request,
  env: ApiEnv,
  routeBranch = "unknown",
): RequestObservabilityShape {
  const url = new URL(request.url)
  const cfRay = request.headers.get("cf-ray")
  const requestIdHeader = request.headers.get("x-request-id")
  const requestId = requestIdHeader ?? cfRay ?? crypto.randomUUID()
  const stageMetadata = getStageMetadataSync(env)
  const requestIdSrc: RequestObservabilityShape["requestIdSrc"] = Option.match(
    Option.liftPredicate(requestIdHeader, Boolean),
    {
      onSome: () => "x-request-id" as const,
      onNone: () =>
        Option.match(Option.liftPredicate(cfRay, Boolean), {
          onSome: () => "cf-ray" as const,
          onNone: () => "generated" as const,
        }),
    },
  )
  return {
    requestId,
    requestIdSrc,
    method: request.method,
    path: url.pathname,
    hostname: url.hostname,
    stage: env.STAGE,
    workerName: env.WORKER_NAME,
    logFormat: stageMetadata.infra.apiObservabilityLogFormat,
    consoleOutputEnabled: stageMetadata.infra.apiObservabilityConsoleOutputEnabled,
    traceparent: request.headers.get("traceparent"),
    tracestate: request.headers.get("tracestate"),
    cfRay,
    startedAt: Date.now(),
    localTraceContext: createLocalSpanContext(),
    routeBranch,
    userId: null,
    oktaUserId: null,
  }
}

export function setRequestUserId(
  observability: RequestObservabilityShape,
  userId: string | null | undefined,
): void {
  observability.userId = userId?.trim() || null
}

export function setRequestUserIdentity(
  observability: RequestObservabilityShape,
  identity: {
    readonly userId: string
    readonly oktaUserId?: string | null
  },
): void {
  observability.userId = identity.userId.trim() || null
  Match.value("oktaUserId" in identity).pipe(
    Match.when(true, () => {
      observability.oktaUserId = identity.oktaUserId?.trim() || null
    }),
    Match.orElse(() => undefined),
  )
}

export function redactHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers.entries(), ([key, value]) => [
      key,
      Match.value(SENSITIVE_HEADER_NAMES.has(key.toLowerCase())).pipe(
        Match.when(true, () => "[REDACTED]"),
        Match.orElse(() => value),
      ),
    ]),
  )
}

function optionalAnnotation<T>(key: string, value: T | null | undefined): Record<string, T> {
  return Option.match(Option.filter(Option.fromNullishOr(value), Boolean), {
    onNone: (): Record<string, T> => ({}),
    onSome: (resolved) => ({ [key]: resolved }),
  })
}

export function requestLogAnnotations(
  observability: RequestObservabilityShape,
): RequestLogAnnotations {
  return {
    requestId: observability.requestId,
    requestIdSrc: observability.requestIdSrc,
    method: observability.method,
    path: observability.path,
    routeBranch: observability.routeBranch,
    stage: observability.stage,
    workerName: observability.workerName,
    ...localSpanLogAnnotations(observability.localTraceContext),
    ...optionalAnnotation("cfRay", observability.cfRay),
    ...optionalAnnotation("traceparent", observability.traceparent),
    ...optionalAnnotation("tracestate", observability.tracestate),
    ...optionalAnnotation("userId", observability.userId),
    ...optionalAnnotation("oktaUserId", observability.oktaUserId),
  }
}

export function requestSpanAttributes(
  observability: RequestObservabilityShape,
): Record<string, string | number | boolean> {
  return compact({
    "cf.ray": observability.cfRay,
    "http.request.method": observability.method,
    "request.id": observability.requestId,
    "request.id_source": observability.requestIdSrc,
    "service.stage": observability.stage,
    "service.worker_name": observability.workerName,
    ...localSpanLogAnnotations(observability.localTraceContext),
    "url.path": observability.path,
    "url.hostname": observability.hostname,
    "route.branch": observability.routeBranch,
    traceparent: observability.traceparent,
    tracestate: observability.tracestate,
    "user.id": observability.userId,
    "user.okta_id": observability.oktaUserId,
  }) as Record<string, string | number | boolean>
}

export function routeSpanAttributes(
  observability: RequestObservabilityShape,
  group: string,
  endpoint: string,
): Record<string, string | number | boolean> {
  return compact({
    ...requestSpanAttributes(observability),
    "http.route.group": group,
    "http.route.endpoint": endpoint,
  }) as Record<string, string | number | boolean>
}

export type ApiSurfaceName =
  | "better_auth"
  | "auth_provider_config"
  | "ai_search_mcp"
  | "effect_http_api"
  | "github_app_webhook"
  | "internal_mcp_not_found"
  | "mcpcf_mcp"
  | "session_websocket"
  | "workflow_builder_mcp"
  | "workflow_public"

export function apiSurfaceSpanAttributes(
  observability: RequestObservabilityShape,
  surface: ApiSurfaceName,
): Record<string, string | number | boolean> {
  return compact({
    ...requestSpanAttributes(observability),
    "api.surface": surface,
  }) as Record<string, string | number | boolean>
}

export function withApiSurfaceSpan(
  observability: RequestObservabilityService,
  surface: ApiSurfaceName,
  handler: () => Promise<Response>,
): Promise<Response>
export function withApiSurfaceSpan<A>(
  observability: RequestObservabilityService,
  surface: ApiSurfaceName,
  handler: () => Promise<A>,
  options: {
    readonly response?: (value: A) => Response | null | undefined
    readonly attributes?: (value: A) => Record<string, unknown>
  },
): Promise<A>
export function withApiSurfaceSpan<A>(
  observability: RequestObservabilityService,
  surface: ApiSurfaceName,
  handler: () => Promise<A>,
  options: {
    readonly response?: (value: A) => Response | null | undefined
    readonly attributes?: (value: A) => Record<string, unknown>
  } = {},
): Promise<A> {
  async function runSurfaceSpan(span: CloudflareSpan): Promise<A> {
    const result = await handler()
    setCloudflareSpanAttributes(
      span,
      spanAttributeInput(compact(options.attributes?.(result) ?? {})),
    )
    const resultValue: unknown = result
    const response = Option.getOrUndefined(
      Option.orElse(Option.fromNullishOr(options.response?.(result)), () =>
        Option.liftPredicate(resultValue, (value): value is Response => value instanceof Response),
      ),
    )
    Option.match(Option.fromNullishOr(response), {
      onNone: () => undefined,
      onSome: (resolved) =>
        setCloudflareSpanAttributes(
          span,
          requestResponseAttributes(observability.context, resolved),
        ),
    })
    return result
  }

  return observability.withCloudflareSpan(
    `api.${surface}`,
    apiSurfaceSpanAttributes(observability.context, surface),
    runSurfaceSpan,
  )
}

export function observeEffectHttpApi<A extends HttpServerResponse.HttpServerResponse, E, R>(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Effect HTTP middleware preserves the generated router's native A/E/R channels.
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const observability = yield* RequestObservability
    return yield* withObservedSpan(
      "api.effect_http_api",
      apiSurfaceSpanAttributes(observability.context, "effect_http_api"),
      effect,
      {
        completedAttributes: (exit, durationMs) =>
          Exit.match(exit, {
            onFailure: (cause) => ({
              ...httpServerFailureAttributes(cause),
              duration_ms: durationMs,
            }),
            onSuccess: (response) => ({
              ...httpServerResponseAttributes(response),
              duration_ms: durationMs,
              status: "ok",
            }),
          }),
      },
    )
  })
}

export function observeRoute<A, E, R>(
  group: string,
  endpoint: string,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic route combinator: the `Effect<A, E, R>` parameter channel is intrinsic to forwarding the caller's route effect into withObservedSpan.
  effect: Effect.Effect<A, E, R>,
) {
  const spanName = `http.${group}.${endpoint}`
  return Effect.gen(function* () {
    const observability = yield* RequestObservability
    const attributes = routeSpanAttributes(observability.context, group, endpoint)
    return yield* withObservedSpan(
      spanName,
      attributes,
      effect.pipe(
        Effect.annotateLogs({
          routeGroup: group,
          routeEndpoint: endpoint,
          ...optionalAnnotation("userId", observability.context.userId),
          ...optionalAnnotation("oktaUserId", observability.context.oktaUserId),
        }),
      ),
    )
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Exported channel boundary: the gen requires RequestObservability (yielded above), but that service is satisfied by the request-scoped layer, so the public channel intentionally stays `R`.
  }) as Effect.Effect<A, E, R>
}

function annotateCauseFailure(
  observability: RequestObservabilityService,
  cause: Cause.Cause<unknown>,
) {
  const errorAttributes = causeFailureAttributes(cause)
  observability.annotateRequestSpan(errorAttributes)
  return Effect.annotateCurrentSpan(errorAttributes)
}

export function withObservedSpan<A, E, R>(
  name: string,
  attributes: Record<string, unknown>,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span combinator: the `Effect<A, E, R>` parameter channel is intrinsic to the combinator contract.
  effect: Effect.Effect<A, E, R>,
  options: {
    readonly completedAttributes?: (
      exit: Exit.Exit<A, E>,
      durationMs: number,
    ) => Record<string, unknown>
  } = {},
) {
  return Effect.gen(function* () {
    const currentContext = yield* Effect.context<R | RequestObservability>()
    const observability = yield* RequestObservability
    const spanAttributes = toSpanAttributes(spanAttributeInput(attributes))
    yield* Effect.annotateCurrentSpan(spanAttributes)
    let deactivateCloudflareSpan: () => void = () => undefined

    const instrumented = effect.pipe(
      Effect.tapCause((cause) => annotateCauseFailure(observability, cause)),
      Effect.annotateLogs(spanAttributes),
      Effect.annotateLogs({
        spanName: name,
      }),
      Effect.withLogSpan(name),
      Effect.withSpan(name, {
        kind: "server",
        attributes: spanAttributes,
      }),
    )

    const completedAttributes = Option.match(Option.fromNullishOr(options.completedAttributes), {
      onNone: () => undefined,
      onSome: (resolveCompletedAttributes) => (exit: Exit.Exit<A, E>, durationMs: number) =>
        spanAttributeInput(resolveCompletedAttributes(exit, durationMs)),
    })

    return yield* runEffectInCloudflareSpan({
      name,
      tracing: observability.tracing,
      attributes: spanAttributes,
      context: currentContext,
      effect: instrumented,
      completedAttributes,
      onSpanEnd: () => {
        deactivateCloudflareSpan()
      },
      onSpanStart: (span) => {
        deactivateCloudflareSpan = observability.activateCloudflareSpan(span)
        observability.annotateRequestSpan(spanAttributes)
      },
    })
  })
}

export function annotateCurrentUserIdentity(identity: {
  readonly userId: string
  readonly oktaUserId?: string | null
}) {
  return Effect.gen(function* () {
    const observability = yield* RequestObservability
    const effectLog = yield* EffectRequestLogger
    setRequestUserIdentity(observability.context, identity)
    const attributes = compact({
      "user.id": identity.userId,
      "user.okta_id": identity.oktaUserId,
    })
    yield* effectLog.set({
      "user.id": observability.context.userId,
      "user.okta_id": observability.context.oktaUserId,
      userId: observability.context.userId,
      oktaUserId: observability.context.oktaUserId,
    })
    observability.annotateRequestSpan(attributes)
    yield* Effect.annotateCurrentSpan(attributes)
  })
}

export function annotateCurrentUserId(userId: string) {
  return annotateCurrentUserIdentity({ userId })
}

export function observabilityLayer(options: {
  readonly logFormat: "pretty" | "json"
  readonly consoleOutputEnabled: boolean
}) {
  // Cloudflare spans are the trace source of truth; app logs carry correlation
  // fields directly instead of being mirrored into Effect span events.
  return Match.value(options.consoleOutputEnabled).pipe(
    Match.when(false, () => Logger.layer([])),
    Match.orElse(() =>
      Logger.layer([
        Match.value(options.logFormat).pipe(
          Match.when("pretty", () => Logger.consolePretty({ colors: "auto", mode: "auto" })),
          Match.orElse(() => Logger.consoleJson),
        ),
      ]),
    ),
  )
}

export function resetApiTelemetryForTests(): void {
  // Test helper retained for callers that reset global observability state.
  // Cloudflare-native export is configured on the Worker and has no SDK cache to clear.
}

export function makeEffectLoggerLayer(options: {
  readonly stageMetadataInput: StageMetadataInput
  readonly workerName: string
  readonly commitSha?: string
}) {
  const stageMetadata = getStageMetadataSync(options.stageMetadataInput)
  return observabilityLayer({
    consoleOutputEnabled: stageMetadata.infra.apiObservabilityConsoleOutputEnabled,
    logFormat: stageMetadata.infra.apiObservabilityLogFormat,
  })
}

export interface ApiRequestObserver {
  readonly observability: RequestObservabilityService
  readonly context: RequestObservabilityShape
  readonly log: RequestLogger
  setRouteBranch(branch: string): void
  setUserId(userId: string | null): void
  setUserIdentity(identity: { userId: string; oktaUserId?: string | null }): void
  run(handler: (observer: ApiRequestObserver) => Promise<Response>): Promise<Response>
}

type RequestOutcome =
  | { readonly _tag: "success"; readonly response: Response }
  | { readonly _tag: "failure"; readonly error: unknown }

function raise(error: unknown): never {
  throw error
}

function runCloudflareSpan<A>(
  span: CloudflareSpan,
  attributes: Record<string, unknown>,
  handler: (span: CloudflareSpan) => Promise<A>,
): Promise<A> {
  return runCloudflarePromiseSpan(span, spanAttributeInput(attributes), handler)
}

export function createApiRequestObserver(
  request: Request,
  env: ApiEnv,
  ctx: ExecutionContext,
): ApiRequestObserver {
  const tracing = resolveCloudflareTracing(ctx)
  const context = makeRequestObservability(request, env)
  const pendingTelemetryRuns: Array<Promise<void>> = []
  let activeSpan: Option.Option<CloudflareSpan> = Option.none()

  function scheduleRequestEffect(
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Telemetry scheduler accepts an already-built observability Effect; the `Effect<void>` channel is intrinsic to forwarding it to the boundary runner.
    effect: Effect.Effect<void>,
  ): Promise<void> {
    const promise = runRequestEffect(env, effect)
    pendingTelemetryRuns.push(promise)
    ctx.waitUntil(promise)
    return promise
  }

  const annotateRequestSpan = (fields: Record<string, unknown>) =>
    Option.match(activeSpan, {
      onNone: () => undefined,
      onSome: (span) => setCloudflareSpanAttributes(span, spanAttributeInput(fields)),
    })

  const logCore = createRequestLogCore(context, annotateRequestSpan)
  const effectLog = createEffectRequestLogger(logCore)
  const log = createRequestLogger(scheduleRequestEffect, logCore, effectLog)
  const observability: RequestObservabilityService = {
    context,
    log,
    effectLog,
    tracing,
    activateCloudflareSpan(span) {
      const previousSpan = activeSpan
      activeSpan = Option.some(span)
      return () => {
        activeSpan = previousSpan
      }
    },
    annotateRequestSpan,
    withCloudflareSpan<A>(
      name: string,
      attributes: Record<string, unknown>,
      handler: (span: CloudflareSpan) => Promise<A>,
    ) {
      function enterSpan(span: CloudflareSpan): Promise<A> {
        const deactivateCloudflareSpan = observability.activateCloudflareSpan(span)
        return runCloudflareSpan(span, attributes, handler).finally(() => {
          deactivateCloudflareSpan()
        })
      }

      return tracing.enterSpan(name, enterSpan)
    },
  }

  const observer: ApiRequestObserver = {
    observability,
    context,
    log,
    setRouteBranch(branch) {
      context.routeBranch = branch
      log.set({ "route.branch": branch, routeBranch: branch })
    },
    setUserId(userId) {
      setRequestUserId(context, userId)
      log.set({ "user.id": context.userId, userId: context.userId })
    },
    setUserIdentity(identity) {
      setRequestUserIdentity(context, identity)
      log.set({
        "user.id": context.userId,
        "user.okta_id": context.oktaUserId,
        userId: context.userId,
        oktaUserId: context.oktaUserId,
      })
    },
    async run(handler) {
      const settled: RequestOutcome = await handler(observer).then(
        (response): RequestOutcome => ({ _tag: "success", response }),
        (error): RequestOutcome => ({ _tag: "failure", error }),
      )

      const telemetryFlush = Promise.allSettled(pendingTelemetryRuns).then(() => undefined)
      ctx.waitUntil(telemetryFlush)
      await Match.value(context.stage === "dev").pipe(
        Match.when(true, () => telemetryFlush),
        Match.orElse(() => Promise.resolve()),
      )
      return Match.value(settled).pipe(
        Match.when({ _tag: "success" }, ({ response }) => response),
        Match.orElse(({ error }) => raise(error)),
      )
    },
  }

  return observer
}

export function runRequestEffect(
  env: ApiEnv,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Request/telemetry boundary-runner accepts a fully self-contained observability Effect; the `Effect<void>` channel is intrinsic to the runner contract.
  effect: Effect.Effect<void>,
): Promise<void> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Request/telemetry boundary-runner; runs the observability Effect at the Worker edge.
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        makeEffectLoggerLayer({
          commitSha: env.COMMIT_SHA,
          stageMetadataInput: env,
          workerName: env.WORKER_NAME,
        }),
      ),
    ),
  )
}

interface RequestLogCore {
  readonly set: (fields: Record<string, unknown>) => void
  readonly log: (
    level: "debug" | "error" | "info" | "warn",
    event: string,
    fields: Record<string, unknown>,
    error?: unknown,
  ) => VoidEffect
}

function createRequestLogCore(
  context: RequestObservabilityShape,
  annotateRequestSpan: (fields: Record<string, unknown>) => void,
): RequestLogCore {
  const fields: Record<string, unknown> = { ...requestLogAnnotations(context) }

  const eventFields = (event: string, nextFields: Record<string, unknown> = {}) =>
    compact({
      ...fields,
      ...nextFields,
      event,
    })

  const logWithLevel = (
    level: "debug" | "error" | "info" | "warn",
    event: string,
    nextFields: Record<string, unknown>,
    error?: unknown,
  ) =>
    Effect.suspend(() =>
      logWithAnnotations({
        annotations: annotateLogEvent(eventFields(event, nextFields), annotateRequestSpan),
        error,
        event,
        level,
      }),
    )

  return {
    set(nextFields) {
      const sanitized = compact(nextFields)
      Object.assign(fields, sanitized)
      annotateRequestSpan(sanitized)
    },
    log: logWithLevel,
  }
}

function annotateLogEvent(
  annotations: Record<string, unknown>,
  annotateRequestSpan: (fields: Record<string, unknown>) => void,
) {
  annotateRequestSpan(annotations)
  return annotations
}

function logWithAnnotations(input: {
  readonly annotations: Record<string, unknown>
  readonly error?: unknown
  readonly event: string
  readonly level: "debug" | "error" | "info" | "warn"
}) {
  const value = Option.match(Option.liftPredicate(input.error, Boolean), {
    onNone: () => input.event,
    onSome: (resolved) => getErrorLogValue(resolved),
  })
  const effect = Match.value(input.level).pipe(
    Match.when("error", () => Effect.logError(value)),
    Match.when("warn", () => Effect.logWarning(value)),
    Match.when("debug", () => Effect.logDebug(value)),
    Match.orElse(() => Effect.logInfo(value)),
  )
  return effect.pipe(Effect.annotateLogs(input.annotations))
}

function setCoreFields(core: RequestLogCore, fields: Record<string, unknown>) {
  core.set(fields)
  return Effect.void
}

function createEffectRequestLogger(core: RequestLogCore): EffectRequestLoggerService {
  return {
    set(nextFields) {
      return Effect.suspend(() => setCoreFields(core, nextFields))
    },
    emit(nextFields) {
      const event = String(nextFields.event ?? "request.log")
      return core.log("info", event, nextFields)
    },
    info(event, nextFields = {}) {
      return core.log("info", event, nextFields)
    },
    warn(event, nextFields = {}) {
      return core.log("warn", event, nextFields)
    },
    debug(event, nextFields = {}) {
      return core.log("debug", event, nextFields)
    },
    error(error, nextFields = {}) {
      return core.log(
        "error",
        String(nextFields.event ?? "request.error"),
        {
          ...nextFields,
          _forceKeep: true,
        },
        error,
      )
    },
  }
}

function createRequestLogger(
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Logger sink accepts an already-built log Effect; the `Effect<void>` channel is intrinsic to forwarding it to the scheduler.
  run: (effect: Effect.Effect<void>) => Promise<void>,
  core: RequestLogCore,
  effectLog: EffectRequestLoggerService,
): RequestLogger {
  const runLog = (effect: VoidEffect) => {
    run(effect)
  }

  return {
    set(nextFields) {
      core.set(nextFields)
    },
    emit(nextFields) {
      runLog(effectLog.emit(nextFields))
    },
    info(event, nextFields = {}) {
      runLog(effectLog.info(event, nextFields))
    },
    warn(event, nextFields = {}) {
      runLog(effectLog.warn(event, nextFields))
    },
    debug(event, nextFields = {}) {
      runLog(effectLog.debug(event, nextFields))
    },
    error(error, nextFields = {}) {
      runLog(effectLog.error(error, nextFields))
    },
  }
}

export function resolveCloudflareTracing(ctx: ExecutionContext): CloudflareTracing {
  return Option.getOrElse(Option.fromNullishOr(ctx.tracing), () => createNoopTracing())
}

function requestResponseAttributes(
  observability: RequestObservabilityShape,
  response: Response,
): Record<string, string | number | boolean> {
  return compact({
    "http.response.status_code": response.status,
    "http.response.streamed": response.body !== null,
    duration_ms: Date.now() - observability.startedAt,
    error: response.status >= 500 || undefined,
  }) as Record<string, string | number | boolean>
}

function httpServerResponseAttributes(
  response: HttpServerResponse.HttpServerResponse,
): Record<string, string | number | boolean> {
  return compact({
    "http.response.status_code": response.status,
    "http.response.streamed": response.body._tag === "Stream",
    error: response.status >= 500 || undefined,
  }) as Record<string, string | number | boolean>
}

function httpServerFailureAttributes(
  cause: Cause.Cause<unknown>,
): Record<string, string | number | boolean> {
  const error = Cause.squash(cause)
  return Match.value(error).pipe(
    Match.when(Match.instanceOf(HttpServerError.HttpServerError), (serverError) =>
      Match.value(serverError.reason).pipe(
        Match.when(Match.instanceOf(HttpServerError.RouteNotFound), () => ({
          "http.response.status_code": 404,
          "http.route.matched": false,
          status: "ok",
        })),
        Match.orElse(() => causeFailureAttributes(cause)),
      ),
    ),
    Match.orElse(() => causeFailureAttributes(cause)),
  )
}

function getErrorLogValue(error: unknown): Error {
  return normalizeError(error)
}

export function compact(fields: Record<string, unknown>) {
  return R.fromEntries(
    R.toEntries(fields).filter(([, value]) => value !== undefined && value !== null),
  )
}

interface RequestLogAnnotations {
  readonly requestId: string
  readonly requestIdSrc: RequestObservabilityShape["requestIdSrc"]
  readonly method: string
  readonly path: string
  readonly routeBranch: string
  readonly stage: string
  readonly workerName: string
  readonly "s0.local_trace_id": string
  readonly "s0.local_span_id": string
  readonly "trace.id": string
  readonly "span.id": string
  readonly cfRay?: string
  readonly traceparent?: string
  readonly tracestate?: string
  readonly userId?: string
  readonly oktaUserId?: string
}
