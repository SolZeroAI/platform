/* oxlint-disable s0-lint/no-if-statement, effect/avoid-native-fetch -- Real process and HTTP lifecycle boundary; no mocked providers or handlers. */
import { test, expect } from "e2e"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawn } from "node:child_process"
import { get } from "node:http"
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs"
import { resolve } from "node:path"
import * as Schema from "effect/Schema"
import {
  recordDocker,
  createRun,
  prepareLaunch,
  alchemyCommand,
  cleanRun,
  processBirth,
} from "../../scripts/e2e/lifecycle"
import { appEnvironment } from "../../scripts/e2e/environment"

// Nested real SDK commands append cleanup receipts into this lifecycle run's bounded aggregate.
appEnvironment.E2E_CLEANUP_APPEND = "1"
writeFileSync(".e2e/cleanup-summary.json", "[]", { mode: 0o600 })
const root = resolve(".e2e/runs")
const Receipt = Schema.Struct({
  runId: Schema.String,
  completedAt: Schema.optional(Schema.String),
  tokenIds: Schema.Array(Schema.String),
  resources: Schema.Array(Schema.String),
})
function receipts() {
  return readdirSync(root)
    .map((id) => resolve(root, id, "manifest.json"))
    .filter(existsSync)
    .map((path) => Schema.decodeUnknownSync(Receipt)(JSON.parse(readFileSync(path, "utf8"))))
}
// Fresh HTTP sockets avoid pinned Node 24's macOS fetch QoS crash when the real app stops.
// This observes the actual endpoint/status; it does not intercept or synthesize responses.
function healthStatus() {
  return new Promise<number>((accept) => {
    const request = get(
      "http://localhost:3100/health",
      { agent: false, signal: AbortSignal.timeout(1000) },
      (response) => {
        response.resume()
        accept(response.statusCode ?? 0)
      },
    )
    request.on("error", () => accept(0))
  })
}
for (const stop of ["SIGTERM", "SIGKILL", "orphaned CLI"] as const) {
  test(`real test infrastructure cleans after ${stop} and recovery is idempotent`, async () => {
    const old = new Set(existsSync(root) ? receipts().map((item) => item.runId) : [])
    const log = openSync(resolve(`.e2e/cleanup-${stop}.log`), "w", 0o600)
    const child = spawn(
      process.execPath,
      ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/dev.ts")],
      { env: appEnvironment, stdio: ["ignore", log, log] },
    )
    let receipt: Schema.Schema.Type<typeof Receipt> | undefined
    try {
      await expect.poll(healthStatus, { timeout: 300_000 }).toBe(200)
      receipt = receipts().find((item) => !old.has(item.runId))
      expect(receipt).toBeDefined()
      const signedIn = await fetch("http://localhost:3100/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: process.env.E2E_USER_ADMIN_USERNAME,
          password: process.env.E2E_USER_ADMIN_PASSWORD,
        }),
      })
      expect(signedIn.status).toBe(200)
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      const created = await fetch("http://localhost:3100/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Owned cleanup regression", agentRuntime: "isolate" }),
      })
      expect(created.status).toBe(201)
      expect(existsSync(resolve(root, receipt!.runId, "stack/.alchemy/local"))).toBe(true)
      if (stop === "SIGKILL") {
        const invoked = await fetch("http://localhost:3100/sessions/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            title: "Owned container cleanup regression",
            agentRuntime: "codex",
            content: "Reply with exactly hello. No tools.",
          }),
          signal: AbortSignal.timeout(120_000),
        })
        expect(invoked.status).toBe(200)
        const result = await invoked.json()
        expect(result.status).toBe("completed")
        expect(result.output.trim()).toBe("hello")
        const { execFileSync } = await import("node:child_process")
        const ids = execFileSync(
          "docker",
          ["ps", "-q", "--filter", `label=dev.solzero.e2e.run=${receipt!.runId}`],
          { encoding: "utf8" },
        ).trim()
        expect(ids.length).toBeGreaterThan(0)
        const manifestPath = resolve(root, receipt!.runId, "manifest.json")
        recordDocker(JSON.parse(readFileSync(manifestPath, "utf8")))
        const owned = JSON.parse(readFileSync(manifestPath, "utf8")).docker
        expect(owned.length).toBeGreaterThan(0)
        expect(owned.some((item: { proxyIds: string[] }) => item.proxyIds.length > 0)).toBe(true)
        // Remove only the actual run-labelled main container: its unlabelled proxy must still be recovered from immutable IDs.
        for (const item of owned)
          execFileSync("docker", ["rm", "-f", item.containerId], { stdio: "ignore" })
      }
      if (stop === "SIGKILL") {
        // Model a crash after real token creation but before its state becomes durable.
        // Remove only this run's token resource receipt; unique remote intent must recover it.
        const state = resolve(root, receipt!.runId, "stack/.alchemy/state/S0/dev")
        const tokenFile = readdirSync(state).find(
          (file) =>
            file.endsWith(".json") &&
            JSON.parse(readFileSync(resolve(state, file), "utf8")).resourceType ===
              "Cloudflare.ApiToken.AccountApiToken",
        )
        expect(tokenFile).toBeDefined()
        unlinkSync(resolve(state, tokenFile!))
      }
      child.kill(stop === "SIGTERM" ? "SIGTERM" : "SIGKILL")
      if (stop === "orphaned CLI") {
        const owned = JSON.parse(
          readFileSync(resolve(root, receipt!.runId, "manifest.json"), "utf8"),
        )
        expect(owned.processes.some((item: { pgid: number }) => item.pgid !== owned.cliPid)).toBe(
          true,
        )
        process.kill(owned.cliPid, "SIGKILL")
      }
      await new Promise<void>((accept) => child.once("exit", () => accept()))
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      const recovered = spawn(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          resolve("scripts/e2e/cleanup.ts"),
        ],
        { env: appEnvironment, stdio: ["ignore", log, log] },
      )
      expect(await new Promise<number | null>((accept) => recovered.once("exit", accept))).toBe(0)
      closeSync(log)
    }
    expect(receipt).toBeDefined()
    const final = receipts().find((item) => item.runId === receipt!.runId)!
    expect(final.completedAt).toBeDefined()
    expect(final.tokenIds.length).toBe(1)
    expect(final.resources.length).toBeGreaterThan(0)
    expect(existsSync(resolve(root, receipt!.runId, "stack"))).toBe(false)
    const second = spawn(
      process.execPath,
      ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/cleanup.ts")],
      { env: appEnvironment, stdio: "ignore" },
    )
    expect(await new Promise<number | null>((accept) => second.once("exit", accept))).toBe(0)
  })
}

