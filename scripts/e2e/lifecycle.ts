/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary, effect/avoid-native-fetch -- This isolated Node process boundary validates durable ownership before invoking Alchemy and Docker CLIs. */
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import * as Schema from "effect/Schema"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import { parse } from "jsonc-parser"
import { resolveS0Config, s0ConfigPathForStage } from "@solzero/shared"
import { appEnvironment } from "./environment"

const repo = resolve(import.meta.dirname, "../..")
const root = resolve(repo, ".e2e/runs")
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.String,
  account: Schema.String,
  profile: Schema.String,
  ci: Schema.Boolean,
  appName: Schema.String,
  launcherPid: Schema.Number,
  launcherBirth: Schema.optional(Schema.String),
  runnerBirth: Schema.optional(Schema.String),
  processes: Schema.optional(
    Schema.Array(Schema.Struct({ pid: Schema.Number, pgid: Schema.Number, birth: Schema.String })),
  ),
  runnerPid: Schema.optional(Schema.Number),
  cliPid: Schema.optional(Schema.Number),
  cliLaunchId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  gatewayId: Schema.String,
  tokenIds: Schema.Array(Schema.String),
  resources: Schema.Array(Schema.String),
  docker: Schema.optional(
    Schema.Array(
      Schema.Struct({
        containerId: Schema.String,
        containerName: Schema.String,
        proxyIds: Schema.Array(Schema.String),
      }),
    ),
  ),
  completedAt: Schema.optional(Schema.String),
})
export type RunManifest = Schema.Schema.Type<typeof Manifest>
const profile = process.env.E2E_CONFIG_PROFILE ?? "e2e"
const appName = resolveS0Config(
  parse(readFileSync(resolve(repo, s0ConfigPathForStage("dev", profile)), "utf8")),
).deployment.appName
const ci = await Effect.runPromise(Config.boolean("CI").pipe(Config.withDefault(false)))
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
const gatewayForRun = (runId: string) => `${appName}${ci ? "-ci" : ""}-dev-${runId}`
const Resource = Schema.Struct({
  resourceType: Schema.optional(Schema.String),
  providerMode: Schema.optional(Schema.String),
  props: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.String),
    }),
  ),
  attr: Schema.optional(
    Schema.Struct({
      gatewayId: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.String),
      tokenId: Schema.optional(Schema.String),
    }),
  ),
})
function publishOwnership(value: unknown, owner: string) {
  const path = resolve(repo, ".e2e/cleanup-ownership.json")
  const temporary = `${path}.tmp-${owner}-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
function removeOwnedPublicationTemps(run: RunManifest) {
  if (!readRun(run).completedAt) throw new Error("Cannot remove pending ownership publication.")
  const directory = resolve(repo, ".e2e")
  const prefix = `cleanup-ownership.json.tmp-${run.runId}-`
  for (const name of readdirSync(directory)) {
    if (name.startsWith(prefix) && /^[1-9][0-9]*-[0-9a-f-]{36}$/.test(name.slice(prefix.length)))
      rmSync(resolve(directory, name), { force: true })
  }
}
function save(manifest: RunManifest) {
  const path = resolve(root, manifest.runId, "manifest.json")
  writeFileSync(`${path}.tmp`, JSON.stringify(manifest), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  const publicPath = resolve(repo, ".e2e/cleanup-ownership.json")
  const ledger = existsSync(publicPath) ? JSON.parse(readFileSync(publicPath, "utf8")) : []
  const previous = ledger.find((item: { owner: string }) => item.owner === manifest.runId)
  const bounded = {
    schemaVersion: 1,
    repository: process.env.GITHUB_REPOSITORY ?? "SolZeroAI/platform",
    run: previous?.run ?? process.env.GITHUB_RUN_ID ?? null,
    attempt: previous?.attempt ?? process.env.GITHUB_RUN_ATTEMPT ?? null,
    profile: manifest.profile,
    ci: manifest.ci,
    accountHash: createHash("sha256").update(manifest.account).digest("hex"),
    owner: manifest.runId,
    createdAt: manifest.createdAt,
    gatewayId: manifest.gatewayId,
    tokenName: `${manifest.appName}-dev-ai-gateway-run-${manifest.runId}`,
    tokenIds: manifest.tokenIds,
    completed: Boolean(manifest.completedAt),
  }
  publishOwnership(
    [...ledger.filter((item: { owner: string }) => item.owner !== manifest.runId), bounded],
    manifest.runId,
  )
}
export function createRun() {
  if (!/^s0-e2e(?:-[a-z0-9-]+)?$/.test(appName) || !account)
    throw new Error("An isolated profile and Cloudflare account are required.")
  const runId = randomUUID()
  const manifest: RunManifest = {
    version: 1,
    runId,
    account,
    profile,
    ci,
    appName,
    launcherPid: process.pid,
    launcherBirth: processBirth(process.pid),
    runnerBirth: process.env.NODE_E2E_RUNNER_PID
      ? processBirth(Number(process.env.NODE_E2E_RUNNER_PID))
      : undefined,
    runnerPid: process.env.NODE_E2E_RUNNER_PID
      ? Number(process.env.NODE_E2E_RUNNER_PID)
      : undefined,
    createdAt: new Date().toISOString(),
    gatewayId: gatewayForRun(runId),
    tokenIds: [],
    resources: [],
  }
  mkdirSync(resolve(root, runId, "stack"), { recursive: true, mode: 0o700 })
  writeFileSync(
    resolve(root, runId, "stack/.dev.vars"),
    "# Isolated e2e credentials are inherited through the environment.\n",
    { mode: 0o600, flag: "wx" },
  )
  save(manifest)
  return manifest
}
export function processBirth(pid: number) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5000,
  })
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1))
    throw new Error("Process identity inspection failed; receipt retained.")
  // ps exits 1 with no diagnostic when the requested PID is absent on macOS/Linux.
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return ""
  if (result.status !== 0 || !result.stdout.trim())
    throw new Error("Process identity inspection was incomplete.")
  return result.stdout.trim()
}
function processTable() {
  const result = spawnSync("ps", ["-e", "-o", "pid=,ppid=,pgid=,stat=,lstart="], {
    encoding: "utf8",
    timeout: 5000,
  })
  if (result.error || result.signal || result.status !== 0 || !result.stdout.trim())
    throw new Error("Process inventory failed; receipt retained.")
  const table = result.stdout
    .trim()
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
      if (!match) throw new Error("Process inventory was incomplete; receipt retained.")
      return !match[4].startsWith("Z")
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              pgid: Number(match[3]),
              birth: match[5].trim(),
            },
          ]
        : []
    })
  if (!table.some((item) => item.pid === process.pid))
    throw new Error("Process inventory omitted its live inspector.")
  return table
}
function descendants(pid: number) {
  const table = processTable()
  const ids = new Set([pid])
  for (let changed = true; changed; ) {
    changed = false
    for (const item of table)
      if (ids.has(item.parent) && !ids.has(item.pid)) {
        ids.add(item.pid)
        changed = true
      }
  }
  return table
    .filter((item) => ids.has(item.pid))
    .map(({ pid, pgid, birth }) => ({ pid, pgid, birth }))
}
function readRun(run: RunManifest) {
  return Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(resolve(root, run.runId, "manifest.json"), "utf8")),
  )
}
export function recordCli(run: RunManifest, cliPid: number) {
  const saved = readRun(run)
  const processes = [...(saved.processes ?? [])]
  for (const item of descendants(cliPid))
    if (!processes.some((old) => old.pid === item.pid && old.birth === item.birth))
      processes.push(item)
  if (saved.cliPid !== cliPid || JSON.stringify(processes) !== JSON.stringify(saved.processes))
    save({ ...saved, cliPid, processes })
}
type OwnedProcess = { pid: number; pgid: number; birth: string }
const launches = resolve(repo, ".e2e/launches")
const Launch = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["alchemy", "sdk"]),
  account: Schema.String,
  profile: Schema.String,
  ci: Schema.Boolean,
  parentPid: Schema.Number,
  parentBirth: Schema.String,
  runId: Schema.optional(Schema.String),
  processes: Schema.Array(
    Schema.Struct({ pid: Schema.Number, pgid: Schema.Number, birth: Schema.String }),
  ),
  cancelled: Schema.Boolean,
  completed: Schema.Boolean,
})
function launchPath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid process launch identity.")
  return resolve(launches, id, "intent.json")
}
function readLaunch(id: string) {
  const value = Schema.decodeUnknownSync(Launch)(JSON.parse(readFileSync(launchPath(id), "utf8")))
  if (value.id !== id || value.account !== account || value.profile !== profile || value.ci !== ci)
    throw new Error("Process launch ownership does not match this profile/account.")
  return value
}
function saveLaunch(value: Schema.Schema.Type<typeof Launch>) {
  const path = launchPath(value.id)
  // Parent cancellation/recovery and the child recorder may publish concurrently.
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}
export function prepareLaunch(kind: "alchemy" | "sdk", run?: RunManifest) {
  const id = randomUUID()
  mkdirSync(resolve(launches, id), { recursive: true, mode: 0o700 })
  saveLaunch({
    id,
    kind,
    account,
    profile,
    ci,
    parentPid: process.pid,
    parentBirth: processBirth(process.pid),
    runId: run?.runId,
    processes: [],
    cancelled: false,
    completed: false,
  })
  if (run) save({ ...readRun(run), cliLaunchId: id })
  return id
}
export function registerLaunch(id: string) {
  const intent = readLaunch(id)
  if (intent.processes.length || intent.completed)
    throw new Error("Process launch was already registered.")
  const self = processTable().find((item) => item.pid === process.pid)!
  // Persist self identity before publication to the app journal or loading either real CLI.
  saveLaunch({ ...intent, processes: [{ pid: self.pid, pgid: self.pgid, birth: self.birth }] })
  if (
    existsSync(resolve(launches, id, "cancelled")) ||
    intent.cancelled ||
    processBirth(intent.parentPid) !== intent.parentBirth
  )
    throw new Error("Process launch parent stopped before registration.")
  if (intent.kind === "alchemy") {
    if (!intent.runId) throw new Error("Alchemy launch lacks its owned run.")
    const run = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(readFileSync(resolve(root, intent.runId, "manifest.json"), "utf8")),
    )
    if (run.cliLaunchId !== id) throw new Error("Alchemy launch intent mismatch.")
    recordCli(run, process.pid)
  }
  return intent.kind
}
export function recordLaunch(id: string) {
  const intent = readLaunch(id)
  const processes = [...intent.processes]
  for (const item of descendants(process.pid)) {
    const previous = processes.find((owned) => owned.pid === item.pid && owned.birth === item.birth)
    if (previous && previous.pgid !== item.pgid)
      throw new Error("Owned process changed group; launch retained.")
    if (!previous) processes.push(item)
  }
  if (JSON.stringify(processes) !== JSON.stringify(intent.processes))
    saveLaunch({ ...intent, processes })
}
export function cancelLaunch(id: string, signal: "SIGINT" | "SIGTERM") {
  const intent = readLaunch(id)
  writeFileSync(resolve(launches, id, "cancelled"), "cancelled\n", { mode: 0o600 })
  const leader = intent.processes[0]
  if (leader && processBirth(leader.pid) === leader.birth) {
    try {
      process.kill(leader.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
}
export async function finishLaunch(id: string) {
  const intent = readLaunch(id)
  if (intent.completed) return
  if (!intent.processes.length)
    throw new Error("Unresolved process launch intent; storage retained.")
  await stopSnapshots(intent.processes, (processes) => saveLaunch({ ...readLaunch(id), processes }))
  saveLaunch({ ...readLaunch(id), completed: true })
}
async function recoverLaunches() {
  if (!existsSync(launches)) return
  for (const id of readdirSync(launches)) {
    const path = launchPath(id)
    if (!existsSync(path)) continue
    const raw = Schema.decodeUnknownSync(Launch)(JSON.parse(readFileSync(path, "utf8")))
    if (raw.account !== account || raw.profile !== profile || raw.ci !== ci || raw.completed)
      continue
    if (processBirth(raw.parentPid) === raw.parentBirth) continue
    await finishLaunch(id)
  }
}
class UnrecordedProcess extends Error {}
async function stopSnapshots(
  initial: readonly OwnedProcess[],
  publish: (processes: OwnedProcess[]) => void,
) {
  const snapshots = [...initial]
  // While the original leader is alive its current descendants are also owned, including detached subgroups.
  for (const anchor of [...snapshots])
    if (processBirth(anchor.pid) === anchor.birth) {
      for (const item of descendants(anchor.pid))
        if (!snapshots.some((old) => old.pid === item.pid && old.birth === item.birth))
          snapshots.push(item)
    }
  publish(snapshots)
  const currentOwned = () => {
    const table = processTable()
    if (
      table.some((item) =>
        snapshots.some(
          (owned) =>
            owned.pid === item.pid && owned.birth === item.birth && owned.pgid !== item.pgid,
        ),
      )
    )
      throw new Error("Owned process changed group; receipt retained for inspection.")
    const matched = new Set(
      table
        .filter((item) =>
          snapshots.some((owned) => owned.pid === item.pid && owned.birth === item.birth),
        )
        .map((item) => item.pid),
    )
    for (let changed = true; changed; ) {
      changed = false
      for (const item of table)
        if (matched.has(item.parent) && !matched.has(item.pid)) {
          matched.add(item.pid)
          snapshots.push({ pid: item.pid, pgid: item.pgid, birth: item.birth })
          changed = true
        }
    }
    publish(snapshots)
    if (
      table.some(
        (item) =>
          snapshots.some((owned) => owned.pgid === item.pgid) &&
          !snapshots.some((owned) => owned.pid === item.pid && owned.birth === item.birth),
      )
    )
      throw new UnrecordedProcess("Unrecorded surviving process group member; receipt retained.")
    return table.filter((item) =>
      snapshots.some(
        (owned) => owned.pid === item.pid && owned.birth === item.birth && owned.pgid === item.pgid,
      ),
    )
  }
  const signal = (kind: "SIGTERM" | "SIGKILL") => {
    // Signal individual birth-matched members, never an unverified or recycled group.
    for (const item of currentOwned().reverse())
      if (processBirth(item.pid) === item.birth) {
        try {
          process.kill(item.pid, kind)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
  }
  if (!currentOwned().length) return
  signal("SIGTERM")
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if (!currentOwned().length) return
    } catch (error) {
      // An unrecorded transient child may be exiting. Wait for absence, without signalling it or deleting data.
      if (!(error instanceof UnrecordedProcess) || attempt === 49) throw error
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  signal("SIGKILL")
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if (!currentOwned().length) return
    } catch (error) {
      // An unrecorded transient child may be exiting. Wait for absence, without signalling it or deleting data.
      if (!(error instanceof UnrecordedProcess) || attempt === 49) throw error
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error("Owned runtime descendants remain; cleanup retained for retry.")
}

export async function stopRunProcesses(run: RunManifest) {
  const saved = readRun(run)
  if (saved.cliLaunchId) await finishLaunch(saved.cliLaunchId)
  if (!saved.cliPid) {
    if (saved.cliLaunchId) {
      const launch = readLaunch(saved.cliLaunchId)
      if (!launch.completed || !launch.processes[0])
        throw new Error("Unresolved Alchemy launch; payload retained.")
      // Recovery must publish the registered identity before removing any private payload.
      save({ ...saved, cliPid: launch.processes[0].pid, processes: launch.processes })
    }
    return
  }
  await stopSnapshots(saved.processes ?? [], (processes) => {
    if (JSON.stringify(processes) !== JSON.stringify(readRun(run).processes))
      save({ ...readRun(run), processes })
  })
}
export function signalOwnLaunchers(runnerPid: number, signal: "SIGINT" | "SIGTERM") {
  if (!existsSync(root)) return
  for (const id of readdirSync(root)) {
    const path = resolve(root, id, "manifest.json")
    if (!existsSync(path)) continue
    const run = Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(path, "utf8")))
    if (
      !run.completedAt &&
      run.runnerPid === runnerPid &&
      run.runnerBirth === processBirth(runnerPid) &&
      run.launcherBirth === processBirth(run.launcherPid)
    )
      try {
        process.kill(run.launcherPid, signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
  }
}
export function stackDirectory(run: RunManifest) {
  return resolve(root, run.runId, "stack")
}
export function alchemyCommand(command: "dev" | "destroy", run: RunManifest, prepared?: string) {
  const launch = command === "dev" ? (prepared ?? prepareLaunch("alchemy", run)) : undefined
  return spawn(
    process.execPath,
    [
      "--import",
      resolve(repo, "node_modules/tsx/dist/loader.mjs"),
      ...(launch ? [resolve(repo, "scripts/e2e/registered.ts"), launch] : []),
      resolve(repo, "packages/infra/node_modules/alchemy/bin/alchemy.ts"),
      command,
      resolve(repo, "packages/infra/alchemy.run.ts"),
      "--stage",
      "dev",
      "--env-file",
      resolve(stackDirectory(run), ".dev.vars"),
      ...(command === "destroy" ? ["--yes"] : []),
    ],
    {
      cwd: stackDirectory(run),
      env: { ...appEnvironment, S0_E2E_RUN_ID: run.runId, S0_E2E_APP_CHILD: "1" },
      stdio: "inherit",
      detached: command === "dev",
      ...(command === "destroy" ? { signal: AbortSignal.timeout(120_000) } : {}),
    },
  )
}
function capture(run: RunManifest) {
  const state = resolve(stackDirectory(run), ".alchemy/state/S0/dev")
  if (!existsSync(state)) return run
  for (const file of readdirSync(state).filter((name) => name.endsWith(".json"))) {
    const resource = Schema.decodeUnknownSync(Resource)(
      JSON.parse(readFileSync(resolve(state, file), "utf8")),
    )
    if (!resource.resourceType) continue
    if (
      [resource.props?.accountId, resource.attr?.accountId].some(
        (value) => value !== undefined && value !== run.account,
      )
    )
      throw new Error("Cleanup refused another account's state.")
    if (resource.resourceType === "Cloudflare.AI.Gateway") {
      if (
        resource.props?.id !== run.gatewayId ||
        (resource.attr?.gatewayId !== undefined && resource.attr.gatewayId !== run.gatewayId)
      )
        throw new Error("Cleanup refused an unrelated gateway.")
    } else if (resource.resourceType === "Cloudflare.ApiToken.AccountApiToken") {
      const name = `${run.appName}-dev-ai-gateway-run-${run.runId}`
      if (
        resource.props?.name !== name ||
        (resource.attr?.name !== undefined && resource.attr.name !== name)
      )
        throw new Error("Cleanup refused an unrelated token.")
      if (resource.attr?.tokenId && !run.tokenIds.includes(resource.attr.tokenId))
        run = { ...run, tokenIds: [...run.tokenIds, resource.attr.tokenId] }
    } else if (resource.providerMode !== "local" && resource.resourceType !== "Alchemy.Random")
      throw new Error("Cleanup refused an unexpected remote resource.")
    if (
      resource.resourceType === "Cloudflare.Worker" &&
      ![`${run.appName}-api-dev`, `${run.appName}-web-dev`].includes(resource.props?.name ?? "")
    )
      throw new Error("Cleanup refused an unrelated Worker.")
    if (!run.resources.includes(resource.resourceType))
      run = { ...run, resources: [...run.resources, resource.resourceType] }
  }
  save(run)
  return run
}
function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 })
  if (result.status !== 0)
    throw new Error("Owned Docker cleanup failed; receipt retained for recovery.")
  return result.stdout.trim().split("\n").filter(Boolean)
}
export function recordDocker(run: RunManifest) {
  const saved = readRun(run)
  const owned = [...(saved.docker ?? [])]
  for (const id of docker([
    "ps",
    "-aq",
    "--no-trunc",
    "--filter",
    `label=dev.solzero.e2e.run=${run.runId}`,
  ])) {
    const [name] = docker(["inspect", "--format", "{{.Name}}", id])
    const proxyIds = docker(["ps", "-aq", "--no-trunc", "--filter", `name=^${name}-proxy$`])
    const old = owned.find((item) => item.containerId === id)
    const combined = [...new Set([...(old?.proxyIds ?? []), ...proxyIds])]
    const next = { containerId: id, containerName: name, proxyIds: combined }
    const index = owned.findIndex((item) => item.containerId === id)
    if (index === -1) owned.push(next)
    else owned[index] = next
  }
  if (JSON.stringify(owned) !== JSON.stringify(saved.docker)) save({ ...saved, docker: owned })
}
function cleanDocker(run: RunManifest) {
  recordDocker(run)
  const owned = readRun(run).docker ?? []
  let current = docker(["ps", "-aq", "--no-trunc"])
  for (const item of owned) {
    if (current.includes(item.containerId)) {
      const [label] = docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "dev.solzero.e2e.run"}}',
        item.containerId,
      ])
      if (label !== run.runId) throw new Error("Recorded container ownership mismatch.")
      docker(["rm", "-f", item.containerId])
    }
    for (const proxy of item.proxyIds)
      if (current.includes(proxy)) {
        const [name] = docker(["inspect", "--format", "{{.Name}}", proxy])
        if (name !== `${item.containerName}-proxy`)
          throw new Error("Recorded proxy ownership mismatch.")
        docker(["rm", "-f", proxy])
      }
  }
  current = docker(["ps", "-aq", "--no-trunc"])
  if (
    owned.some(
      (item) =>
        current.includes(item.containerId) || item.proxyIds.some((id) => current.includes(id)),
    )
  )
    throw new Error("Recorded owned Docker resources remain.")
  // Docker inherits the image's label into each container, so ownership survives image deletion.
  const labelled = docker(["ps", "-aq", "--filter", `label=dev.solzero.e2e.run=${run.runId}`])
  for (const container of labelled) {
    const [name] = docker(["inspect", "--format", "{{.Name}}", container])
    const proxy = docker(["ps", "-aq", "--filter", `name=^${name}-proxy$`])
    docker(["rm", "-f", container, ...proxy])
  }
  if (docker(["ps", "-aq", "--filter", `label=dev.solzero.e2e.run=${run.runId}`]).length)
    throw new Error("Owned Docker containers remain.")
  const images = docker([
    "image",
    "ls",
    "--filter",
    `label=dev.solzero.e2e.run=${run.runId}`,
    "--format",
    "{{.ID}}",
  ])
  for (const image of new Set(images)) {
    const containers = docker(["ps", "-aq", "--filter", `ancestor=${image}`])
    for (const container of containers) {
      const [name] = docker(["inspect", "--format", "{{.Name}}", container])
      const proxy = docker(["ps", "-aq", "--filter", `name=^${name}-proxy$`])
      docker(["rm", "-f", container, ...proxy])
    }
    docker(["image", "rm", image])
  }
  if (docker(["image", "ls", "--filter", `label=dev.solzero.e2e.run=${run.runId}`, "-q"]).length)
    throw new Error("Owned Docker images remain.")
  return {
    ownedContainers: owned.length,
    ownedProxies: new Set(owned.flatMap((item) => item.proxyIds)).size,
    ownedImages: images.length,
    remainingContainers: 0,
    remainingProxies: 0,
    remainingImages: 0,
  }
}
const TokenList = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      issued_on: Schema.String,
      policies: Schema.Array(
        Schema.Struct({
          effect: Schema.String,
          permission_groups: Schema.Array(Schema.Struct({ name: Schema.String })),
          resources: Schema.Record(Schema.String, Schema.Json),
        }),
      ),
    }),
  ),
  result_info: Schema.Struct({ total_count: Schema.Number }),
})
async function reconcileTokens(run: RunManifest) {
  const createdAt = Date.parse(run.createdAt)
  if (!Number.isFinite(createdAt))
    throw new Error("Cleanup refused an invalid run creation timestamp.")
  const ids = [...run.tokenIds]
  let count = 0
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${run.account}/tokens?per_page=100&page=${page}`,
      {
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (response.status !== 200) throw new Error("Cleanup could not reconcile its token intent.")
    const list = Schema.decodeUnknownSync(TokenList)(await response.json())
    if (!list.success) throw new Error("Token reconciliation failed.")
    for (const token of list.result) {
      if (token.name !== `${run.appName}-dev-ai-gateway-run-${run.runId}`) continue
      const issuedOn = Date.parse(token.issued_on)
      if (!Number.isFinite(issuedOn))
        throw new Error("Cleanup refused an invalid owned token issue timestamp.")
      const policy = token.policies[0]
      const groups = policy?.permission_groups.map((group) => group.name).sort()
      if (
        !/^[a-f0-9]{32}$/.test(token.id) ||
        policy?.resources[`com.cloudflare.api.account.${run.account}`] !== "*" ||
        token.policies.length !== 1 ||
        policy?.effect !== "allow" ||
        JSON.stringify(groups) !== JSON.stringify(["AI Gateway Run", "Workers AI Read"]) ||
        JSON.stringify(Object.keys(policy.resources)) !==
          JSON.stringify([`com.cloudflare.api.account.${run.account}`]) ||
        issuedOn < createdAt - 1000
      )
        throw new Error("Cleanup refused mismatched per-run token metadata.")
      if (!ids.includes(token.id)) ids.push(token.id)
    }
    count += list.result.length
    if (count >= list.result_info.total_count) break
    if (page === 100) throw new Error("Account token inventory exceeded its bounded limit.")
    if (list.result.length === 0) throw new Error("Incomplete account token inventory.")
  }
  const owned = { ...run, tokenIds: ids }
  save(owned)
  return owned
}
async function absent(run: RunManifest, path: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${run.account}/${path}`,
    {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (response.status !== 404)
    throw new Error("Cleanup could not verify an owned remote resource is absent.")
}
export async function cleanRun(run: RunManifest, ownLauncher = false) {
  if (
    run.account !== account ||
    run.profile !== profile ||
    run.ci !== ci ||
    run.appName !== appName ||
    run.gatewayId !== gatewayForRun(run.runId) ||
    !/^[0-9a-f-]{36}$/.test(run.runId)
  )
    throw new Error("Cleanup ownership does not match the selected account/profile/scope.")
  if (ownLauncher && run.launcherPid !== process.pid)
    throw new Error("Cleanup launcher ownership mismatch.")
  if (!ownLauncher) {
    if (run.launcherBirth && run.launcherBirth === processBirth(run.launcherPid)) {
      if (!run.runnerPid || !run.runnerBirth || run.runnerBirth === processBirth(run.runnerPid))
        throw new Error("Cleanup refused an active launcher.")
      // The recorded outer runner died; stop its exact surviving launcher before recovering its payload.
      try {
        process.kill(run.launcherPid, "SIGTERM")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
      for (
        let attempt = 0;
        attempt < 300 && run.launcherBirth === processBirth(run.launcherPid);
        attempt++
      )
        await new Promise((done) => setTimeout(done, 100))
      if (run.launcherBirth === processBirth(run.launcherPid))
        throw new Error("Orphaned launcher did not stop; cleanup retained.")
      if (readRun(run).completedAt) return
    }
  }
  const saved = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(resolve(root, run.runId, "manifest.json"), "utf8")),
  )
  run = saved
  await stopRunProcesses(run)
  run = capture(run)
  run = await reconcileTokens(run)
  if (existsSync(resolve(stackDirectory(run), ".alchemy/state/S0/dev"))) {
    const child = alchemyCommand("destroy", run)
    const code = await new Promise<number | null>((accept, reject) => {
      child.on("exit", accept)
      child.on("error", reject)
    })
    if (code !== 0) throw new Error("Alchemy cleanup failed; ownership receipt retained.")
  }
  const gateway = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${run.account}/ai-gateway/gateways/${run.gatewayId}`,
    {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (gateway.status === 200) {
    const removed = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${run.account}/ai-gateway/gateways/${run.gatewayId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (removed.status !== 200) throw new Error("Owned gateway removal failed.")
  } else if (gateway.status !== 404) throw new Error("Owned gateway status could not be verified.")
  await absent(run, `ai-gateway/gateways/${run.gatewayId}`)
  for (const id of run.tokenIds) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${run.account}/tokens/${id}`,
      {
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (response.status === 200) {
      const removed = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${run.account}/tokens/${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` },
          signal: AbortSignal.timeout(20_000),
        },
      )
      if (removed.status !== 200) throw new Error("Owned token revocation failed.")
    } else if (response.status !== 404) throw new Error("Owned token status could not be verified.")
    await absent(run, `tokens/${id}`)
  }
  const dockerReceipt = cleanDocker(run)
  rmSync(stackDirectory(run), { recursive: true, force: true })
  save({ ...readRun(run), completedAt: new Date().toISOString() })
  removeOwnedPublicationTemps(run)
  const receipt = {
    cleanup: "verified",
    verified: true,
    ...dockerReceipt,
    resourceKinds: run.resources.length,
    revokedTokens: run.tokenIds.length,
    simulatorRemoved: true,
    resourceTypes: run.resources,
  }
  const summaryPath = resolve(repo, ".e2e/cleanup-summary.json")
  const summaries = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : []
  writeFileSync(summaryPath, JSON.stringify([...summaries, receipt]), { mode: 0o600 })
  if (process.env.E2E_MCP_PROTOCOL === "1") console.error(JSON.stringify(receipt))
  else console.log(JSON.stringify(receipt))
}
export async function recoverRuns() {
  await recoverLaunches()
  if (!existsSync(root)) return
  for (const directory of readdirSync(root)) {
    const path = resolve(root, directory, "manifest.json")
    if (!existsSync(path)) continue
    const run = Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(path, "utf8")))
    if (run.profile === profile && run.ci === ci && run.account === account) {
      if (run.completedAt) removeOwnedPublicationTemps(run)
      else await cleanRun(run)
    }
  }
}

