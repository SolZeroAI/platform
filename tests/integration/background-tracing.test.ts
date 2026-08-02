import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  aiTelemetrySettings,
  BackgroundTracing,
  localSpanContextFromHeaders,
  localSpanHeaders,
  makeBackgroundTracingLayer,
} from "../../packages/api/src/server/background/observability/tracing"
import { buildInternalRequest } from "../../packages/api/src/server/effect/handlers/shared/control-plane"

interface RecordedSpan {
  name: string
  attributes: Record<string, boolean | number | string | undefined>
  ended: boolean
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe("background tracing", () => {
  it("records nested Cloudflare spans with c0-local correlation ids", async () => {
    const { spans, tracing } = makeTracing()
    const seenContexts: Array<{ traceId: string; spanId: string }> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const backgroundTracing = yield* BackgroundTracing
        yield* backgroundTracing.withSpan(
          "session.prompt.isolate",
          {
            "session.id": "session-1",
            "message.content_length": 12,
          },
          Effect.gen(function* () {
            const parentContext = yield* backgroundTracing.currentContext
            const resolvedParent = Option.getOrThrow(parentContext)
            expect(resolvedParent.traceId).toMatch(/^[a-f0-9]{32}$/)
            seenContexts.push(resolvedParent)

            yield* backgroundTracing.withSpan(
              "isolate.think.chat",
              {
                "ai.model": "litellm/gpt-5.4-mini",
                prompt: undefined,
              },
              Effect.gen(function* () {
                const childTracing = yield* BackgroundTracing
                const childContext = yield* childTracing.currentContext
                const resolvedChild = Option.getOrThrow(childContext)
                expect(resolvedChild.traceId).toBe(resolvedParent.traceId)
                expect(resolvedChild.spanId).not.toBe(resolvedParent.spanId)
                seenContexts.push(resolvedChild)
                return "ok"
              }),
            )
          }),
        )
      }).pipe(Effect.provide(makeBackgroundTracingLayer({ tracing }))),
    )

    expect(spans.map((span) => span.name)).toEqual(["session.prompt.isolate", "isolate.think.chat"])
    expect(spans.every((span) => span.ended)).toBe(true)
    expect(spans[0].attributes.status).toBe("ok")
    expect(spans[1].attributes["ai.model"]).toBe("litellm/gpt-5.4-mini")
    expect(spans[0].attributes["c0.local_trace_id"]).toBe(seenContexts[0].traceId)
    expect(spans[0].attributes["c0.local_span_id"]).toBe(seenContexts[0].spanId)
    expect(spans[0].attributes["trace.id"]).toBe(seenContexts[0].traceId)
    expect(spans[0].attributes["span.id"]).toBe(seenContexts[0].spanId)
    expect(spans[1].attributes["c0.local_trace_id"]).toBe(seenContexts[0].traceId)
    expect(spans[1].attributes["c0.local_span_id"]).toBe(seenContexts[1].spanId)
    expect(spans[1].attributes["trace.id"]).toBe(seenContexts[0].traceId)
    expect(spans[1].attributes["span.id"]).toBe(seenContexts[1].spanId)
  })

  it("disables AI SDK prompt and output recording", () => {
    expect(aiTelemetrySettings("isolate.think.turn", { "ai.model": "model-1" })).toMatchObject({
      functionId: "isolate.think.turn",
      isEnabled: true,
      metadata: { "ai.model": "model-1" },
      includeRuntimeContext: { "ai.model": true },
      recordInputs: false,
      recordOutputs: false,
    })
  })

  it("round-trips local span headers", () => {
    const context = {
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    }

    expect(localSpanContextFromHeaders(new Headers(localSpanHeaders(context)))).toEqual(context)
    expect(
      localSpanContextFromHeaders(
        new Headers({
          "x-c0-local-parent-span-id": "not-a-span",
          "x-c0-local-trace-id": context.traceId,
        }),
      ),
    ).toBeUndefined()
  })

  it("propagates the active local span through internal requests", () => {
    const context = {
      traceId: "c".repeat(32),
      spanId: "d".repeat(16),
    }
    const request = buildInternalRequest(
      "http://internal/internal/prompt-async",
      {
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      context,
    )

    expect(request.headers.get("content-type")).toBe("application/json")
    expect(localSpanContextFromHeaders(request.headers)).toEqual({
      traceId: "c".repeat(32),
      spanId: "d".repeat(16),
    })
  })
})
