import { readFile } from "node:fs/promises"
import type { Draft, TegamiPlugin } from "tegami"
import {
  createReleaseCardInput,
  type ReleaseCardLayout,
  type ReleaseEntry,
} from "../../packages/creative/src/index.ts"
import { renderReleaseNotesCardToFile } from "../../packages/creative/src/node.ts"
import { SOLZERO_PACKAGE_ID, SOLZERO_VERSION_FILE } from "./solzero-release.ts"

function releaseLayout(value: string | undefined): ReleaseCardLayout {
  if (!value || value === "light-features") return "light-features"
  if (value === "dark-columns") return value
  throw new Error("S0_CREATIVE_RELEASE_LAYOUT must be dark-columns or light-features.")
}

function draftEntries(draft: Draft): ReleaseEntry[] {
  const packageDraft = draft.getPackageDraft(SOLZERO_PACKAGE_ID)
  return (packageDraft?.changelogs ?? []).map((entry) => ({
    sections: entry.sections.map((section) => ({
      title: section.title,
      content: section.content,
    })),
  }))
}

export function creativeRelease(): TegamiPlugin {
  return {
    name: "solzero-creative-release",
    enforce: "pre",
    async applyCliDraft(draft) {
      if (process.env.S0_CREATIVE_RELEASE_ASSETS !== "true") return
      const entries = draftEntries(draft)
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
