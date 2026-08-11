import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { s0ConfigPathForStage, s0ConfigStageForStage } from "@solzero/shared"

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

function usage(): string {
  return "Usage: nub run auth:admin-password -- <stage> [--local]"
}

function stateCommand(stack: "S0" | "S0Api" | "S0Web", stage: string, localArgs: string[]) {
  const stageTag = s0ConfigStageForStage(stage)
  return execFileSync(
    "nub",
    [
      "run",
      "--cwd",
      "packages/infra",
      "alchemy",
      "state",
      "get",
      "alchemy.state.run.ts",
      "--stack",
      stack,
      "--stage",
      stage,
      "--env-file",
      resolve(repoRoot, "config", `.${stageTag}.vars`),
      "--fqn",
      "admin-password",
      ...localArgs,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
}

function tryStateCommand(
  stack: "S0" | "S0Api" | "S0Web",
  stage: string,
  localArgs: string[],
): string | undefined {
  try {
    return stateCommand(stack, stage, localArgs)
  } catch {
    return undefined
  }
}

function findRedactedValue(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  if ("__redacted__" in value && typeof value.__redacted__ === "string") {
    return value.__redacted__
  }
  for (const child of Object.values(value)) {
    const match = findRedactedValue(child)
    if (match) return match
  }
  return undefined
}

const args = process.argv.slice(2).filter((arg) => arg !== "--")
const stage = args.find((arg) => !arg.startsWith("--"))
if (!stage || args.some((arg) => arg.startsWith("--") && arg !== "--local")) {
  throw new Error(usage())
}
const localArgs = args.includes("--local") ? ["--local"] : []
const rawState = (["S0", "S0Api", "S0Web"] as const).reduce<string | undefined>(
  (state, stack) => state ?? tryStateCommand(stack, stage, localArgs),
  undefined,
)
if (!rawState) {
  const configProfile = process.env.S0_CONFIG_PROFILE
  throw new Error(
    `No generated admin password exists for stage '${stage}'. Deploy the stack first, or configure the secret referenced by ${s0ConfigPathForStage(stage, configProfile)}:auth.adminPassword.`,
  )
}

const jsonStart = rawState.indexOf("{")
if (jsonStart < 0) {
  throw new Error("Alchemy state 'admin-password' did not return JSON")
}
const password = findRedactedValue(JSON.parse(rawState.slice(jsonStart)))
if (!password) {
  throw new Error("Generated admin password state 'admin-password' is missing its value")
}
process.stdout.write(`${password}\n`)
