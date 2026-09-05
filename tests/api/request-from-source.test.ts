import { describe, expect, it } from "vitest"
import { Headers, HttpServerRequest } from "effect/unstable/http"
import { requestFromSource } from "../../packages/api/src/server/effect/services/auth"
import * as controlPlane from "../../packages/api/src/server/effect/handlers/shared/control-plane"

function serverRequest(input: {
  source: object
  url?: string
  method?: string
  headers?: Record<string, string>
}): HttpServerRequest.HttpServerRequest {
  // SAFETY: fixture supplies only the fields requestFromSource reads.
  return {
    source: input.source,
    url: input.url ?? "https://api.example.test/sessions",
    method: input.method ?? "GET",
    headers: Headers.fromInput(input.headers ?? {}),
  } as HttpServerRequest.HttpServerRequest
}

describe("requestFromSource", () => {
  it("returns the original Request when source is already a Request", () => {
    const source = new Request("https://api.example.test/sessions", {
      method: "POST",
      headers: { authorization: "Bearer session-token", "x-request-id": "req-1" },
    })
    const rebuilt = requestFromSource(serverRequest({ source }))
    expect(rebuilt).toBe(source)
    expect(rebuilt.headers.get("authorization")).toBe("Bearer session-token")
    expect(rebuilt.headers.get("x-request-id")).toBe("req-1")
  })

  it("rebuilds a Request with the incoming headers when source is not a Request", () => {
    const rebuilt = requestFromSource(
      serverRequest({
        source: {},
        method: "DELETE",
        headers: {
          authorization: "ApiKey oiak_test",
          cookie: "better-auth.session=abc",
          "x-api-key": "oiak_test",
        },
      }),
    )
    expect(rebuilt).toBeInstanceOf(Request)
    expect(rebuilt.method).toBe("DELETE")
    expect(rebuilt.headers.get("authorization")).toBe("ApiKey oiak_test")
    expect(rebuilt.headers.get("cookie")).toBe("better-auth.session=abc")
    expect(rebuilt.headers.get("x-api-key")).toBe("oiak_test")
  })

  it("is the helper used by control-plane handlers", () => {
    expect(controlPlane.requestFromSource).toBe(requestFromSource)
  })
})
