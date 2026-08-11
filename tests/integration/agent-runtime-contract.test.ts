import { describe, expect, it } from "vitest"
import {
  describeAgentRuntimeModelCompatibility,
  isAgentRuntimeCompatibleWithProvider,
  resolveAgentRuntime,
  sessionKindForAgentRuntime,
} from "../../packages/shared/src/agent-runtime"

describe("agent runtime contract", () => {
  it("resolves legacy sandbox sessions to the OpenCode runtime", () => {
    expect(resolveAgentRuntime({ sessionKind: "sandbox" })).toBe("opencode")
    expect(resolveAgentRuntime({ sessionKind: "isolate" })).toBe("isolate")
    expect(resolveAgentRuntime({})).toBe("isolate")
  })

  it("lets explicit agentRuntime win over sessionKind", () => {
    expect(resolveAgentRuntime({ agentRuntime: "codex", sessionKind: "sandbox" })).toBe("codex")
    expect(sessionKindForAgentRuntime("claude-code")).toBe("sandbox")
    expect(sessionKindForAgentRuntime("isolate")).toBe("isolate")
  })

  it("validates LiteLLM provider compatibility by runtime", () => {
    expect(isAgentRuntimeCompatibleWithProvider("opencode", "litellm")).toBe(true)
    expect(isAgentRuntimeCompatibleWithProvider("opencode", "litellm-anthropic")).toBe(true)
    expect(isAgentRuntimeCompatibleWithProvider("codex", "litellm")).toBe(true)
    expect(isAgentRuntimeCompatibleWithProvider("codex", "litellm-anthropic")).toBe(false)
    expect(isAgentRuntimeCompatibleWithProvider("claude-code", "litellm-anthropic")).toBe(true)
    expect(isAgentRuntimeCompatibleWithProvider("claude-code", "litellm")).toBe(false)
    expect(
      isAgentRuntimeCompatibleWithProvider("opencode", "cloudflare-ai-gateway", "chat_completions"),
    ).toBe(true)
    expect(
      isAgentRuntimeCompatibleWithProvider("codex", "cloudflare-ai-gateway", "responses"),
    ).toBe(true)
    expect(
      isAgentRuntimeCompatibleWithProvider("codex", "cloudflare-ai-gateway", "chat_completions"),
    ).toBe(false)
    expect(
      isAgentRuntimeCompatibleWithProvider("claude-code", "cloudflare-ai-gateway", "responses"),
    ).toBe(false)
    expect(
      isAgentRuntimeCompatibleWithProvider("claude-code", "cloudflare-ai-gateway", "messages"),
    ).toBe(true)
    expect(isAgentRuntimeCompatibleWithProvider("isolate", "openai")).toBe(true)
  })

  it("describes runtime compatibility for API validation errors", () => {
    expect(describeAgentRuntimeModelCompatibility("codex")).toContain(
      "Cloudflare AI Gateway OpenAI Responses",
    )
    expect(describeAgentRuntimeModelCompatibility("claude-code")).toContain("Anthropic Messages")
  })
})
