import { readFile, writeFile } from "node:fs/promises"
import {
  auditWorkflowManifestRuntimeCompatibility,
  type WorkflowManifestAuditResult,
} from "../../packages/api/src/server/background/workflows/manifest-migrations"
import { normalizeWorkflowManifest } from "../../packages/api/src/server/background/workflows/manifest"

interface AuditOutput {
  path: string
  valid: boolean
  fromVersion: number
  toVersion: number
  steps: WorkflowManifestAuditResult["steps"]
  findings: WorkflowManifestAuditResult["findings"]
  wrote: boolean
}

function usage(): never {
  throw new Error(
    "Usage: nub run workflow:runtime:audit [--write] <manifest-or-export-json> [...more files]",
  )
}

function parseArgs(argv: string[]): { write: boolean; paths: string[] } {
  let write = false
  const paths: string[] = []
  for (const arg of argv) {
    if (arg === "--write") {
      write = true
      continue
    }
    if (arg.startsWith("-")) {
      usage()
    }
    paths.push(arg)
  }
  if (paths.length === 0) {
    usage()
  }
  return { write, paths }
}

function readManifestDocument(parsed: unknown): {
  manifest: unknown
  writeBack(value: unknown): unknown
} {
  if (parsed && typeof parsed === "object" && "manifest" in parsed) {
    return {
      manifest: (parsed as { manifest: unknown }).manifest,
      writeBack(value) {
        return { ...(parsed as Record<string, unknown>), manifest: value }
      },
    }
  }
  return {
    manifest: parsed,
    writeBack(value) {
      return value
    },
  }
}

async function auditPath(path: string, write: boolean): Promise<AuditOutput> {
  const source = await readFile(path, "utf8")
  const parsed = JSON.parse(source) as unknown
  const document = readManifestDocument(parsed)
  const result = auditWorkflowManifestRuntimeCompatibility({
    manifest: document.manifest,
    name: path,
    normalizeManifest: normalizeWorkflowManifest,
  })
  let wrote = false
  if (write && result.valid) {
    await writeFile(
      path,
      `${JSON.stringify(document.writeBack(result.manifest), null, 2)}\n`,
      "utf8",
    )
    wrote = true
  }
  return {
    path,
    valid: result.valid,
    fromVersion: result.fromVersion,
    toVersion: result.toVersion,
    steps: result.steps,
    findings: result.findings,
    wrote,
  }
}

async function main() {
  const { write, paths } = parseArgs(process.argv.slice(2))
  const results = await Promise.all(paths.map((path) => auditPath(path, write)))
  console.log(JSON.stringify({ write, results }, null, 2))
  if (results.some((result) => !result.valid)) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
