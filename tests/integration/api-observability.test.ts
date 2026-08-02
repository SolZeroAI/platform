import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiEnv } from "../../packages/infra/src/types/env"
import {
  createApiRequestObserver,
  createNoopTracing,
  makeRequestObservability,
  makeEffectLoggerLayer,
  observeRoute,
  requestLogAnnotations,
  redactHeaders,
  resetApiTelemetryForTests,
  withApiSurfaceSpan,
  withObservedSpan,
} from "../../packages/api/src/server/effect/services/observability"
import { makeCloudflareContext } from "../../packages/api/src/server/effect/services/cloudflare"
import {
  dispose as disposeEffectApiHandler,
  handler as effectApiHandler,
} from "../../packages/api/src/server/effect/runtime"
import { Effect, Fiber, Option, Tracer } from "effect"

const env = {
  STAGE: "test",
  WORKER_NAME: "c0-api-dev",
} as ApiEnv

interface RecordedSpan {
  name: string
  attributes: Record<string, boolean | number | string | undefined>
  ended: boolean
}

interface RecordedEffectSpanEvent {
  readonly name: string
  readonly attributes: Record<string, unknown>
}

function makeTracing(): {
  readonly tracing: NonNullable<ExecutionContext["tracing"]>
  readonly spans: RecordedSpan[]
} {
  const spans: RecordedSpan[] = []
  class TestSpan {
    readonly attributes: Record<string, boolean | number | string | undefined> = {}
    get isTraced() {
      return true
    }
    setAttribute(key: string, value?: boolean | number | string) {
      this.attributes[key] = value
    }
  }
  return {
    tracing: {
      Span: TestSpan,
      enterSpan(name, callback, ...args) {
        const span = new TestSpan()
        const record = { name, attributes: span.attributes, ended: false }
        spans.push(record)
        try {
          const result = callback(span, ...args)
          if (result instanceof Promise) {
            return result.finally(() => {
              record.ended = true
            })
          }
          record.ended = true
          return result
        } catch (error) {
          record.ended = true
          throw error
        }
      },
    },
    spans,
  }
}

function makeEffectTracer(events: RecordedEffectSpanEvent[]): Tracer.Tracer {
  let spanCount = 0
  return Tracer.make({
    span(options) {
      spanCount += 1
      const attributes = new Map<string, unknown>()
      const links = [...options.links]
      const startTime = options.startTime
      let status: Tracer.SpanStatus = { _tag: "Started", startTime }
      const parentTraceId = Option.match(options.parent, {
        onNone: () => undefined,
        onSome: (span) => span.traceId,
      })

      return {
        _tag: "Span",
        annotations: options.annotations,
        attributes,
        kind: options.kind,
        links,
        name: options.name,
        parent: options.parent,
        sampled: options.sampled,
        spanId: spanCount.toString(16).padStart(16, "0"),
        traceId: parentTraceId ?? "f".repeat(32),
        get status() {
          return status
        },
        addLinks(nextLinks) {
          links.push(...nextLinks)
        },
        attribute(key, value) {
          attributes.set(key, value)
        },
        end(endTime, exit) {
          status = { _tag: "Ended", endTime, exit, startTime }
        },
        event(name, _startTime, attributes = {}) {
          events.push({ attributes, name })
        },
      }
    },
  })
}

function makeExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: createNoopTracing(),
  }
}

const ctx: ExecutionContext = makeExecutionContext()

function makeCollectingExecutionContext(): {
  readonly ctx: ExecutionContext
  readonly spans: RecordedSpan[]
  readonly waitUntilPromises: Promise<unknown>[]
} {
  const waitUntilPromises: Promise<unknown>[] = []
  const { spans, tracing } = makeTracing()
  return {
    ctx: {
      ...makeExecutionContext(),
      tracing,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
    },
    spans,
    waitUntilPromises,
  }
}

async function drainWaitUntil(promises: readonly Promise<unknown>[]): Promise<void> {
  let drained = 0
  while (drained < promises.length) {
    const next = promises.slice(drained)
    drained = promises.length
    await Promise.all(next)
  }
}

