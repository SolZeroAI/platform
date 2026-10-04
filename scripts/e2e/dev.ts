import { spawn, spawnSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { bundleAgentContainer } from "../agent-container-build"
import { AGENT_CONTAINER_ENTRYPOINTS } from "../../packages/agent-container/src/images"
import { appEnvironment } from "./environment"

// Node watch also watches optional --env-file-if-exists paths, so both must exist.
// CI supplies its real credentials in the environment; never synthesize deployment secrets.
for (const file of ["config/.env", "config/.dev.vars"]) {
  if (!existsSync(file)) {
    writeFileSync(file, "# Isolated e2e launcher; credentials come from the environment.\n", {
      mode: 0o600,
      flag: "wx",
    })
  }
}
if (process.env.E2E_CONTAINER_RUNTIME === "1") {
  const docker = spawnSync("docker", ["info"], { stdio: "ignore" })
  if (docker.status !== 0) {
    throw new Error(
      "Core harness flows require a running Docker daemon. Start Docker before running e2e.",
    )
  }
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
