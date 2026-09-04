import {
  APP_DB_MODE_ENV,
  DATABASE_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
} from "@solzero/shared"

export const CUTOVER_JSONC_COMMENT_LINES = [
  "// One-shot D1 to PlanetScale convenience copy. This is not an online or zero-downtime migration.",
  "// Writes can still land on D1 during the copy window. Production stays on D1 until you deploy.",
  "// After copy succeeds, set process env DATABASE=planetscale (alchemy.new contract; missing/empty = d1).",
  "// For remote PlanetScale also set PLANETSCALE_SERVICE_TOKEN_ID, PLANETSCALE_SERVICE_TOKEN, and PLANETSCALE_ORGANIZATION.",
  "// Do not add a second engine field to this file. Deploy yourself after the copy.",
] as const

const ENV_ASSIGNMENTS = [
  `${DATABASE_ENV}=planetscale`,
  `${APP_DB_MODE_ENV}=remote`,
  `${PLANETSCALE_SERVICE_TOKEN_ID_ENV}=`,
  `${PLANETSCALE_SERVICE_TOKEN_ENV}=`,
  `${PLANETSCALE_ORGANIZATION_ENV}=`,
] as const

export interface CutoverEdits {
  readonly jsoncPath: string
  readonly envPath: string
  readonly nextJsonc: string
  readonly nextEnv: string
  readonly jsoncDiff: string
  readonly envDiff: string
}

export function planPlanetscaleCutoverEdits(input: {
  jsonc: string
  envFile: string
  jsoncPath: string
  envPath: string
}): CutoverEdits {
  const nextJsonc = applyJsoncCutoverComments(input.jsonc)
  const nextEnv = applyPlanetscaleEnvAssignments(input.envFile)
  return {
    jsoncPath: input.jsoncPath,
    envPath: input.envPath,
    nextJsonc,
    nextEnv,
    jsoncDiff: unifiedDiff(input.jsoncPath, input.jsonc, nextJsonc),
    envDiff: unifiedDiff(input.envPath, input.envFile, nextEnv),
  }
}

export function applyJsoncCutoverComments(jsonc: string): string {
  const alreadyAnnotated = CUTOVER_JSONC_COMMENT_LINES.every((line) => jsonc.includes(line))
  if (alreadyAnnotated) return jsonc.endsWith("\n") ? jsonc : `${jsonc}\n`
  const prefix = `${CUTOVER_JSONC_COMMENT_LINES.join("\n")}\n`
  const body = jsonc.startsWith("\uFEFF") ? jsonc.slice(1) : jsonc
  return `${prefix}${body.endsWith("\n") ? body : `${body}\n`}`
}

export function applyPlanetscaleEnvAssignments(envFile: string): string {
  const lines = envFile.length === 0 ? [] : envFile.split("\n")
  const withoutTrailingEmpty =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  const next = [...withoutTrailingEmpty]
  for (const assignment of ENV_ASSIGNMENTS) {
    const key = assignment.slice(0, assignment.indexOf("="))
    const value = assignment.slice(assignment.indexOf("=") + 1)
    const index = next.findIndex((line) => envLineKey(line) === key)
    if (index === -1) {
      next.push(assignment)
      continue
    }
    if (value === "" && envLineValue(next[index] ?? "") !== "") continue
    next[index] = assignment
  }
  return `${next.join("\n")}\n`
}

export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) {
    return `--- ${path}\n+++ ${path}\n`
  }
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1
  }
  let oldSuffix = oldLines.length
  let newSuffix = newLines.length
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldLines[oldSuffix - 1] === newLines[newSuffix - 1]
  ) {
    oldSuffix -= 1
    newSuffix -= 1
  }
  const oldCount = Math.max(oldSuffix - prefix, 0)
  const newCount = Math.max(newSuffix - prefix, 0)
  const hunk: string[] = [
    `--- ${path}`,
    `+++ ${path}`,
    `@@ -${prefix + 1},${oldCount} +${prefix + 1},${newCount} @@`,
  ]
  for (let index = prefix; index < oldSuffix; index += 1) {
    hunk.push(`-${oldLines[index]}`)
  }
  for (let index = prefix; index < newSuffix; index += 1) {
    hunk.push(`+${newLines[index]}`)
  }
  return `${hunk.join("\n")}\n`
}

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
}

function envLineKey(line: string): string | undefined {
  const trimmed = line.trim()
  if (trimmed === "" || trimmed.startsWith("#")) return undefined
  const eq = trimmed.indexOf("=")
  if (eq === -1) return undefined
  return trimmed.slice(0, eq)
}

function envLineValue(line: string): string {
  const eq = line.indexOf("=")
  if (eq === -1) return ""
  return line.slice(eq + 1)
}
