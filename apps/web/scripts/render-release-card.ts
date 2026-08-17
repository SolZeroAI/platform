import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import {
  createReleaseCardInput,
  decodeReleaseCardInputJson,
  parseTegamiReleaseEntry,
  ReleaseCardLayoutSchema,
  type ReleaseEntry,
} from "../src/creative/index"
import { renderReleaseNotesCardToFile } from "../src/creative/node"
import {
  nextReleaseVersion,
  parseSolZeroReleaseBump,
  type ReleaseBump,
} from "../src/creative/release-version"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

class ReleaseCardCliError extends Schema.TaggedErrorClass<ReleaseCardCliError>()(
  "ReleaseCardCliError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`)
  return value
}

interface CliOptions {
  readonly inputPath?: string
  readonly layout?: string
  readonly outputPath?: string
  readonly title?: string
  readonly version?: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const [command, ...args] = argv
  if (command !== "render-release") {
    throw new Error("Usage: creative render-release [options]")
  }
  return {
    inputPath: option(args, "--input"),
    layout: option(args, "--layout"),
    outputPath: option(args, "--output"),
    title: option(args, "--title"),
    version: option(args, "--version"),
  }
}

const decodeReleaseLayout = Schema.decodeUnknownEffect(ReleaseCardLayoutSchema)

const releaseLayout = Effect.fn("releaseCard.decodeLayout")(function* (value: string | undefined) {
  if (!value) return undefined
  return yield* decodeReleaseLayout(value).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCardCliError({
          message: "--layout must be dark-columns or light-features.",
          cause,
        }),
    ),
  )
})

const pendingReleaseEntries = Effect.fn("releaseCard.pendingEntries")(function* () {
  const fs = yield* FileSystem.FileSystem
  const directory = join(REPO_ROOT, ".tegami")
  const filenames = (yield* fs.readDirectory(directory))
    .filter((filename) => filename.endsWith(".md") && filename !== "README.md")
    .sort()
  const entries: ReleaseEntry[] = []
  const bumps: ReleaseBump[] = []
  for (const filename of filenames) {
    const markdown = yield* fs.readFileString(join(directory, filename))
    const bump = parseSolZeroReleaseBump(markdown)
    if (!bump) continue
    const entry = yield* parseTegamiReleaseEntry(markdown)
    if (entry.sections.length === 0) continue
    entries.push(entry)
    bumps.push(bump)
  }
  return { entries, bumps }
})

const releaseInput = Effect.fn("releaseCard.resolveInput")(function* (options: CliOptions) {
  const fs = yield* FileSystem.FileSystem
  const layout = yield* releaseLayout(options.layout)
  if (options.inputPath) {
    const json = yield* fs.readFileString(resolve(REPO_ROOT, options.inputPath))
    const input = yield* decodeReleaseCardInputJson(json)
    return layout ? { ...input, layout } : input
  }

  const pending = yield* pendingReleaseEntries()
  const currentVersion = (yield* fs.readFileString(join(REPO_ROOT, "VERSION"))).trim()
  const version = yield* Effect.try({
    try: () => options.version ?? nextReleaseVersion(currentVersion, pending.bumps),
    catch: (cause) =>
      new ReleaseCardCliError({
        message: "The release version could not be resolved.",
        cause,
      }),
  })
  return yield* createReleaseCardInput({
    version,
    entries: pending.entries,
    layout,
    title: options.title,
  })
})

const main = Effect.fn("releaseCard.cli")(function* (argv: readonly string[]) {
  const options = yield* Effect.try({
    try: () => parseCliOptions(argv),
    catch: (cause) =>
      new ReleaseCardCliError({
        message: cause instanceof Error ? cause.message : "The command arguments are invalid.",
        cause,
      }),
  })
  const input = yield* releaseInput(options)
  const outputPath = yield* renderReleaseNotesCardToFile({
    input,
    repoRoot: REPO_ROOT,
    outputPath: options.outputPath,
  })
  yield* Console.log(outputPath)
})

await Effect.runPromise(main(process.argv.slice(2)).pipe(Effect.provide(NodeFileSystem.layer)))
