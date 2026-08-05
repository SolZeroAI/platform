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
    providerOptions?: Record<string, unknown>
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
      providerOptions: context.providerOptions,
    })

    expect(fetchMock).toHaveBeenCalled()
    const [input, init] = fetchMock.mock.calls[0]!
    const request = toRequest(input, init)
    expect(request.headers.get("authorization")).toBe("Bearer real-shared-litellm-key")
    expect(request.headers.get("authorization")).not.toBe(
      `Bearer ${OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY}`,
    )
  })

  it("uses the deployment-managed AI Gateway binding for a Responses API model", async () => {
    const run = vi.fn(async () => eventStreamResponse())
    const context = await Effect.runPromise(
      compileIsolateModelContext({
        env: {
          STAGE: "dev",
          S0_CONFIG: { get: async () => null },
          S0_CONFIG_CLOUDFLARE_AI_GATEWAY: {
            enabled: true,
            cacheTtl: null,
            collectLogs: true,
            defaultModel: "openai/gpt-5.6-luna",
            models: {
              "openai/gpt-5.6-luna": {
                name: "GPT 5.6 Luna",
                provider: { npm: "@ai-sdk/openai", api: "responses" },
                reasoning: {
                  efforts: ["low", "medium", "high"],
                  default: "medium",
                },
              },
            },
          },
          AI_GATEWAY: { run },
          AI_GATEWAY_ID: "s0-dev-ai-gateway",
          CLOUDFLARE_ACCOUNT_ID: "account-1",
        } as never,
        userId: "user-1",
        model: "cloudflare-ai-gateway/openai/gpt-5.6-luna",
        reasoningEffort: "medium",
      }),
    )

    expect(context.model.modelId).toBe("openai/gpt-5.6-luna")
    expect(context.model.provider).toBe("cloudflare-ai-gateway.responses")
    expect(context.providerOptions).toEqual({
      "cloudflare-ai-gateway": { reasoningEffort: "medium" },
    })

    await (context.model as MinimalStreamModel).doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
      providerOptions: context.providerOptions,
    })
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-luna",
      expect.objectContaining({ input: expect.any(Array) }),
      expect.objectContaining({
        gateway: { id: "s0-dev-ai-gateway" },
        returnRawResponse: true,
      }),
    )
  })

  it("uses the gateway binding and chat-completions wire format for Grok", async () => {
    const run = vi.fn(async () => eventStreamResponse())
    const context = await Effect.runPromise(
      compileIsolateModelContext({
        env: {
          STAGE: "dev",
          S0_CONFIG: { get: async () => null },
          S0_CONFIG_CLOUDFLARE_AI_GATEWAY: {
            enabled: true,
            cacheTtl: null,
            collectLogs: true,
            defaultModel: "xai/grok-4.5",
            models: {
              "xai/grok-4.5": {
                name: "Grok 4.5",
                provider: { npm: "@ai-sdk/openai-compatible", api: "chat_completions" },
                reasoning: {
                  efforts: ["low", "medium", "high"],
                  default: "medium",
                },
              },
            },
          },
          AI_GATEWAY: { run },
          AI_GATEWAY_ID: "s0-dev-ai-gateway",
          CLOUDFLARE_ACCOUNT_ID: "account-1",
        } as never,
        userId: "user-1",
        model: "cloudflare-ai-gateway/xai/grok-4.5",
        reasoningEffort: "high",
      }),
    )

    expect(context.model.provider).toBe("cloudflare-ai-gateway.chat")
    expect(context.providerOptions).toEqual({
      "cloudflare-ai-gateway": { reasoningEffort: "high" },
    })

    await (context.model as MinimalStreamModel).doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
      providerOptions: context.providerOptions,
    })
    expect(run).toHaveBeenCalledWith(
      "xai/grok-4.5",
      expect.objectContaining({
        messages: expect.any(Array),
        reasoning_effort: "high",
      }),
      expect.objectContaining({
        gateway: { id: "s0-dev-ai-gateway" },
        returnRawResponse: true,
      }),
    )
  })
})
