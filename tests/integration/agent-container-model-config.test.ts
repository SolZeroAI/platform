import { describe, expect, it } from "vitest"
import {
  buildHarnessInstructions,
  claudeCodeProviderBaseUrl,
  harnessAdapterSettings,
  harnessSkills,
  runtimeConfigurationSignature,
} from "../../packages/agent-container/src/harness-runtime"
import type {
  HarnessRuntimeName,
  RuntimeProviderConfig,
} from "../../packages/agent-container/src/types"

interface RuntimeCase {
  runtime: HarnessRuntimeName
  model: RuntimeProviderConfig
  expectedSettings: Record<string, unknown>
}

const openAiModel: RuntimeProviderConfig = {
  kind: "openai-compatible",
  providerId: "litellm",
  modelId: "gpt-5.6-terra",
  auth: {
    apiKey: "container-proxy",
    baseUrl: "https://litellm.example/v1",
    name: "litellm",
    modelProviderName: "litellm",
  },
}

const anthropicModel: RuntimeProviderConfig = {
  kind: "anthropic",
  providerId: "litellm-anthropic",
  modelId: "claude-sonnet-4-6",
  auth: {
    apiKey: "container-proxy",
    baseUrl: "https://litellm.example/anthropic/v1",
  },
}

const cloudflareResponsesModel: RuntimeProviderConfig = {
  kind: "openai-responses",
  providerId: "cloudflare-ai-gateway",
  modelId: "openai/gpt-5.6-luna",
  auth: {
    apiKey: "container-proxy",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
    name: "cloudflare-ai-gateway",
    modelProviderName: "cloudflare-ai-gateway",
  },
}

const cloudflareChatModel: RuntimeProviderConfig = {
  kind: "openai-compatible",
  providerId: "cloudflare-ai-gateway",
  modelId: "xai/grok-4.5",
  auth: {
    apiKey: "container-proxy",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
    name: "cloudflare-ai-gateway",
    modelProviderName: "cloudflare-ai-gateway",
  },
}

const cloudflareMessagesModel: RuntimeProviderConfig = {
  kind: "anthropic",
  providerId: "cloudflare-ai-gateway",
  modelId: "anthropic/claude-opus-5",
  auth: {
    apiKey: "container-proxy",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
  },
}

const runtimeCases: RuntimeCase[] = [
  {
    runtime: "opencode",
    model: openAiModel,
    expectedSettings: {
      provider: "litellm",
      model: "gpt-5.6-terra",
      auth: {
        openaiCompatible: {
          apiKey: "container-proxy",
          baseUrl: "https://litellm.example/v1",
          name: "litellm",
        },
      },
      reasoningVariant: "high",
    },
  },
  {
    runtime: "codex",
    model: openAiModel,
    expectedSettings: {
      model: "gpt-5.6-terra",
      auth: {
        openaiCompatible: {
          apiKey: "container-proxy",
          baseUrl: "https://litellm.example/v1",
          modelProviderName: "litellm",
        },
      },
      reasoningEffort: "high",
      webSearch: true,
    },
  },
  {
    runtime: "claude-code",
    model: anthropicModel,
    expectedSettings: {
      model: "claude-sonnet-4-6",
      auth: {
        anthropic: {
          apiKey: "container-proxy",
          baseUrl: "https://litellm.example/anthropic",
        },
      },
      thinking: {
        type: "enabled",
        display: "summarized",
      },
    },
  },
  {
    runtime: "opencode",
    model: cloudflareResponsesModel,
    expectedSettings: {
      provider: "openai",
      model: "openai/openai/gpt-5.6-luna",
      auth: {
        openai: {
          apiKey: "container-proxy",
          baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
        },
      },
      reasoningVariant: "high",
    },
  },
  {
    runtime: "opencode",
    model: cloudflareChatModel,
    expectedSettings: {
      provider: "cloudflare-ai-gateway",
      model: "cloudflare-ai-gateway/xai/grok-4.5",
      auth: {
        openaiCompatible: {
          apiKey: "container-proxy",
          baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
          name: "cloudflare-ai-gateway",
        },
      },
      reasoningVariant: "high",
    },
  },
  {
    runtime: "codex",
    model: cloudflareResponsesModel,
    expectedSettings: {
      model: "openai/gpt-5.6-luna",
      auth: {
        openai: {
          apiKey: "container-proxy",
          baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
        },
      },
      reasoningEffort: "high",
      webSearch: true,
    },
  },
  {
    runtime: "claude-code",
    model: cloudflareMessagesModel,
    expectedSettings: {
      model: "anthropic/claude-opus-5",
      auth: {
        anthropic: {
          apiKey: "container-proxy",
          baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-1/ai",
        },
      },
      thinking: {
        type: "enabled",
        display: "summarized",
      },
    },
  },
]

