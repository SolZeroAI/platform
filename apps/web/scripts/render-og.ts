import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ogConcepts, type OgConceptId } from "../src/creative/og/scenes"
import { renderOgConcepts } from "../src/creative/og/node"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

class OgCliError extends Schema.TaggedError<OgCliError>()("OgCliError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)

  if (index < 0) return undefined

  const value = args[index + 1]

  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`)

  return value
}

function conceptId(value: string | undefined): OgConceptId | undefined {
  if (!value) return undefined

  const match = ogConcepts.find((concept) => concept.id === value)

  if (!match) {
    throw new Error(
      `--concept must be one of ${ogConcepts.map((concept) => concept.id).join(", ")}.`,
    )
  }

  return match.id
}

const main = Effect.fn("og.cli")(function* () {
  const args = process.argv.slice(2)

  const requested = yield* Effect.try({
    try: () => ({
      conceptId: conceptId(option(args, "--concept")),
      output: option(args, "--output"),
    }),
    catch: (cause) =>
      new OgCliError({
        message: cause instanceof Error ? cause.message : "The command arguments are invalid.",
        cause,
      }),
  })

  const outputDir = requested.output
    ? isAbsolute(requested.output)
      ? requested.output
      : resolve(REPO_ROOT, requested.output)
    : join(REPO_ROOT, "apps/web/.og-render")

  const written = yield* renderOgConcepts({
    conceptId: requested.conceptId,
    outputDir,
    repoRoot: REPO_ROOT,
  })

  for (const path of written) {
    yield* Console.log(path)
  }
})

await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer)))
