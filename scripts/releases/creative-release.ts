import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import type { BumpType, ChangelogEntry, Draft, TegamiPlugin } from "tegami"
import {
  createReleaseCardInput,
  ReleaseCardLayoutSchema,
  type ReleaseEntry,
} from "../../apps/web/src/creative/index.ts"
import { renderReleaseNotesCardToFile } from "../../apps/web/src/creative/node.ts"
import { SOLZERO_PACKAGE_ID, SOLZERO_VERSION_FILE } from "./solzero-release.ts"

const releaseAssetsEnabled = Config.boolean("S0_CREATIVE_RELEASE_ASSETS").pipe(
  Config.withDefault(false),
)

const decodeReleaseLayout = Schema.decodeUnknownEffect(ReleaseCardLayoutSchema)

const releaseLayout = Config.string("S0_CREATIVE_RELEASE_LAYOUT").pipe(
  Config.withDefault("light-features"),
  Effect.flatMap(decodeReleaseLayout),
)

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

const applyCreativeDraft = Effect.fn("releaseCard.applyTegamiDraft")(function* (
  draft: Draft,
  cwd: string,
) {
  if (!(yield* releaseAssetsEnabled)) return
  const packageDraft = draft.getPackageDraft(SOLZERO_PACKAGE_ID)
  if (!packageDraft || !isReleaseCardBump(packageDraft.type)) return

  const entries = releaseEntries(packageDraft.changelogs ?? [])
  if (entries.length === 0) return

  const fs = yield* FileSystem.FileSystem
  const version = (yield* fs.readFileString(`${cwd}/${SOLZERO_VERSION_FILE}`)).trim()
  const layout = yield* releaseLayout
  const input = yield* createReleaseCardInput({ version, entries, layout })
  yield* renderReleaseNotesCardToFile({ repoRoot: cwd, input })
})

export function creativeRelease(): TegamiPlugin {
  return {
    name: "solzero-creative-release",
    enforce: "pre",
    applyCliDraft(draft) {
      return Effect.runPromise(
        applyCreativeDraft(draft, this.cwd).pipe(Effect.provide(NodeFileSystem.layer)),
      )
    },
  }
}
