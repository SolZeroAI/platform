import { describe, expect, it } from "vitest"
import {
  ISOLATE_SUBAGENT_PERSISTENCE_PROMPT,
  SUBAGENT_ORCHESTRATOR_PROMPT,
} from "../../packages/api/src/server/background/isolate/subagent-prompts"

describe("Isolate sub-agent persistence prompts", () => {
  it("requires children to resolve discoverable selectors and exhaust bounded read-only paths", () => {
    expect(ISOLATE_SUBAGENT_PERSISTENCE_PROMPT).toContain("discoverable selector")
    expect(ISOLATE_SUBAGENT_PERSISTENCE_PROMPT).toContain("bounded plausible candidates")
    expect(ISOLATE_SUBAGENT_PERSISTENCE_PROMPT).toContain("attempted and failed")
  })

  it("requires parents to follow up on concrete actions returned by children", () => {
    expect(SUBAGENT_ORCHESTRATOR_PROMPT).toContain("inspect every child result")
    expect(SUBAGENT_ORCHESTRATOR_PROMPT).toContain("distinct second delegation wave")
    expect(SUBAGENT_ORCHESTRATOR_PROMPT).toContain("exact prior findings")
    expect(SUBAGENT_ORCHESTRATOR_PROMPT).toContain("discoverable selector")
    expect(SUBAGENT_ORCHESTRATOR_PROMPT).toContain("every relevant configured read-only path")
  })
})
