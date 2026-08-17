import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createReleaseCardInput,
  parseTegamiReleaseEntry,
  type ReleaseCardInput,
  type ReleaseCardLayout,
  type ReleaseEntry,
} from "../src/creative/index"
import { renderReleaseNotesCardToFile } from "../src/creative/node"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`)
  return value
}

function releaseLayout(value: string | undefined): ReleaseCardLayout | undefined {
  if (!value) return undefined
  if (value === "dark-columns" || value === "light-features") return value
  throw new Error("--layout must be dark-columns or light-features.")
}

async function pendingReleaseEntries() {
  const directory = join(REPO_ROOT, ".tegami")
  const filenames = (await readdir(directory)).filter(
    (filename) => filename.endsWith(".md") && filename !== "README.md",
  )
  const entries: ReleaseEntry[] = []
  for (const filename of filenames) {
    const markdown = await readFile(join(directory, filename), "utf8")
    if (!/^[\s\S]*["']?release:solzero["']?\s*:\s*(major|minor|patch)/m.test(markdown)) {
      continue
    }
    const entry = parseTegamiReleaseEntry(markdown)
    if (entry.sections.length > 0) entries.push(entry)
  }
  return entries
}

async function renderRelease(args: readonly string[]): Promise<void> {
  const inputPath = option(args, "--input")
  const version =
    option(args, "--version") ?? (await readFile(join(REPO_ROOT, "VERSION"), "utf8")).trim()
  const layout = releaseLayout(option(args, "--layout"))
  const input: ReleaseCardInput = inputPath
    ? (JSON.parse(await readFile(resolve(REPO_ROOT, inputPath), "utf8")) as ReleaseCardInput)
    : createReleaseCardInput({
        version,
        entries: await pendingReleaseEntries(),
        layout,
        title: option(args, "--title"),
      })
  const releaseInput = layout ? { ...input, layout } : input
  const outputPath = await renderReleaseNotesCardToFile({
    input: releaseInput,
    repoRoot: REPO_ROOT,
    outputPath: option(args, "--output"),
  })
  process.stdout.write(`${outputPath}\n`)
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === "render-release") {
    await renderRelease(args)
    return
  }
  throw new Error("Usage: creative render-release [options]")
}

await main()
