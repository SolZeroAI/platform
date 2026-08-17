import type { BumpType, ChangelogEntry } from "tegami"
import { describe, expect, it } from "vitest"
import {
  formatSolZeroReleaseNotes,
  isReleaseCardBump,
} from "../../scripts/releases/creative-release"
import { SOLZERO_PACKAGE_ID } from "../../scripts/releases/solzero-release"

function changelog(type: BumpType): ChangelogEntry {
  return {
    id: `${type}-entry.md`,
    filename: `${type}-entry.md`,
    packages: new Map([[SOLZERO_PACKAGE_ID, { type }]]),
    sections: [{ depth: 2, title: "Release update", content: "Release details." }],
    getRawContent: () => "Release details.",
  }
}

describe("creative release", () => {
  it("creates cards for minor and major releases", () => {
    expect(isReleaseCardBump("patch")).toBe(false)
    expect(isReleaseCardBump("minor")).toBe(true)
    expect(isReleaseCardBump("major")).toBe(true)
  })

  it("embeds the tag-stable card only for card releases", () => {
    expect(formatSolZeroReleaseNotes("1.5.0", [changelog("minor")])).toContain(
      "https://raw.githubusercontent.com/SolZeroHQ/solzero/v1.5.0/docs/solzero-release-notes.png",
    )
    expect(formatSolZeroReleaseNotes("1.4.5", [changelog("patch")])).not.toContain(
      "solzero-release-notes.png",
    )
  })
})
