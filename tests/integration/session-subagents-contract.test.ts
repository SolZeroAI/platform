import { describe, expect, it } from "vitest"
import {
  DEFAULT_SUBAGENT_MODE,
  isSubagentMode,
  normalizeSubagentMode,
  resolveSessionSubagentMode,
  sessionSubagentModeField,
} from "../../packages/shared/src/subagents"

describe("session sub-agent contract", () => {
  it("defaults missing and invalid values to enabled", () => {
    expect(DEFAULT_SUBAGENT_MODE).toBe("enabled")
    expect(normalizeSubagentMode(undefined)).toBe("enabled")
    expect(normalizeSubagentMode("unexpected")).toBe("enabled")
  })

  it("preserves canonical modes and supports an explicit fallback", () => {
    expect(normalizeSubagentMode("enabled")).toBe("enabled")
    expect(normalizeSubagentMode("disabled")).toBe("disabled")
    expect(normalizeSubagentMode(null, "disabled")).toBe("disabled")
    expect(normalizeSubagentMode(null, "unexpected")).toBe("enabled")
    expect(isSubagentMode("enabled")).toBe(true)
    expect(isSubagentMode("disabled")).toBe(true)
    expect(isSubagentMode(true)).toBe(false)
  })

  it("pins non-isolate session kinds to disabled", () => {
    expect(resolveSessionSubagentMode("isolate", undefined)).toBe("enabled")
    expect(resolveSessionSubagentMode("isolate", "disabled")).toBe("disabled")
    expect(resolveSessionSubagentMode("isolate", undefined, "disabled")).toBe("disabled")
    expect(resolveSessionSubagentMode("sandbox", "enabled")).toBe("disabled")
    expect(resolveSessionSubagentMode(undefined, "enabled")).toBe("disabled")
  })

  it("serializes the subagents field only for isolate sessions", () => {
    expect(sessionSubagentModeField("isolate", "disabled")).toEqual({ subagents: "disabled" })
    expect(sessionSubagentModeField("isolate", undefined)).toEqual({ subagents: "enabled" })
    expect(sessionSubagentModeField("sandbox", "enabled")).toEqual({})
  })
})
