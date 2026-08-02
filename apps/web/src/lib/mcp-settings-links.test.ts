import { describe, expect, it } from "vitest"
import {
  buildContextForgeTokenSettingsSearch,
  buildMcpSettingsSearchForServer,
  getMcpTokenSettingsTarget,
  getMcpTokenSettingsServerLabel,
} from "./mcp-settings-links"

describe("mcp-settings-links", () => {
  it("extracts the MCP server label from token configuration errors", () => {
    expect(
      getMcpTokenSettingsServerLabel("Configure your token for FireHydrant in MCP settings."),
    ).toBe("FireHydrant")
  })

  it("routes ContextForge API token errors to account settings", () => {
    expect(getMcpTokenSettingsTarget("Configure your ContextForge API token in Accounts.")).toEqual(
      { type: "contextforge" },
    )
    expect(
      getMcpTokenSettingsServerLabel("Configure your ContextForge API token in Accounts."),
    ).toBeNull()
  })

  it("ignores unrelated discovery errors", () => {
    expect(getMcpTokenSettingsServerLabel("MCP Context Forge MCP unavailable")).toBeNull()
  })

  it("builds MCP settings search params for a server label", () => {
    expect(buildMcpSettingsSearchForServer(" FireHydrant ")).toEqual({
      category: "agents",
      tab: "mcps",
      mcpQuery: "FireHydrant",
      mcpServerLabel: "FireHydrant",
    })
  })

  it("builds ContextForge token settings search params", () => {
    expect(buildContextForgeTokenSettingsSearch()).toEqual({
      category: "api-access",
    })
  })
})