test("failed SDK suite propagates failure and still verifies owned teardown", async () => {
  const old = new Set(receipts().map((item) => item.runId))
  const log = openSync(resolve(".e2e/cleanup-failed-suite.log"), "w", 0o600)
  const child = spawn(
    process.execPath,
    [
      "--import",
      resolve("node_modules/tsx/dist/loader.mjs"),
      resolve("scripts/e2e/run.ts"),
      "--config",
      "e2e.failure.config.ts",
    ],
    { env: appEnvironment, stdio: ["ignore", log, log] },
  )
  const code = await new Promise<number | null>((accept) => child.once("close", accept))
  closeSync(log)
  expect(code).toBe(1)
  const receipt = receipts().find((item) => !old.has(item.runId))
  expect(receipt).toBeDefined()
  expect(receipt!.completedAt).toBeDefined()
  expect(existsSync(resolve(root, receipt!.runId, "stack"))).toBe(false)
  const report = JSON.parse(readFileSync(".e2e/cleanup-failure-inner/report.json", "utf8"))
  expect(report.run.summary.failed).toBe(1)
})

for (const outerSignal of ["SIGTERM", "SIGKILL"] as const)
  test(`cancelling the outer command with ${outerSignal} removes detached app infrastructure`, async () => {
    const old = new Set(receipts().map((item) => item.runId))
    const log = openSync(resolve(".e2e/cleanup-cancel-suite.log"), "w", 0o600)
    const child = spawn(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("scripts/e2e/run.ts"),
        "--config",
        "e2e.cancel.config.ts",
      ],
      { env: appEnvironment, stdio: ["ignore", log, log] },
    )
    try {
      await expect.poll(healthStatus, { timeout: 300_000 }).toBe(200)
      const signed = await fetch("http://localhost:3100/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: process.env.E2E_USER_ADMIN_USERNAME,
          password: process.env.E2E_USER_ADMIN_PASSWORD,
        }),
      })
      expect(signed.status).toBe(200)
      const cookie = signed.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      const session = await fetch("http://localhost:3100/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Owned cancellation regression", agentRuntime: "isolate" }),
      })
      expect(session.status).toBe(201)
      child.kill(outerSignal)
      const exit = await new Promise<number | null>((accept) => child.once("close", accept))
      if (outerSignal === "SIGTERM") expect(exit).toBe(130)
      else {
        expect(child.signalCode).toBe("SIGKILL")
        const recovered = spawn(
          process.execPath,
          [
            "--import",
            resolve("node_modules/tsx/dist/loader.mjs"),
            resolve("scripts/e2e/cleanup.ts"),
          ],
          { env: appEnvironment, stdio: ["ignore", log, log] },
        )
        expect(await new Promise<number | null>((accept) => recovered.once("close", accept))).toBe(
          0,
        )
      }
      const receipt = receipts().find((item) => !old.has(item.runId))
      expect(receipt).toBeDefined()
      expect(receipt!.completedAt).toBeDefined()
      expect(existsSync(resolve(root, receipt!.runId, "stack"))).toBe(false)
      expect(await healthStatus()).toBe(0)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM")
        await new Promise<void>((accept) => child.once("close", () => accept()))
      }
      closeSync(log)
    }
  })

