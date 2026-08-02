import { describe, expect, it } from "vitest"
import { buildIsolateSkillSources } from "../../src/server/background/isolate/skills"
import type { IsolateSubagentRunInput } from "../../src/server/background/isolate/subagent"
import { trustedConfigFromRunInput } from "../../src/server/background/isolate/agent/subagent-trusted-config"

describe("Isolate sub-agent trusted configuration", () => {
  it("preserves runtime-owned model, tools, MCP, step, and skill-resolution inputs", () => {
    const input: IsolateSubagentRunInput = {
      delegation: {
        task: "Inspect the alert workflow",
        context: "Only inspect the workflow package",
      },
      parentSessionId: "session-1",
      userId: "user with spaces",
      repoOwner: "Consensys",
      repoName: "ai",
      model: "test/provider-model",
      reasoningEffort: "high",
      stepLimit: 8,
      selectedTools: [
        { kind: "workflow_builder" },
        { kind: "github_repo", repoOwner: "Consensys", repoName: "ai" },
      ],
      customMcpServers: {
        observability: {
          type: "remote",
          url: "https://mcp.invalid/example",
          headers: { Authorization: "test-only-header-value" },
        },
      },
    }

    const trusted = trustedConfigFromRunInput(input)

    expect(trusted).toEqual({
      parentSessionId: input.parentSessionId,
      userId: input.userId,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      stepLimit: input.stepLimit,
      selectedTools: input.selectedTools,
      customMcpServers: input.customMcpServers,
    })
    expect(trusted).not.toHaveProperty("delegation")

    const inheritedSkillSources = buildIsolateSkillSources({
      tools: trusted.selectedTools,
      skillsBucket: {} as R2Bucket,
      userId: trusted.userId,
      globalSkillNames: ["global-operations"],
    })
    expect(inheritedSkillSources).toHaveLength(3)
    expect(
      buildIsolateSkillSources({
        tools: [],
        userId: "",
        globalSkillNames: [],
      }),
    ).toEqual([])
  })
})
