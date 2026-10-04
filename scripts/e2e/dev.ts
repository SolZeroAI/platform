import { spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { bundleAgentContainer } from "../agent-container-build"
import { AGENT_CONTAINER_ENTRYPOINTS } from "../../packages/agent-container/src/images"
import { appEnvironment } from "./environment"

// The normal infra command requires this file before it can generate stage bindings.
// CI supplies its real credentials in the environment; never synthesize deployment secrets.
if (!existsSync("config/.dev.vars")) {
  writeFileSync(
    "config/.dev.vars",
    "# Isolated e2e launcher; credentials come from the environment.\n",
    { mode: 0o600, flag: "wx" },
  )
}
if (process.env.E2E_CONTAINER_RUNTIME === "1") {
  const contexts = resolve(".e2e/containers")
  for (const runtime of Object.keys(AGENT_CONTAINER_ENTRYPOINTS) as Array<
    keyof typeof AGENT_CONTAINER_ENTRYPOINTS
  >) {
    const context = resolve(contexts, runtime)
    await mkdir(context, { recursive: true })
    await bundleAgentContainer(runtime, context)
  }
  appEnvironment.S0_E2E_CONTAINER_CONTEXTS = contexts
}

// Keep the declared Cloudflare bindings and Alchemy stack; never replace them with mocks.
const child = spawn("nub", ["run", "dev"], { stdio: "inherit", env: appEnvironment })
process.on("SIGINT", () => child.kill("SIGINT"))
process.on("SIGTERM", () => child.kill("SIGTERM"))
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1)
})
