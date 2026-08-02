import { describe, expect, it } from "vitest"
import { compactAdminSearch, normalizeAdminSearch } from "./admin-console-search"

describe("admin integrations search", () => {
  it("round-trips the Skills tab and defaults to AI Providers", () => {
    const skills = normalizeAdminSearch({ tab: "skills" }, "integrations")
    expect(skills.integrationTab).toBe("skills")
    expect(compactAdminSearch(skills)).toEqual({ tab: "skills" })

    const defaults = normalizeAdminSearch({}, "integrations")
    expect(defaults.integrationTab).toBe("ai-providers")
    expect(compactAdminSearch(defaults)).toEqual({ tab: undefined })
  })
})
