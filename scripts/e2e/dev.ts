import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { bundleAgentContainer } from "../agent-container-build"
import { AGENT_CONTAINER_ENTRYPOINTS } from "../../packages/agent-container/src/images"
import { appEnvironment } from "./environment"

const repo = resolve(import.meta.dirname, "../..")
const runId = randomUUID()
const runDirectory = resolve(repo, ".e2e/runs", runId)
const stack = resolve(runDirectory, "stack")
const label = `dev.solzero.e2e.run=${runId}`

function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 })

  if (result.status !== 0) throw new Error("Docker cleanup failed.")

  return result.stdout.trim().split("\n").filter(Boolean)
}

// Containers inherit the run label from their source image. Alchemy names each proxy after its container.
function removeContainers() {
  for (const container of docker(["ps", "-aq", "--filter", `label=${label}`])) {
    const [name] = docker(["inspect", "--format", "{{.Name}}", container])
    const proxies = docker(["ps", "-aq", "--filter", `name=^${name}-proxy$`])
    docker(["rm", "-f", container, ...proxies])
  }

  for (const image of new Set(docker(["image", "ls", "-q", "--filter", `label=${label}`])))
    docker(["image", "rm", "-f", image])
}

await mkdir(stack, { recursive: true, mode: 0o700 })

writeFileSync(
  resolve(stack, ".dev.vars"),
  "# Isolated e2e credentials are inherited through the environment.\n",
  { mode: 0o600, flag: "wx" },
)

const containers = process.env.E2E_CONTAINER_RUNTIME === "1"

try {
  if (containers) {
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
      throw new Error(
        "Local container image builds require a running Docker daemon. Start Docker before running e2e.",
      )
    }

    const contexts = resolve(stack, "containers")

    for (const runtime of Object.keys(AGENT_CONTAINER_ENTRYPOINTS).filter(
      (key): key is keyof typeof AGENT_CONTAINER_ENTRYPOINTS =>
        Object.hasOwn(AGENT_CONTAINER_ENTRYPOINTS, key),
    )) {
      const context = resolve(contexts, runtime)
      await mkdir(context, { recursive: true })
      await bundleAgentContainer(runtime, context)
      await appendFile(resolve(context, "Dockerfile"), `\nLABEL ${label}\n`)
    }

    appEnvironment.S0_LOCAL_CONTAINER_CONTEXTS = contexts
  }

  // The e2e profile answers model calls inside the Worker, so local alchemy dev needs no deploy token.
  // Alchemy selects Bun when npm_execpath contains "bun", which the Nub binary path can match.
  const { CLOUDFLARE_API_TOKEN: _deployToken, npm_execpath: _execPath, ...env } = appEnvironment

  // Alchemy dev leads its own process group, so one signal stops its workerd and watch children.
  const child = spawn(
    process.execPath,
    [
      "--import",
      resolve(repo, "node_modules/tsx/dist/loader.mjs"),
      resolve(repo, "packages/infra/node_modules/alchemy/bin/cli.js"),
      "dev",
      resolve(repo, "packages/infra/alchemy.run.ts"),
      "--stage",
      "dev",
      "--env-file",
      resolve(stack, ".dev.vars"),
    ],
    { cwd: stack, env, stdio: "inherit", detached: true },
  )

  const signalGroup = (signal: NodeJS.Signals | 0) => {
    try {
      process.kill(-child.pid!, signal)

      return true
    } catch (error) {
      // SAFETY: process.kill rejects with a Node ErrnoException, and ESRCH means the group already exited.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error

      return false
    }
  }

  let stopping = false

  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      stopping = true
      signalGroup(signal)
    })

  const exitCode = await new Promise<number | null>((accept, reject) => {
    child.on("exit", accept)
    child.on("error", reject)
  })

  process.exitCode = stopping ? 0 : (exitCode ?? 1)

  // Stop workerd and watch children that outlived the CLI.
  if (child.pid && signalGroup("SIGTERM")) {
    for (let attempt = 0; attempt < 50 && signalGroup(0); attempt++)
      await new Promise((done) => setTimeout(done, 100))
    signalGroup("SIGKILL")
  }
} finally {
  if (containers) removeContainers()
  rmSync(runDirectory, { recursive: true, force: true })
}
