import { describe, expect, it } from "vitest"
import { isAdminEmail, normalizeAdminConfig } from "../../packages/shared/src/admin"

describe("admin config", () => {
  it("normalizes admin domains without changing internal periods", () => {
    const internalPeriods = ".".repeat(10_000)
    const config = normalizeAdminConfig({
      adminDomains: ["@@Example.COM...", `${internalPeriods}Internal.Example.COM`],
    })

    expect(config.adminDomains).toEqual([`${internalPeriods}internal.example.com`, "example.com"])
    expect(isAdminEmail("admin@example.com", config)).toBe(true)
  })
})
