/* oxlint-disable effect/avoid-process-env, s0-lint/avoid-untagged-errors -- CLI boundary reads operator arguments directly. */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import dotenv from "dotenv"
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser"
import { format } from "oxfmt"
import * as JsonSchema from "effect/JsonSchema"
import * as Schema from "effect/Schema"
import {
  getStageMetadataFromConfigSync,
  S0_CONFIG_STAGE_NAMES,
  S0ConfigFileSchema,
  s0ActiveSecretReferences,
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

function dotenvQuote(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"')}"`
}

function writeStageVars(stage: string, outputPath: string): void {
  const config = resolveS0Config(readConfigFile(stage))
  const resolvedOutputPath = resolve(repoRoot, outputPath)
  const existing = existsSync(resolvedOutputPath)
    ? dotenv.parse(readFileSync(resolvedOutputPath))
    : {}
  const names = [
    ...new Set(s0ActiveSecretReferences(config).map((reference) => reference.env)),
  ].sort()
  const contents = names
    .map((name) => `${name}=${dotenvQuote(process.env[name] ?? existing[name] ?? "")}`)
    .join("\n")
  writeFileSync(resolvedOutputPath, `${contents}\n`, { mode: 0o600 })
  process.stdout.write(`Wrote ${names.length} secret references to ${outputPath}\n`)
}

function printStageWebUrl(stage: string): void {
  const config = resolveS0Config(readConfigFile(stage))
  const metadata = getStageMetadataFromConfigSync(stage, config.deployment, config.application)
  process.stdout.write(`${metadata.infra.authBaseUrl}\n`)
}

const args = process.argv.slice(2).filter((argument) => argument !== "--")
const [command, second, third] = args
if (command === "check" && args.length === 1) {
  await checkConfig()
} else if (command === "check" && second === "--profile" && third && args.length === 3) {
  await checkConfig(third)
} else if (command === "schema" && args.length === 1) {
  await writeSchema()
} else if (command === "write-stage-vars" && second && third && args.length === 3) {
  writeStageVars(second, third)
} else if (command === "stage-url" && second && args.length === 2) {
  printStageWebUrl(second)
} else {
  throw new Error(
    "Usage: s0-config.ts check [--profile <name>] | schema | write-stage-vars <stage> <output-path> | stage-url <stage>",
  )
}
