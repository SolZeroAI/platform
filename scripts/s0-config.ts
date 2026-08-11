/* oxlint-disable effect/avoid-process-env, s0-lint/avoid-untagged-errors -- CLI boundary reads operator arguments directly. */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser"
import { format } from "oxfmt"
import * as JsonSchema from "effect/JsonSchema"
import * as Schema from "effect/Schema"
import {
  S0_CONFIG_STAGE_NAMES,
  S0ConfigFileSchema,
  s0ConfigPathForStage,
  resolveS0Config,
} from "@solzero/shared"

const repoRoot = process.cwd()
const exampleConfigPath = resolve(repoRoot, "config/example.config.jsonc")
const schemaPath = resolve(repoRoot, "config/s0.config.schema.json")

function readConfigPath(configPath: string): unknown {
  if (!existsSync(configPath)) {
    throw new Error(`Missing s0 configuration file: ${configPath}`)
  }
  const errors: ParseError[] = []
  const parsed = parse(readFileSync(configPath, "utf8"), errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ")
    throw new Error(`Invalid JSONC in ${configPath}: ${details}`)
  }
  return parsed
}

function readConfigFile(stage: string, profile?: string): unknown {
  return readConfigPath(resolve(repoRoot, s0ConfigPathForStage(stage, profile)))
}

async function generatedSchema(): Promise<string> {
  const document = Schema.toJsonSchemaDocument(S0ConfigFileSchema)
  const schema = {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
  }
  const result = await format(schemaPath, JSON.stringify(schema))
  if (result.errors.length > 0) {
    throw new Error(`Unable to format ${schemaPath}: ${result.errors[0]?.message}`)
  }
  return result.code
}

async function checkConfig(profile?: string): Promise<void> {
  resolveS0Config(readConfigPath(exampleConfigPath))
  const stages = profile ? (["dev", "pre", "prod"] as const) : S0_CONFIG_STAGE_NAMES
  for (const stage of stages) {
    resolveS0Config(readConfigFile(stage, profile))
  }
  if (readFileSync(schemaPath, "utf8") !== (await generatedSchema())) {
    throw new Error("config/s0.config.schema.json is stale. Run `nub run config:schema`.")
  }
  const configPaths = stages.map((stage) => s0ConfigPathForStage(stage, profile))
  process.stdout.write(
    `Validated s0 config files: config/example.config.jsonc, ${configPaths.join(", ")}\n`,
  )
}

async function writeSchema(): Promise<void> {
  writeFileSync(schemaPath, await generatedSchema())
  process.stdout.write("Updated config/s0.config.schema.json\n")
}

const args = process.argv.slice(2).filter((argument) => argument !== "--")
const [command, profileFlag, profile] = args
if (command === "check" && args.length === 1) {
  await checkConfig()
} else if (command === "check" && profileFlag === "--profile" && profile && args.length === 3) {
  await checkConfig(profile)
} else if (command === "schema" && args.length === 1) {
  await writeSchema()
} else {
  throw new Error("Usage: s0-config.ts check [--profile <name>] | schema")
}