test("failed process inspection preserves live owned infrastructure for recovery", async () => {
  const old = new Set(receipts().map((item) => item.runId))
  const log = openSync(resolve(".e2e/cleanup-process-fault.log"), "w", 0o600)
  const child = spawn(
    process.execPath,
    ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/dev.ts")],
    { env: appEnvironment, stdio: ["ignore", log, log] },
  )
  let faultDirectory: string | undefined
  try {
    await expect.poll(healthStatus, { timeout: 300_000 }).toBe(200)
    const receipt = receipts().find((item) => !old.has(item.runId))!
    expect(receipt).toBeDefined()
    child.kill("SIGKILL")
    await new Promise<void>((accept) => child.once("close", () => accept()))
    faultDirectory = resolve(root, receipt.runId, "failed-process-inspector")
    mkdirSync(faultDirectory, { mode: 0o700 })
    writeFileSync(resolve(faultDirectory, "ps"), "#!/bin/sh\nexit 2\n", { mode: 0o700 })
    const failed = spawn(
      process.execPath,
      ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/cleanup.ts")],
      {
        env: { ...appEnvironment, PATH: `${faultDirectory}:${appEnvironment.PATH}` },
        stdio: ["ignore", log, log],
      },
    )
    expect(await new Promise<number | null>((accept) => failed.once("close", accept))).toBe(1)
    expect(receipts().find((item) => item.runId === receipt.runId)!.completedAt).toBeUndefined()
    expect(existsSync(resolve(root, receipt.runId, "stack"))).toBe(true)
    expect(await healthStatus()).toBe(200)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await new Promise<void>((accept) => child.once("close", () => accept()))
    }
    const recovered = spawn(
      process.execPath,
      ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/cleanup.ts")],
      { env: appEnvironment, stdio: ["ignore", log, log] },
    )
    expect(await new Promise<number | null>((accept) => recovered.once("close", accept))).toBe(0)
    if (faultDirectory) rmSync(faultDirectory, { recursive: true, force: true })
    closeSync(log)
  }
  expect(await healthStatus()).toBe(0)
  const receipt = receipts().find((item) => !old.has(item.runId))!
  expect(receipt.completedAt).toBeDefined()
  expect(existsSync(resolve(root, receipt.runId, "stack"))).toBe(false)
})

