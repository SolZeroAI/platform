import { readFile } from "node:fs/promises"
import type { BumpType, ChangelogEntry, TegamiPlugin } from "tegami"
import {
  createReleaseCardInput,
  type ReleaseCardLayout,
  type ReleaseEntry,
} from "../../apps/web/src/creative/index.ts"
import { renderReleaseNotesCardToFile } from "../../apps/web/src/creative/node.ts"
import { SOLZERO_PACKAGE_ID, SOLZERO_VERSION_FILE } from "./solzero-release.ts"

function releaseLayout(value: string | undefined): ReleaseCardLayout {
  if (!value || value === "light-features") return "light-features"
  if (value === "dark-columns") return value
  throw new Error("S0_CREATIVE_RELEASE_LAYOUT must be dark-columns or light-features.")
}

function releaseEntries(changelogs: readonly ChangelogEntry[]): ReleaseEntry[] {
  return changelogs.map((entry) => ({
    sections: entry.sections.map((section) => ({
      title: section.title,
      content: section.content,
    })),
  }))
}

export function isReleaseCardBump(type: BumpType | undefined): boolean {
  return type === "minor" || type === "major"
}

export function formatSolZeroReleaseNotes(
  version: string,
  changelogs: readonly ChangelogEntry[],
): string {
  const sections = changelogs.flatMap((entry) =>
    entry.sections.flatMap((section) => [`### ${section.title}`, "", section.content, ""]),
  )
  const hasCard = changelogs.some((entry) =>
    isReleaseCardBump(entry.packages.get(SOLZERO_PACKAGE_ID)?.type),
  )
  const imageUrl = `https://raw.githubusercontent.com/SolZeroHQ/solzero/v${version}/docs/solzero-release-notes.png`
  const card = hasCard ? [`![SolZero v${version} release notes](${imageUrl})`, ""] : []
  return [...card, ...sections].join("\n").trim()
}

export function creativeRelease(): TegamiPlugin {
  return {
    name: "solzero-creative-release",
    enforce: "pre",
    async applyCliDraft(draft) {
      if (process.env.S0_CREATIVE_RELEASE_ASSETS !== "true") return
      const packageDraft = draft.getPackageDraft(SOLZERO_PACKAGE_ID)
      if (!packageDraft || !isReleaseCardBump(packageDraft.type)) return

      const entries = releaseEntries(packageDraft.changelogs ?? [])
      if (entries.length === 0) return

      const version = (await readFile(`${this.cwd}/${SOLZERO_VERSION_FILE}`, "utf8")).trim()
      const layout = releaseLayout(process.env.S0_CREATIVE_RELEASE_LAYOUT)
      await renderReleaseNotesCardToFile({
        repoRoot: this.cwd,
        input: createReleaseCardInput({ version, entries, layout }),
      })
    },
  }
}
