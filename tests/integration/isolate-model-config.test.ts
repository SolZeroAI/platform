import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY } from "../../packages/api/src/server/background/provider-catalog"
import { compileIsolateModelContext } from "../../packages/api/src/server/background/isolate/model"
import { createLitellmDeploymentEnv } from "./litellm-env-fixture"

type MinimalStreamModel = {
  doStream(options: {
    prompt: Array<{
      role: "user"
      content: Array<{ type: "text"; text: string }>
    }>
  }): PromiseLike<unknown>
}

function toRequest(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  return input instanceof Request ? input : new Request(input, init)
}

function eventStreamResponse() {
  return new Response("data: [DONE]\n\n", {
    headers: {
      "content-type": "text/event-stream",
    },
  })
}

describe("isolate model config", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses direct shared provider credentials for Worker-side isolate model calls", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        eventStreamResponse(),
    )
    vi.stubGlobal("fetch", fetchMock)

    const context = await Effect.runPromise(
      compileIsolateModelContext({
        env: {
          STAGE: "dev",
          ...createLitellmDeploymentEnv(),
        } as never,
        userId: "user-1",
        model: "litellm/gpt-5.4-mini",
      }),
    )

    await (context.model as MinimalStreamModel).doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    })

    expect(fetchMock).toHaveBeenCalled()
    const [input, init] = fetchMock.mock.calls[0]!
    const request = toRequest(input, init)
    expect(request.headers.get("authorization")).toBe("Bearer real-shared-litellm-key")
    expect(request.headers.get("authorization")).not.toBe(
      `Bearer ${OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY}`,
    )
  })
})
