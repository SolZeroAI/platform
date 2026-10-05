import { spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { bundleAgentContainer } from "../agent-container-build"
import { AGENT_CONTAINER_ENTRYPOINTS } from "../../packages/agent-container/src/images"
import { appEnvironment } from "./environment"
import {
  createRun,
  recordCli,
  recordDocker,
  stackDirectory,
  alchemyCommand,
  cleanRun,
  recoverRuns,
  stopRunProcesses,
  cancelLaunch,
} from "./lifecycle"

await recoverRuns()
const run = createRun()
try {
  if (process.env.E2E_CONTAINER_RUNTIME === "1") {
    const docker = spawnSync("docker", ["info"], { stdio: "ignore" })
    if (docker.status !== 0) {
      throw new Error(
        "Core harness flows require a running Docker daemon. Start Docker before running e2e.",
      )
    }
    const contexts = resolve(stackDirectory(run), "containers")
    for (const runtime of Object.keys(AGENT_CONTAINER_ENTRYPOINTS) as Array<
      keyof typeof AGENT_CONTAINER_ENTRYPOINTS
    >) {
      const context = resolve(contexts, runtime)
      await mkdir(context, { recursive: true })
      await bundleAgentContainer(runtime, context)
      const { appendFile } = await import("node:fs/promises")
      await appendFile(
        resolve(context, "Dockerfile"),
        `\nLABEL dev.solzero.e2e.run="${run.runId}"\n`,
      )
    }
    appEnvironment.S0_E2E_CONTAINER_CONTEXTS = contexts
  }

  // The same Alchemy CLI/stack/watch runs in an owned directory: simulator data never shares dev storage.
  const child = alchemyCommand("dev", run)
  let stopping = false
  let childActive = true
  const recorderFailure = Promise.withResolvers<never>()
  const processRecorder = setInterval(() => {
    if (child.pid) {
      try {
        recordCli(run, child.pid)
        recordDocker(run)
      } catch {
        // A failed inventory must stop allocation and enter verified recovery, never
        // terminate the launcher outside finally while detached runtime children survive.
        clearInterval(processRecorder)
        recorderFailure.reject(
          new Error("Process or Docker inventory failed; owned recovery required."),
        )
      }
    }
  }, 500)
  function stop(signal: "SIGINT" | "SIGTERM") {
    if (stopping || !childActive) return
    stopping = true
    const owned = JSON.parse(readFileSync(resolve(stackDirectory(run), "../manifest.json"), "utf8"))
    if (owned.cliLaunchId) cancelLaunch(owned.cliLaunchId, signal)
  }
  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))
  const exitCode = await Promise.race([
    recorderFailure.promise,
    new Promise<number | null>((accept, reject) => {
      child.on("exit", (code) => {
        childActive = false
        clearInterval(processRecorder)
        accept(code)
      })
      child.on("error", (error) => {
        childActive = false
        clearInterval(processRecorder)
        reject(error)
      })
    }),
  ])
  process.exitCode = stopping ? 0 : (exitCode ?? 1)
} finally {
  await stopRunProcesses(run)
  await cleanRun(run, true)
}