describe("agent container model configuration", () => {
  it("adapts the AI SDK Anthropic base URL for Claude Code's /v1/messages path", () => {
    expect(claudeCodeProviderBaseUrl("https://litellm.example/anthropic/v1")).toBe(
      "https://litellm.example/anthropic",
    )
    expect(claudeCodeProviderBaseUrl("https://litellm.example/anthropic/v1/")).toBe(
      "https://litellm.example/anthropic",
    )
  })

  it.each(runtimeCases)(
    "passes the selected model and canonical instructions to the $runtime harness",
    ({ runtime, model, expectedSettings }) => {
      expect(harnessAdapterSettings(runtime, model, "high")).toEqual({
        runtime,
        settings: expectedSettings,
      })
      const instructions = buildHarnessInstructions({ runtime, model })
      expect(instructions).toContain(
        `Runtime metadata: ${JSON.stringify({
          agentRuntime: runtime,
          provider: model.providerId,
          model: model.modelId,
        })}`,
      )
      expect(instructions).toContain("real Linux container")
      expect(instructions).toContain(
        "shell commands, package managers, arbitrary command execution",
      )
      expect(instructions).toContain("native tools supplied by the selected agent harness")
      expect(instructions).not.toContain("s0-create-pr")
      expect(instructions).not.toContain("Create a pull request")
    },
  )

  it("uses adaptive thinking for Claude Opus 5 at the configured medium default", () => {
    expect(harnessAdapterSettings("claude-code", cloudflareMessagesModel, "medium")).toMatchObject({
      settings: {
        model: "anthropic/claude-opus-5",
        thinking: { type: "adaptive", display: "summarized" },
      },
    })
  })

  it.each(runtimeCases)("adds repository and MCP guidance for $runtime", ({ runtime, model }) => {
    const instructions = buildHarnessInstructions({
      runtime,
      model,
      repository: {
        owner: "example-org",
        name: "s0",
        defaultBranch: "main",
        branchName: "codex/harness-skills",
      },
      mcpServers: {
        internal: { type: "remote", url: "https://mcp.example" },
      },
    })

    expect(instructions).toContain("Use configured MCP tools directly")
    expect(instructions).toContain("delegated agents do not inherit these MCP permissions")
    expect(instructions).toContain("The attached repository is example-org/s0")
    expect(instructions).toContain("Work on codex/harness-skills")
    expect(instructions).toContain("Never push directly to main")
    expect(instructions).not.toContain("s0-create-pr")
  })

  it("converts runtime packages to HarnessV1Skill values and fingerprints content hashes", () => {
    const skill = {
      id: "skill-1",
      contentHash: "hash-1",
      name: "review-code",
      description: "Review code when requested.",
      content: "Inspect the diff.",
      files: [{ path: "references/checklist.md", content: "# Checklist" }],
    }
    expect(harnessSkills([skill])).toEqual([
      {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        files: skill.files,
      },
    ])

    const request = {
      messageId: "message-1",
      sessionId: "session-1",
      content: "review",
      model: openAiModel,
      skills: [skill],
    }
    const signature = runtimeConfigurationSignature(request)
    expect(runtimeConfigurationSignature({ ...request, content: "another prompt" })).toBe(signature)
    expect(
      runtimeConfigurationSignature({
        ...request,
        skills: [{ ...skill, contentHash: "hash-2" }],
      }),
    ).not.toBe(signature)
  })
})
