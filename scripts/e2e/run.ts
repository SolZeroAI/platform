/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- Isolated process lifecycle boundary. */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  recoverRuns,
  waitForOwnLaunchers,
  signalOwnLaunchers,
  prepareLaunch,
  cancelLaunch,
  finishLaunch,
} from "./lifecycle"

const mcp = process.argv[2] === "--mcp"
const forwarded = process.argv.slice(mcp ? 3 : 2)
if (mcp) process.env.E2E_MCP_PROTOCOL = "1"
mkdirSync(".e2e", { recursive: true })
if (process.env.E2E_CLEANUP_APPEND !== "1")
  writeFileSync(".e2e/cleanup-summary.json", "[]", { mode: 0o600 })
let interrupted = false
let childActive = true
const launch = prepareLaunch("sdk")
const child = spawn(
  process.execPath,
  [
    "--import",
    "./node_modules/tsx/dist/loader.mjs",
    "./scripts/e2e/registered.ts",
    launch,
    "./node_modules/e2e/dist/cli/bin.js",
    mcp ? "mcp" : "run",
    ...forwarded,
  ],
  {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, NODE_E2E_RUNNER_PID: String(process.pid) },
  },
)
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    interrupted = true
    signalOwnLaunchers(process.pid, signal)
    if (childActive) cancelLaunch(launch, signal)
  })
const code = await new Promise<number | null>((accept) => {
  child.on("exit", (code) => {
    childActive = false
    accept(code)
  })
  child.on("error", () => {
    childActive = false
    accept(1)
  })
})
process.exitCode = interrupted ? 130 : (code ?? 1)
try {
  // SDK app teardown may ignore an app child's failed exit. Independently recover and verify.
  await waitForOwnLaunchers(process.pid)
  await finishLaunch(launch)
  await recoverRuns()
} catch {
  console.error(
    "Owned suite cleanup incomplete; retry nub run test:e2e:cleanup. Private receipt retained.",
  )
  writeFileSync(
    ".e2e/cleanup-summary.json",
    JSON.stringify([{ cleanup: "failed", verified: false }]),
    { mode: 0o600 },
  )
  process.exitCode = 1
}