describe("API observability", () => {
  beforeEach(() => {
    resetApiTelemetryForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await disposeEffectApiHandler()
    resetApiTelemetryForTests()
  })

  it("records request trace context without dumping request headers", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null))
    const tracingContext = makeCollectingExecutionContext()
    const devEnv = {
      ...env,
      STAGE: "dev",
    } as ApiEnv
    const request = new Request("https://api.example.test/api/auth/get-session", {
      headers: {
        cookie: "secret-cookie",
        "user-agent": "very long user agent",
      },
    })
    Object.defineProperty(request, "cf", {
      value: { colo: "ATL", country: "US", asn: 13335 },
    })
    const observer = createApiRequestObserver(request, devEnv, tracingContext.ctx)

    const response = await observer.run(async ({ log }) => {
      log.info("auth.session.test", {
        authSession: {
          userId: "user_1",
          githubLinked: false,
        },
      })
      return Response.json({ ok: true })
    })
    await drainWaitUntil(tracingContext.waitUntilPromises)

    const output = JSON.stringify(observer.context)
    expect(response.status).toBe(200)
    expect(observer.context).toMatchObject({
      method: "GET",
      path: "/api/auth/get-session",
      requestIdSrc: "generated",
      stage: "dev",
      workerName: "c0-api-dev",
    })
    expect(output).not.toContain("headers")
    expect(output).not.toContain("colo")
    expect(output).not.toContain("country")
    expect(output).not.toContain("asn")
    expect(output).not.toContain("secret-cookie")
    expect(output).not.toContain("very long user agent")
  })

  it("records c0-local correlation fields on request logs and Cloudflare spans", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const tracingContext = makeCollectingExecutionContext()
    const devEnv = {
      ...env,
      STAGE: "dev",
    } as ApiEnv
    const observer = createApiRequestObserver(
      new Request("https://api.example.test/api/auth/get-session"),
      devEnv,
      tracingContext.ctx,
    )

    await observer.run(async ({ log, observability }) => {
      return withApiSurfaceSpan(observability, "better_auth", async () => {
        log.info("auth.session.test", {
          authSession: {
            userId: "user_1",
            githubLinked: false,
          },
        })
        return Response.json({ ok: true })
      })
    })
    await drainWaitUntil(tracingContext.waitUntilPromises)

    const annotations = requestLogAnnotations(observer.context)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(annotations["c0.local_trace_id"]).toMatch(/^[a-f0-9]{32}$/)
    expect(annotations["c0.local_span_id"]).toMatch(/^[a-f0-9]{16}$/)
    expect(annotations["trace.id"]).toBe(annotations["c0.local_trace_id"])
    expect(annotations["span.id"]).toBe(annotations["c0.local_span_id"])
    expect(tracingContext.spans[0]).toMatchObject({
      name: "api.better_auth",
      attributes: expect.objectContaining({
        "api.surface": "better_auth",
        "c0.local_trace_id": annotations["c0.local_trace_id"],
        "c0.local_span_id": annotations["c0.local_span_id"],
        "trace.id": annotations["trace.id"],
        "span.id": annotations["span.id"],
      }),
    })
  })

  it("extracts request metadata and redacts sensitive headers", () => {
    const request = new Request("https://api.example.test/sessions?id=1", {
      method: "POST",
      headers: {
        "x-request-id": "req_123",
        "cf-ray": "ray_123",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        authorization: "Bearer secret",
        "x-api-key": "oiak_secret",
        "x-user-id": "user_1",
        "x-okta-user-id": "okta_user_1",
        "x-safe": "ok",
      },
    })

    expect(makeRequestObservability(request, env, "effect-http-api")).toMatchObject({
      requestId: "req_123",
      requestIdSrc: "x-request-id",
      method: "POST",
      path: "/sessions",
      hostname: "api.example.test",
      stage: "test",
      workerName: "c0-api-dev",
      logFormat: "pretty",
      consoleOutputEnabled: false,
      cfRay: "ray_123",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      routeBranch: "effect-http-api",
      userId: null,
      oktaUserId: null,
    })

    expect(redactHeaders(request.headers)).toMatchObject({
      authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "x-safe": "ok",
    })

    expect(
      makeRequestObservability(
        new Request("https://api.example.test/", { headers: { "cf-ray": "ray" } }),
        env,
      ),
    ).toMatchObject({
      requestId: "ray",
      requestIdSrc: "cf-ray",
    })
  })

  it("keeps emitted request annotations compact", () => {
    const request = new Request("https://api.example.test/sessions")
    const annotations = requestLogAnnotations(makeRequestObservability(request, env))

    expect(annotations).toMatchObject({
      method: "GET",
      path: "/sessions",
      requestIdSrc: "generated",
      stage: "test",
      workerName: "c0-api-dev",
    })
    expect(annotations["c0.local_trace_id"]).toMatch(/^[a-f0-9]{32}$/)
    expect(annotations["c0.local_span_id"]).toMatch(/^[a-f0-9]{16}$/)
    expect(annotations["trace.id"]).toBe(annotations["c0.local_trace_id"])
    expect(annotations["span.id"]).toBe(annotations["c0.local_span_id"])
    expect(annotations).not.toHaveProperty("headers")
    expect(annotations).not.toHaveProperty("requestLogs")
    expect(annotations).not.toHaveProperty("logFormat")
    expect(annotations).not.toHaveProperty("cfRay")
    expect(annotations).not.toHaveProperty("traceparent")
    expect(annotations).not.toHaveProperty("userId")
    expect(annotations).not.toHaveProperty("oktaUserId")
  })

  it("does not mirror Effect logs into span events", async () => {
    const spanEvents: RecordedEffectSpanEvent[] = []

    await Effect.runPromise(
      Effect.logInfo("workflow.state.changed").pipe(
        Effect.annotateLogs({
          event: "workflow.state.changed",
          "workflow.id": "workflow_1",
        }),
        Effect.withSpan("workflow.state.transition"),
        Effect.withTracer(makeEffectTracer(spanEvents)),
        Effect.provide(
          makeEffectLoggerLayer({ stageMetadataInput: "test", workerName: "c0-api-test" }),
        ),
      ),
    )

    expect(spanEvents).toEqual([])
  })

  it("annotates explicit Cloudflare surface spans with route branch and status", async () => {
    const tracing = makeTracing()
    const waitUntilPromises: Promise<unknown>[] = []
    const request = new Request("https://api.example.test/repos", {
      headers: { "cf-ray": "ray_456" },
    })
    const observer = createApiRequestObserver(request, env, {
      ...ctx,
      tracing: tracing.tracing,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
    })

    const response = await observer.run(
      async ({ observability, setRouteBranch, setUserIdentity }) => {
        setRouteBranch("effect-http-api")
        setUserIdentity({ userId: "user_1", oktaUserId: "okta_user_1" })
        return withApiSurfaceSpan(observability, "effect_http_api", () =>
          Promise.resolve(Response.json({ ok: true }, { status: 404 })),
        )
      },
    )
    await drainWaitUntil(waitUntilPromises)

    expect(response.status).toBe(404)
    expect(observer.context.routeBranch).toBe("effect-http-api")
    expect(observer.context.userId).toBe("user_1")
    expect(observer.context.oktaUserId).toBe("okta_user_1")
    expect(observer.context.consoleOutputEnabled).toBe(false)
    expect(tracing.spans).toEqual([
      expect.objectContaining({
        name: "api.effect_http_api",
        attributes: expect.objectContaining({
          "api.surface": "effect_http_api",
          "cf.ray": "ray_456",
          "http.request.method": "GET",
          "http.response.status_code": 404,
          "request.id": "ray_456",
          "route.branch": "effect-http-api",
          "c0.local_trace_id": observer.context.localTraceContext.traceId,
          "c0.local_span_id": observer.context.localTraceContext.spanId,
          "trace.id": observer.context.localTraceContext.traceId,
          "span.id": observer.context.localTraceContext.spanId,
          "user.id": "user_1",
          "user.okta_id": "okta_user_1",
        }),
      }),
    ])
  })

  it("falls back to no-op tracing when the runtime context does not expose Cloudflare tracing", async () => {
    const waitUntilPromises: Promise<unknown>[] = []
    const request = new Request("https://api.example.test/repos")
    const observer = createApiRequestObserver(request, env, {
      ...ctx,
      tracing: undefined,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
    })

    const response = await observer.run(async ({ observability, setRouteBranch }) => {
      setRouteBranch("effect-http-api")
      return withApiSurfaceSpan(observability, "effect_http_api", () =>
        Promise.resolve(new Response(null, { status: 204 })),
      )
    })
    await drainWaitUntil(waitUntilPromises)

    expect(response.status).toBe(204)
    expect(observer.context.routeBranch).toBe("effect-http-api")
    expect(observer.context.localTraceContext.traceId).toHaveLength(32)
  })

  it("marks failed Cloudflare surface spans without leaking secret headers", async () => {
    const tracing = makeTracing()
    const waitUntilPromises: Promise<unknown>[] = []
    const request = new Request("https://api.example.test/sessions", {
      headers: { authorization: "Bearer secret-token" },
    })
    const observer = createApiRequestObserver(request, env, {
      ...ctx,
      tracing: tracing.tracing,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise)
      }),
    })

    await expect(
      observer.run(async ({ observability }) => {
        return withApiSurfaceSpan(observability, "effect_http_api", async () => {
          throw new Error("boom")
        })
      }),
    ).rejects.toThrow("boom")
    await drainWaitUntil(waitUntilPromises)

    expect(redactHeaders(request.headers).authorization).toBe("[REDACTED]")
    expect(tracing.spans[0]).toMatchObject({
      name: "api.effect_http_api",
      attributes: expect.objectContaining({
        error: true,
        "error.name": "Error",
        "error.message": "boom",
      }),
    })
    expect(JSON.stringify(tracing.spans)).not.toContain("secret-token")
  })

  it("keeps Cloudflare route spans open without forcing Effect sampling", async () => {
    const tracingContext = makeCollectingExecutionContext()
    const devEnv = {
      ...env,
      STAGE: "dev",
      WORKER_NAME: "c0-api-route-test",
    } as ApiEnv
    const observer = createApiRequestObserver(
      new Request("https://api.example.test/api/auth/get-session"),
      devEnv,
      tracingContext.ctx,
    )
    let routeSpanEndedDuringAsyncWork: boolean | undefined

    await Effect.runPromise(
      observeRoute(
        "auth",
        "session",
        Effect.promise(async () => {
          const routeSpan = tracingContext.spans.find((span) => span.name === "http.auth.session")
          routeSpanEndedDuringAsyncWork = routeSpan?.ended
          await Promise.resolve()
          expect(routeSpan?.ended).toBe(false)
        }),
      ).pipe(
        Effect.withSpan("unsampled.parent", { sampled: false }),
        Effect.provide(makeCloudflareContext(devEnv, tracingContext.ctx, observer.observability)),
        Effect.provide(
          makeEffectLoggerLayer({
            stageMetadataInput: devEnv,
            workerName: devEnv.WORKER_NAME,
          }),
        ),
      ),
    )

    const routeSpan = tracingContext.spans.find((span) => span.name === "http.auth.session")
    expect(routeSpanEndedDuringAsyncWork).toBe(false)
    expect(routeSpan).toMatchObject({
      ended: true,
      attributes: expect.objectContaining({
        "http.route.endpoint": "session",
        "http.route.group": "auth",
        "c0.local_trace_id": observer.context.localTraceContext.traceId,
        "c0.local_span_id": observer.context.localTraceContext.spanId,
        status: "ok",
      }),
    })
  })

  it("preserves typed Effect failures through Cloudflare observed spans", async () => {
    const tracingContext = makeCollectingExecutionContext()
    const observer = createApiRequestObserver(
      new Request("https://api.example.test/test"),
      env,
      tracingContext.ctx,
    )
    const failure = new Error("typed route failure")
    const observed = withObservedSpan(
      "test.typed_failure",
      { "test.case": "typed-failure" },
      Effect.fail(failure),
    ).pipe(
      Effect.provide(makeCloudflareContext(env, tracingContext.ctx, observer.observability)),
      Effect.provide(
        makeEffectLoggerLayer({
          stageMetadataInput: env,
          workerName: env.WORKER_NAME,
        }),
      ),
    )

    await expect(Effect.runPromise(observed)).rejects.toBe(failure)

    expect(tracingContext.spans).toEqual([
      expect.objectContaining({
        ended: true,
        name: "test.typed_failure",
        attributes: expect.objectContaining({
          "error.message": "typed route failure",
          "error.name": "Error",
          error: true,
          "test.case": "typed-failure",
        }),
      }),
    ])
  })

  it("interrupts observed span child effects when the outer Effect is interrupted", async () => {
    const tracingContext = makeCollectingExecutionContext()
    const observer = createApiRequestObserver(
      new Request("https://api.example.test/test"),
      env,
      tracingContext.ctx,
    )
    let childFinalized = false
    const observed = withObservedSpan(
      "test.interrupt",
      { "test.case": "interrupt" },
      Effect.never.pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            childFinalized = true
          }),
        ),
      ),
    ).pipe(
      Effect.provide(makeCloudflareContext(env, tracingContext.ctx, observer.observability)),
      Effect.provide(
        makeEffectLoggerLayer({
          stageMetadataInput: env,
          workerName: env.WORKER_NAME,
        }),
      ),
    )

    const fiber = Effect.runFork(observed)
    await new Promise((resolve) => setTimeout(resolve, 1))
    await Effect.runPromise(Fiber.interrupt(fiber))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(childFinalized).toBe(true)
    expect(tracingContext.spans).toHaveLength(1)
    expect(tracingContext.spans[0]).toMatchObject({
      ended: true,
      name: "test.interrupt",
      attributes: expect.objectContaining({
        error: true,
        "test.case": "interrupt",
      }),
    })
  })

  it("records real Effect route handler spans through Cloudflare tracing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const tracingContext = makeCollectingExecutionContext()
    const devEnv = {
      ...env,
      APP_VERSION: "test",
      STAGE: "dev",
      WORKER_NAME: "c0-api-handler-test",
    } as ApiEnv
    const request = new Request("https://api.example.test/health")
    const observer = createApiRequestObserver(request, devEnv, tracingContext.ctx)

    const response = await observer.run(async ({ observability, setRouteBranch }) => {
      setRouteBranch("effect-http-api")
      return effectApiHandler(
        request,
        makeCloudflareContext(devEnv, tracingContext.ctx, observability),
      )
    })
    await drainWaitUntil(tracingContext.waitUntilPromises)

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tracingContext.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "api.effect_http_api",
          attributes: expect.objectContaining({
            "api.surface": "effect_http_api",
            "http.response.status_code": 200,
          }),
        }),
        expect.objectContaining({
          name: "http.health.get",
          attributes: expect.objectContaining({
            "http.route.group": "health",
            "c0.local_trace_id": observer.context.localTraceContext.traceId,
          }),
        }),
      ]),
    )
  })

  it("records Effect HTTP API route misses as a router boundary span", async () => {
    const tracingContext = makeCollectingExecutionContext()
    const devEnv = {
      ...env,
      APP_VERSION: "test",
      STAGE: "dev",
      WORKER_NAME: "c0-api-handler-test",
    } as ApiEnv
    const request = new Request("https://api.example.test/?1782430873=")
    const observer = createApiRequestObserver(request, devEnv, tracingContext.ctx)

    const response = await observer.run(async ({ observability, setRouteBranch }) => {
      setRouteBranch("effect-http-api")
      return effectApiHandler(
        request,
        makeCloudflareContext(devEnv, tracingContext.ctx, observability),
      )
    })
    await drainWaitUntil(tracingContext.waitUntilPromises)

    expect(response.status).toBe(404)
    expect(tracingContext.spans).toEqual([
      expect.objectContaining({
        name: "api.effect_http_api",
        attributes: expect.objectContaining({
          "api.surface": "effect_http_api",
          "http.response.status_code": 404,
          "url.path": "/",
        }),
      }),
    ])
  })
})
