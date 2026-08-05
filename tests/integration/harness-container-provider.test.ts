import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import type { AgentRuntime } from "../../packages/shared/src/agent-runtime"

const compileOpenCodeConfigForModel = vi.hoisted(() => vi.fn())
const resolveRuntimeSkillPackages = vi.hoisted(() => vi.fn())

vi.mock("../../packages/api/src/server/background/provider-catalog", () => ({
  compileOpenCodeConfigForModel,
}))

vi.mock("../../packages/api/src/server/background/skills/catalog", () => ({
  resolveRuntimeSkillPackages,
}))

import { HarnessContainerProvider } from "../../packages/api/src/server/background/sandbox/providers/harness-container-provider"

type HarnessRuntime = Exclude<AgentRuntime, "isolate">

interface RecordedRequest {
  runtime: HarnessRuntime
  path: string
  body: unknown
}

function fakeEnv(requests: RecordedRequest[]) {
  const namespace = (runtime: HarnessRuntime) =>
    ({
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input))
          const body = init?.body ? JSON.parse(String(init.body)) : null
          requests.push({ runtime, path: `${url.pathname}${url.search}`, body })
          if (url.pathname === "/send") {
            return Response.json({ ok: true, cursor: 4 }, { status: 202 })
          }
          if (url.pathname === "/poll") {
            return Response.json({
              cursor: 6,
              events: [
                {
                  type: "text-delta",
                  messageId: "message-1",
                  id: "text-1",
                  text: "done",
                  timestamp: 1_000,
                },
                {
                  type: "finish",
                  messageId: "message-1",
                  success: true,
                  timestamp: 2_000,
                },
              ],
            })
          }
          return Response.json({ ok: true })
        },
      }),
    }) as unknown as DurableObjectNamespace

  return {
    OPENCODE_AGENT: namespace("opencode"),
    CODEX_AGENT: namespace("codex"),
    CLAUDE_CODE_AGENT: namespace("claude-code"),
  }
}

function modelIdForRuntime(runtime: HarnessRuntime): string {
  return runtime === "claude-code" ? "claude-sonnet-4-6" : "gpt-5.6-terra"
}

function compiledModel(runtime: HarnessRuntime) {
  const providerId = runtime === "claude-code" ? "litellm-anthropic" : "litellm"
  const modelId = modelIdForRuntime(runtime)
  const baseURL =
    providerId === "litellm-anthropic"
      ? "https://litellm.example/anthropic"
      : "https://litellm.example/v1"
  return {
    runtimeModelId: `${providerId}/${modelId}`,
    providerId,
    modelId,
    config: {
      provider: {
        [providerId]: {
          options: { apiKey: "container-proxy", baseURL },
        },
      },
    },
  }
}

function createConfig(runtime: HarnessRuntime) {
  const modelId = modelIdForRuntime(runtime)
  return {
    sessionId: "session-1",
    agentRuntime: runtime,
    sandboxId: "sandbox-1",
    sandboxAuthToken: "sandbox-token",
    controlPlaneUrl: "https://api.example",
    userId: "user-1",
    model: `${runtime === "claude-code" ? "litellm-anthropic" : "litellm"}/${modelId}`,
  }
}

