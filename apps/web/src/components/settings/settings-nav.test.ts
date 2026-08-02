import { describe, expect, it } from "vitest"
import { getSettingsCategoryFromSearch, SETTINGS_NAV_ITEMS } from "./settings-nav"

describe("settings navigation", () => {
  it("nests MCP configuration under Agents", () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.id)).not.toContain("mcp")
    expect(getSettingsCategoryFromSearch({ mcpServerId: "server-1" })).toBe("agents")
  })
})