test("failed launch publication cannot allocate infrastructure or erase its receipt", async () => {
  const run = createRun()
  const launch = prepareLaunch("alchemy", run)
  const manifest = resolve(root, run.runId, "manifest.json")
  // A genuine filesystem publication failure occurs after the durable launch intent.
  const fault = `${manifest}.tmp`
  mkdirSync(fault, { mode: 0o700 })
  let child: ReturnType<typeof alchemyCommand> | undefined
  try {
    child = alchemyCommand("dev", run, launch)
    expect(await new Promise<number | null>((accept) => child!.once("close", accept))).toBe(1)
    expect(JSON.parse(readFileSync(manifest, "utf8")).cliPid).toBeUndefined()
    expect(existsSync(resolve(root, run.runId, "stack/.alchemy"))).toBe(false)
    expect(await healthStatus()).toBe(0)
    let failed = false
    try {
      await cleanRun(run, true)
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(JSON.parse(readFileSync(manifest, "utf8")).completedAt).toBeUndefined()
    const published = JSON.parse(readFileSync(".e2e/cleanup-ownership.json", "utf8"))
    expect(
      published.some(
        (item: { owner: string; completed: boolean }) =>
          item.owner === run.runId && !item.completed,
      ),
    ).toBe(true)
    expect(existsSync(resolve(root, run.runId, "stack"))).toBe(true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await new Promise<void>((accept) => child!.once("close", () => accept()))
    }
    rmSync(fault, { recursive: true, force: true })
    await cleanRun(run, true)
  }
  expect(JSON.parse(readFileSync(manifest, "utf8")).completedAt).toBeDefined()
  expect(existsSync(resolve(root, run.runId, "stack"))).toBe(false)
})

test("official MCP opens a real browser session and closes its owned infrastructure", async () => {
  const old = new Set(receipts().map((item) => item.runId))
  const launchRoot = resolve(".e2e/launches")
  const oldLaunches = new Set(readdirSync(launchRoot))
  const log = openSync(resolve(".e2e/cleanup-mcp.log"), "w", 0o600)
  const transport = new StdioClientTransport({
    command: "nub",
    args: ["run", "--silent", "test:e2e:mcp", "--headless", "--max-sessions", "1"],
    env: appEnvironment,
    stderr: log,
  })
  const client = new Client({ name: "solzero-cleanup-regression", version: "1.0.0" })
  const resultSchema = Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) })),
  })
  const textResult = (result: unknown) => {
    const parsed = Schema.decodeUnknownSync(resultSchema)(result)
    expect(parsed.isError === true).toBe(false)
    return parsed.content.flatMap((item) => (item.text ? [item.text] : [])).join("\n")
  }
  let opened = false
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.some((tool) => tool.name === "open_session")).toBe(true)
    const openedResult = await client.callTool(
      { name: "open_session", arguments: { target: "local-cloudflare" } },
      undefined,
      { timeout: 300_000 },
    )
    const opening = textResult(openedResult)
    expect(opening.includes('open on target "local-cloudflare"')).toBe(true)
    opened = true
    expect(await healthStatus()).toBe(200)
    const observation = textResult(
      await client.callTool({ name: "call", arguments: { tool: "observe" } }),
    )
    expect(observation.includes('button "Sign In"')).toBe(true)
    textResult(await client.callTool({ name: "close_session" }, undefined, { timeout: 120_000 }))
    opened = false
    await expect.poll(healthStatus).toBe(0)
    const owned = receipts().find((item) => !old.has(item.runId))!
    expect(owned).toBeDefined()
    await expect
      .poll(() => receipts().find((item) => item.runId === owned.runId)?.completedAt, {
        timeout: 120_000,
      })
      .toBeDefined()
    expect(existsSync(resolve(root, owned.runId, "stack"))).toBe(false)
  } finally {
    if (opened)
      await client
        .callTool({ name: "close_session" }, undefined, { timeout: 120_000 })
        .catch(() => undefined)
    await client.close()
    // The official stdio transport stops its immediate Nub child; allow the
    // registered runner's asynchronous teardown to finish before recovery.
    await expect
      .poll(
        () =>
          readdirSync(launchRoot)
            .filter((id) => !oldLaunches.has(id))
            .map((id) => JSON.parse(readFileSync(resolve(launchRoot, id, "intent.json"), "utf8")))
            .every(
              (intent) => intent.completed || processBirth(intent.parentPid) !== intent.parentBirth,
            ),
        { timeout: 30_000 },
      )
      .toBe(true)
    closeSync(log)
    const recovered = spawn(
      process.execPath,
      ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/e2e/cleanup.ts")],
      { env: appEnvironment, stdio: "ignore" },
    )
    expect(await new Promise<number | null>((accept) => recovered.once("close", accept))).toBe(0)
  }
})
