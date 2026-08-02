import { describe, expect, it } from "vitest"
import {
  getSettingsAgentTab,
  resolveAgentSettingsLocation,
  SETTINGS_AGENT_TABS,
} from "./settings-agent-tabs"

describe("agent settings tabs", () => {
  it("exposes Runtimes, Skills, and MCPs and defaults to Runtimes", () => {
    expect(SETTINGS_AGENT_TABS).toEqual([
      { value: "runtimes", label: "Runtimes" },
      { value: "skills", label: "Skills" },
      { value: "mcps", label: "MCPs" },
    ])
    expect(getSettingsAgentTab(undefined)).toBe("runtimes")
    expect(getSettingsAgentTab("skills")).toBe("skills")
  })

  it("normalizes legacy MCP categories and deep links to Agents/MCPs", () => {
    expect(
      resolveAgentSettingsLocation({
        category: "mcp",
        tab: undefined,
        hasMcpDeepLink: false,
      }),
    ).toEqual({ forceAgentsCategory: true, tab: "mcps", legacyMcpRedirect: true })
    expect(
      resolveAgentSettingsLocation({
        category: "providers",
        tab: undefined,
        hasMcpDeepLink: true,
      }),
    ).toEqual({ forceAgentsCategory: true, tab: "mcps", legacyMcpRedirect: false })
  })
})
