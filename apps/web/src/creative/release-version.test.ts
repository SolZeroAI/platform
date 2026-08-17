import { describe, expect, it } from "vitest"
import { nextReleaseVersion, parseSolZeroReleaseBump } from "./release-version"

describe("release version", () => {
  it("uses the largest pending SolZero bump", () => {
    expect(nextReleaseVersion("1.4.4", ["patch", "minor"])).toBe("1.5.0")
    expect(nextReleaseVersion("1.4.4", ["major", "minor"])).toBe("2.0.0")
  })

  it("keeps the current version when no release is pending", () => {
    expect(nextReleaseVersion("1.4.4", [])).toBe("1.4.4")
  })

  it("reads the SolZero bump from Tegami frontmatter", () => {
    expect(parseSolZeroReleaseBump('packages:\n  "release:solzero": minor')).toBe("minor")
  })
})
