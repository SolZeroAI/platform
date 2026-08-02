import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import {
  boundIsolateSubagentToolInput,
  isIsolateSubagentFinalizationStep,
  resolveIsolateSubagentTurnStepLimit,
  resolveIsolateSubagentToolStepLimit,
  withIsolateSubagentFinalizationPrompt,
} from "../../packages/api/src/server/background/isolate/subagent-turn-policy"

describe("Isolate sub-agent turn policy", () => {
  it("reserves a tool-disabled final synthesis step", () => {
    expect(resolveIsolateSubagentToolStepLimit(1)).toBe(1)
    expect(resolveIsolateSubagentTurnStepLimit(1)).toBe(2)
    expect(isIsolateSubagentFinalizationStep(0, 1)).toBe(false)
    expect(isIsolateSubagentFinalizationStep(1, 1)).toBe(true)
  })

  it("caps tool work at eight rounds while retaining the final synthesis step", () => {
    expect(resolveIsolateSubagentToolStepLimit(50)).toBe(8)
    expect(resolveIsolateSubagentTurnStepLimit(50)).toBe(9)
    expect(isIsolateSubagentFinalizationStep(8, 50)).toBe(true)
  })

  it("adds explicit finalization guidance without discarding tool results", () => {
    const messages = [
      { role: "user" as const, content: "Investigate the alert" },
      { role: "tool" as const, content: [] },
    ]

    const finalizationMessages = withIsolateSubagentFinalizationPrompt(messages)

    expect(finalizationMessages.slice(0, 2)).toEqual(messages)
    expect(finalizationMessages.at(-1)).toEqual({
      role: "user",
      content: expect.stringContaining("Return the final evidence-backed findings now"),
    })
  })

  it("bounds Opsgenie list results while preserving the remaining input", () => {
    expect(
      Option.getOrUndefined(
        boundIsolateSubagentToolInput(
          "tool_mcpcf_opsgenie_broker_mcp_token_opsgenie-broker-mcp-list-alerts",
          { query: "BesuBlockNumberMismatchAlert", offset: 0, limit: 100 },
        ),
      ),
    ).toEqual({ query: "BesuBlockNumberMismatchAlert", offset: 0, limit: 25 })
    expect(
      Option.getOrUndefined(
        boundIsolateSubagentToolInput("opsgenie-broker-mcp-list-alerts", {
          query: "BesuBlockNumberMismatchAlert",
        }),
      ),
    ).toEqual({ query: "BesuBlockNumberMismatchAlert", limit: 25 })
    expect(
      Option.getOrUndefined(boundIsolateSubagentToolInput("unrelated-tool", { limit: 100 })),
    ).toBeUndefined()
  })
})
