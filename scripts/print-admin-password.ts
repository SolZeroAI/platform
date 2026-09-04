import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { s0ConfigPathForStage, s0ConfigStageForStage } from "@solzero/shared"
import {
  ADMIN_PASSWORD_STATE_STACKS,
  adminPasswordFromStateDocument,
  readLocalAdminPassword,
} from "./admin-password-state"

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

function usage(): string {
  return "Usage: nub run auth:admin-password -- <stage> [--local]"
}

function stateCommand(stack: (typeof ADMIN_PASSWORD_STATE_STACKS)[number], stage: string) {
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
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
}

function tryStateCommand(
  stack: (typeof ADMIN_PASSWORD_STATE_STACKS)[number],
  stage: string,
): string | undefined {
  try {
    return stateCommand(stack, stage)
  } catch {
    return undefined
  }
}

function passwordFromCloudflareState(stage: string): string | undefined {
  const rawState = ADMIN_PASSWORD_STATE_STACKS.reduce<string | undefined>(
    (state, stack) => state ?? tryStateCommand(stack, stage),
    undefined,
  )
  if (!rawState) return undefined
  const jsonStart = rawState.indexOf("{")
  if (jsonStart < 0) return undefined
  return adminPasswordFromStateDocument(JSON.parse(rawState.slice(jsonStart)))
}

const args = process.argv.slice(2).filter((arg) => arg !== "--")
const stage = args.find((arg) => !arg.startsWith("--"))
if (!stage || args.some((arg) => arg.startsWith("--") && arg !== "--local")) {
  throw new Error(usage())
}
const password = args.includes("--local")
  ? readLocalAdminPassword(repoRoot, stage)
  : passwordFromCloudflareState(stage)
if (!password) {
  const configProfile = process.env.S0_CONFIG_PROFILE
  throw new Error(
    `No generated admin password exists for stage '${stage}'. Deploy the stack first, or configure the secret referenced by ${s0ConfigPathForStage(stage, configProfile)}:auth.adminPassword.`,
  )
}
process.stdout.write(`${password}\n`)
