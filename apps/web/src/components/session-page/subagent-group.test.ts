import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { SubagentRunView } from "@/lib/subagent-events"
import { SubagentGroup } from "./subagent-group"

describe("SubagentGroup", () => {
  it("renders the durable run details inside an accessible disclosure", () => {
    const run: SubagentRunView = {
      runId: "run-1",
      parentToolCallId: "parent-tool-1",
      agentType: "IsolateSubAgent",
      displayName: "API investigator",
      order: 0,
      task: "Inspect the API boundary",
      model: "openai/gpt-5",
      status: "completed",
      startedAt: 100,
      completedAt: 105,
      durationMs: 5000,
      toolCallCount: 1,
      toolNames: ["Read"],
      text: "I inspected the handler.",
      reasoning: "Tracing the call chain.",
      summary: "The boundary is typed.",
      progress: { fraction: 1, message: "Complete", at: 105_000 },
      milestones: [{ name: "inspection-complete", sequence: 1, at: 105_000 }],
      toolEvents: [
        {
          type: "tool_call",
          tool: "Read",
          args: { filePath: "src/api.ts" },
          callId: "run-1:call-1",
          messageId: "prompt-1",
          sandboxId: "isolate-1",
          timestamp: 102,
          output: "42 lines",
          success: true,
        },
      ],
    }

    const markup = renderToString(
      createElement(SubagentGroup, {
        runs: [run],
        groupId: "subagent-group-1",
      }),
    )

    expect(markup).toContain("Sub-agents")
    expect(markup).toContain("API investigator")
    expect(markup).toContain("Inspect the API boundary")
    expect(markup).toContain("openai/gpt-5")
    expect(markup).toContain("inspection-complete")
    expect(markup).toContain("Tracing the call chain.")
    expect(markup).toContain("I inspected the handler.")
    expect(markup).toContain("The boundary is typed.")
    expect(markup).toContain("Read")
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="100"')
  })
})
