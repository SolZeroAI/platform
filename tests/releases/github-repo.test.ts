import { describe, expect, it } from "vitest"
import type { ChangelogEntry } from "tegami"
import { formatSolZeroReleaseNotes } from "../../scripts/releases/creative-release.ts"
import { SOLZERO_GITHUB_REPO, SOLZERO_GITHUB_URL } from "../../scripts/releases/github-repo.ts"
import { SOLZERO_PACKAGE_ID } from "../../scripts/releases/solzero-release.ts"

function releaseNote(type: "patch" | "minor"): ChangelogEntry {
  return {
    id: "platform-repository",
    filename: "2026-08-18-platform-repository.md",
    packages: new Map([[SOLZERO_PACKAGE_ID, { type }]]),
    sections: [
      {
        depth: 2,
        title: "Source and releases live at SolZeroAI/platform",
        content: "Clone the platform repository.",
      },
    ],
    getRawContent: () => "",
  }
}

describe("SolZero GitHub repository", () => {
  it("uses SolZeroAI/platform as the canonical name", () => {
    expect(SOLZERO_GITHUB_REPO).toBe("SolZeroAI/platform")
    expect(SOLZERO_GITHUB_URL).toBe("https://github.com/SolZeroAI/platform")
  })

  it("points release-card images at SolZeroAI/platform", () => {
    const notes = formatSolZeroReleaseNotes("1.5.0", [releaseNote("minor")])
    expect(notes).toContain(
      "https://raw.githubusercontent.com/SolZeroAI/platform/v1.5.0/docs/solzero-release-notes.png",
    )
    expect(notes).not.toContain("SolZeroHQ/solzero")
    expect(notes).not.toContain("SolZeroAI/solzero")
  })
})