describe.each<HarnessRuntime>(["opencode", "codex", "claude-code"])(
  "%s harness container provider",
  (runtime) => {
    beforeEach(() => {
      compileOpenCodeConfigForModel.mockReset()
      compileOpenCodeConfigForModel.mockResolvedValue(compiledModel(runtime))
      resolveRuntimeSkillPackages.mockReset()
      resolveRuntimeSkillPackages.mockResolvedValue([
        {
          id: "skill_s0_create_pr",
          contentHash: "skill-hash",
          name: "s0-create-pr",
          description: "Create a pull request when requested.",
          content: "Run the helper.",
          files: [],
        },
      ])
    })

    it("initializes, sends, polls from the turn cursor, and interrupts by persisted runtime", async () => {
      const requests: RecordedRequest[] = []
      const env = fakeEnv(requests)
      const provider = new HarnessContainerProvider(env as never)

      await Effect.runPromise(provider.createSandbox(createConfig(runtime)))
      const events: Array<{ type: string }> = []
      const result = await Effect.runPromise(
        provider.runPrompt(
          "session-1",
          "sandbox-1",
          {
            messageId: "message-1",
            agentRuntime: runtime,
            content: "hello",
            model: createConfig(runtime).model,
            author: { userId: "user-1", githubName: null, githubEmail: null },
          },
          async (event) => {
            events.push(event)
          },
        ),
      )

      expect(result).toEqual({ success: true, error: undefined })
      expect(events.map((event) => event.type)).toEqual(["token", "execution_complete"])
      expect(requests).toContainEqual(expect.objectContaining({ runtime, path: "/poll?cursor=4" }))
      expect(requests).toContainEqual({
        runtime,
        path: "/send",
        body: expect.objectContaining({
          messageId: "message-1",
          sessionId: "session-1",
          content: "hello",
          skills: [
            {
              id: "skill_s0_create_pr",
              contentHash: "skill-hash",
              name: "s0-create-pr",
              description: "Create a pull request when requested.",
              content: "Run the helper.",
              files: [],
            },
          ],
          model:
            runtime === "claude-code"
              ? {
                  kind: "anthropic",
                  providerId: "litellm-anthropic",
                  modelId: "claude-sonnet-4-6",
                  auth: {
                    apiKey: "container-proxy",
                    baseUrl: "https://litellm.example/anthropic",
                  },
                }
              : {
                  kind: "openai-compatible",
                  providerId: "litellm",
                  modelId: "gpt-5.6-terra",
                  auth: {
                    apiKey: "container-proxy",
                    baseUrl: "https://litellm.example/v1",
                    name: "litellm",
                    modelProviderName: "litellm",
                  },
                },
        }),
      })

      const restartedProvider = new HarnessContainerProvider(env as never)
      await Effect.runPromise(restartedProvider.stopPrompt("session-1", "sandbox-1", runtime))
      expect(requests.at(-1)).toEqual(expect.objectContaining({ runtime, path: "/interrupt" }))
    })
  },
)

describe("Cloudflare AI Gateway harness container models", () => {
  beforeEach(() => {
    compileOpenCodeConfigForModel.mockReset()
    resolveRuntimeSkillPackages.mockReset()
    resolveRuntimeSkillPackages.mockResolvedValue([])
  })

  it.each([
    {
      runtime: "opencode" as const,
      modelId: "xai/grok-4.5",
      api: "chat_completions",
      kind: "openai-compatible",
    },
    {
      runtime: "codex" as const,
      modelId: "openai/gpt-5.6-luna",
      api: "responses",
      kind: "openai-responses",
    },
    {
      runtime: "claude-code" as const,
      modelId: "anthropic/claude-opus-5",
      api: "messages",
      kind: "anthropic",
    },
  ])("passes a $api model to the $runtime container", async ({ runtime, modelId, api, kind }) => {
    const runtimeModelId = `cloudflare-ai-gateway/${modelId}`
    compileOpenCodeConfigForModel.mockResolvedValue({
      runtimeModelId,
      providerId: "cloudflare-ai-gateway",
      modelId,
      config: {
        provider: {
          "cloudflare-ai-gateway": {
            options: {
              apiKey: "container-proxy",
              baseURL: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
            },
            models: {
              [modelId]: { provider: { api } },
            },
          },
        },
      },
    })
    const requests: RecordedRequest[] = []
    const provider = new HarnessContainerProvider(fakeEnv(requests) as never)

    await Effect.runPromise(
      provider.runPrompt(
        "session-1",
        "sandbox-1",
        {
          messageId: "message-1",
          agentRuntime: runtime,
          content: "hello",
          model: runtimeModelId,
          author: { userId: "user-1", githubName: null, githubEmail: null },
        },
        async () => {},
      ),
    )

    expect(requests).toContainEqual({
      runtime,
      path: "/send",
      body: expect.objectContaining({
        model: expect.objectContaining({
          kind,
          providerId: "cloudflare-ai-gateway",
          modelId,
          auth: expect.objectContaining({ apiKey: "container-proxy" }),
        }),
      }),
    })
  })
})