export async function waitForOwnLaunchers(runnerPid: number) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const active =
      existsSync(root) &&
      readdirSync(root).some((directory) => {
        const path = resolve(root, directory, "manifest.json")
        if (!existsSync(path)) return false
        const run = Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(path, "utf8")))
        if (run.runnerPid !== runnerPid || run.completedAt) return false
        try {
          process.kill(run.launcherPid, 0)
          return true
        } catch {
          return false
        }
      })
    if (!active) return
    await new Promise((accept) => setTimeout(accept, 100))
  }
}

export const hostedOwnershipScope = {
  repo,
  profile,
  ci,
  appName,
  accountHash: createHash("sha256").update(account).digest("hex"),
  gatewayForRun,
}
export async function restoreVerifiedOwnership(
  pending: readonly import("./hosted-ownership").OwnershipReceipt[],
) {
  for (const item of pending) {
    if (
      item.profile !== profile ||
      item.ci !== ci ||
      item.accountHash !== hostedOwnershipScope.accountHash ||
      item.gatewayId !== gatewayForRun(item.owner) ||
      item.tokenName !== `${appName}-dev-ai-gateway-run-${item.owner}`
    )
      throw new Error("Restored ownership scope mismatch.")
  }
  if (pending.length === 0) {
    await recoverRuns()
    return
  }
  const publicPath = resolve(repo, ".e2e/cleanup-ownership.json")
  const ledger = existsSync(publicPath) ? JSON.parse(readFileSync(publicPath, "utf8")) : []
  // Keep original producer identity when recovery publishes a newer receipt. Older pending
  // evidence is verified live even when a newer archive reports completion or has an empty list.
  publishOwnership(
    [
      ...ledger.filter(
        (item: { owner: string }) => !pending.some((saved) => saved.owner === item.owner),
      ),
      ...pending,
    ],
    pending[0].owner,
  )
  for (const item of pending) {
    const path = resolve(root, item.owner, "manifest.json")
    if (existsSync(path)) continue
    mkdirSync(resolve(root, item.owner, "stack"), { recursive: true, mode: 0o700 })
    // Recover IDs from exact live token name/account/policy, rather than accepting supplied IDs as mutation authority.
    save({
      version: 1,
      runId: item.owner,
      account,
      profile,
      ci,
      appName,
      launcherPid: 0,
      createdAt: item.createdAt,
      gatewayId: item.gatewayId,
      tokenIds: [],
      resources: [],
    })
  }
  await recoverRuns()
}
