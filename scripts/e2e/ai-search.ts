import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises"
import { resolve } from "node:path"
import dotenv from "dotenv"
import { parse } from "jsonc-parser"
import {
  getAiSearchNamespaceName,
  getWorkflowAiSearchNamespaceName,
} from "../../packages/infra/src/aiSearch"

if (!process.env.E2E_ENV_FILE) {
  throw new Error("Set E2E_ENV_FILE to the isolated test account's private credentials file.")
}

dotenv.config({ path: process.env.E2E_ENV_FILE, quiet: true })

const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN

if (!account || !token) throw new Error("Live AI Search requires isolated Cloudflare credentials.")

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  throw new Error(
    "Start Docker: Alchemy's native live AI Search binding requires its proxy container.",
  )
}

const args = process.argv.slice(2)
const record = args.includes("--record")
const strict = args.includes("--strict-cache")
const selection = args.filter((arg) => arg !== "--record" && arg !== "--strict-cache")

if (record && strict) throw new Error("Choose either --record or --strict-cache.")

const cacheArgs: string[] = []

if (strict) cacheArgs.push("--strict-cache")
else if (!record) cacheArgs.push("--no-cache")

if (selection.length !== 0 && (selection.length !== 2 || selection[0] !== "--grep")) {
  throw new Error(
    "Usage: scripts/e2e/ai-search.ts [--record | --strict-cache] [--grep <test-title-pattern>]",
  )
}

const run = randomUUID()
const profile = `e2e-ai-search-${run.slice(0, 8)}`
const appName = `s0-e2e-as-${run.slice(0, 8)}`
const configPath = resolve(`config/${profile}-dev.config.jsonc`)
const evidencePath = resolve(".e2e/ai-search-live", run)

const namespaces = [
  getAiSearchNamespaceName({ appName, stageName: "dev" }),
  getWorkflowAiSearchNamespaceName({ appName, stageName: "dev" }),
]

await mkdir(evidencePath, { recursive: true, mode: 0o700 })

const root = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai-search/namespaces`

async function request(path: string, method = "GET") {
  return fetch(`${root}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  })
}

// Establish ownership before Alchemy starts. Never adopt or clean up an existing namespace.
for (const name of namespaces) {
  const response = await request(name)

  if (response.status !== 404) {
    throw new Error(`Expected unused isolated namespace ${name}; received HTTP ${response.status}.`)
  }
}

const source = parse(await readFile("config/e2e-dev.config.jsonc", "utf8"))

const config = {
  ...source,
  deployment: { ...source.deployment, appName, aiSearchEnabledInDev: true },
}

await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" })

const cleanup: Array<{ namespace: string; absent: boolean }> = []
let exitCode = 1

try {
  console.log(`AI Search isolated run ${run}; evidence: ${evidencePath}`)

  const child = spawn(
    "nub",
    [
      "exec",
      "e2e",
      "run",
      "tests/auth.setup.e2e.ts",
      "tests/ai-search.external.e2e.ts",
      ...cacheArgs,
      "--tag",
      "ai-search-live",
      ...selection,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_CONFIG_PROFILE: profile,
        E2E_CONTAINER_RUNTIME: "0",
        E2E_TELEMETRY_DISABLED: "1",
      },
    },
  )

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal))
  }

  exitCode = await new Promise<number>((accept, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => accept(code ?? 1))
  })
} finally {
  // Only these fresh, run-owned namespaces can be touched. The instance pass also handles
  // a test that failed after Cloudflare created an instance but before its response arrived.
  const results = await Promise.allSettled(
    namespaces.map(async (name) => {
      const instances = await request(`${name}/instances?per_page=100`)

      if (instances.ok) {
        // SAFETY: Cloudflare's instance-list envelope; each path remains inside this owned namespace.
        const body = (await instances.json()) as { result: Array<{ id: string }> }

        for (const instance of body.result) {
          const removed = await request(
            `${name}/instances/${encodeURIComponent(instance.id)}`,
            "DELETE",
          )

          if (!removed.ok && removed.status !== 404)
            throw new Error(`Instance cleanup HTTP ${removed.status}`)
        }
      } else if (instances.status !== 404) {
        throw new Error(`Instance inventory HTTP ${instances.status}`)
      }

      const removed = await request(name, "DELETE")

      if (!removed.ok && removed.status !== 404)
        throw new Error(`Namespace cleanup HTTP ${removed.status}`)

      let absent = false

      // Deletion can be briefly visible to a subsequent read. Verify eventual absence.
      for (let attempt = 0; attempt < 30; attempt++) {
        const verified = await request(name)

        if (verified.status === 404) {
          absent = true
          break
        }

        if (verified.status !== 200)
          throw new Error(`Namespace cleanup verification HTTP ${verified.status}`)

        await new Promise((done) => setTimeout(done, 1000))
      }

      cleanup.push({ namespace: name, absent })

      if (!absent) throw new Error("Namespace still present after cleanup verification deadline")
    }),
  )

  await writeFile(
    resolve(evidencePath, "ownership.json"),
    JSON.stringify(
      {
        run,
        accountId: account,
        appName,
        namespaces,
        cleanup,
        testsExitCode: exitCode,
        cleanupErrors: results.flatMap((result) =>
          result.status === "rejected" ? [String(result.reason)] : [],
        ),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  await copyFile(".e2e/report.json", resolve(evidencePath, "report.json")).catch(() => undefined)
  await copyFile(".e2e/summary.md", resolve(evidencePath, "summary.md")).catch(() => undefined)
  await rm(configPath, { force: true })

  if (results.some((result) => result.status === "rejected")) {
    console.error(`AI Search cleanup incomplete. Inspect ${evidencePath}/ownership.json.`)
    exitCode = 1
  } else {
    console.log("AI Search cleanup verified: both run-owned namespaces are absent.")
  }
}

process.exitCode = exitCode
