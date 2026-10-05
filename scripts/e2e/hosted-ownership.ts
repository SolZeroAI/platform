/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- Immutable GitHub ownership artifact verification before guarded recovery. */
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import * as Schema from "effect/Schema"
import { hostedOwnershipScope, restoreVerifiedOwnership } from "./lifecycle"
const { repo, profile, ci, accountHash, appName, gatewayForRun } = hostedOwnershipScope
const PublicOwnership = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  repository: Schema.String,
  run: Schema.String,
  attempt: Schema.String,
  profile: Schema.String,
  ci: Schema.Boolean,
  accountHash: Schema.String,
  owner: Schema.String,
  createdAt: Schema.String,
  gatewayId: Schema.String,
  tokenName: Schema.String,
  tokenIds: Schema.Array(Schema.String),
  completed: Schema.Boolean,
})
export type OwnershipReceipt = Schema.Schema.Type<typeof PublicOwnership>
type OwnershipEvidence = { run: string; attempt: string; rows: readonly OwnershipReceipt[] }
const decodeOwnership = Schema.decodeUnknownSync(Schema.Array(PublicOwnership))
function githubApi(path: string) {
  const result = spawnSync("gh", ["api", path], { maxBuffer: 16_777_216, timeout: 60_000 })
  if (result.error || result.signal || result.status !== 0)
    throw new Error("Cannot verify hosted ownership provenance.")
  return result.stdout
}
function completedAttempt(repository: string, run: string, attempt: string) {
  if (!/^[1-9][0-9]*$/.test(run) || !/^[1-9][0-9]*$/.test(attempt))
    throw new Error("Invalid hosted producer identity.")
  const producer = JSON.parse(
    githubApi(`repos/${repository}/actions/runs/${run}/attempts/${attempt}`).toString("utf8"),
  )
  if (
    producer.status !== "completed" ||
    producer.path !== ".github/workflows/validate.yml" ||
    producer.repository?.full_name !== repository ||
    String(producer.id) !== run ||
    String(producer.run_attempt) !== attempt ||
    !Number.isFinite(Date.parse(producer.created_at))
  )
    throw new Error("Cleanup refused an active or unrelated hosted attempt.")
  return producer
}
function downloadOwnership(repository: string, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid hosted artifact identity.")
  mkdirSync(resolve(repo, ".e2e"), { recursive: true, mode: 0o700 })
  const archive = resolve(repo, `.e2e/ownership-recovery-${randomUUID()}.zip`)
  writeFileSync(archive, githubApi(`repos/${repository}/actions/artifacts/${id}/zip`), {
    mode: 0o600,
  })
  try {
    const unzipped = spawnSync("unzip", ["-p", archive, "cleanup-ownership.json"], {
      maxBuffer: 1_048_576,
      encoding: "utf8",
      timeout: 10_000,
    })
    if (unzipped.error || unzipped.signal || unzipped.status !== 0)
      throw new Error("Cannot verify hosted resource metadata.")
    return [...decodeOwnership(JSON.parse(unzipped.stdout))]
  } finally {
    rmSync(archive, { force: true })
  }
}
function artifactPage(repository: string, page: number, run?: string) {
  const prefix = run ? `actions/runs/${run}/artifacts` : "actions/artifacts"
  const response = JSON.parse(
    githubApi(`repos/${repository}/${prefix}?per_page=100&page=${page}`).toString("utf8"),
  )
  if (!Array.isArray(response.artifacts) || !Number.isSafeInteger(response.total_count))
    throw new Error("Cannot inspect complete hosted artifact inventory.")
  return response
}

export async function restoreHostedOwnership(
  file: string,
  evidence?: readonly OwnershipEvidence[],
) {
  const requested = decodeOwnership(JSON.parse(readFileSync(file, "utf8")))
  const repository = process.env.GITHUB_REPOSITORY ?? "SolZeroAI/platform"
  // Validate every receipt before restoring any deletion intent. Never trust arbitrary IDs in an artifact.
  for (const item of requested.filter((item) => !item.completed)) {
    if (
      item.repository !== repository ||
      item.profile !== profile ||
      item.ci !== ci ||
      item.accountHash !== accountHash ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.owner) ||
      item.gatewayId !== gatewayForRun(item.owner) ||
      item.tokenName !== `${appName}-dev-ai-gateway-run-${item.owner}` ||
      !Number.isFinite(Date.parse(item.createdAt))
    )
      throw new Error("Hosted ownership scope mismatch.")
    const origin = completedAttempt(repository, item.run, item.attempt)
    if (Date.parse(item.createdAt) < Date.parse(origin.created_at))
      throw new Error("Hosted ownership predates its producer.")
    let savedEvidence = evidence
    if (!savedEvidence) {
      const artifacts = artifactPage(repository, 1, item.run)
      if (artifacts.total_count > 100)
        throw new Error("Hosted artifact inventory exceeds recovery bound.")
      const artifact = artifacts.artifacts.find(
        (artifact: { name: string; expired: boolean }) =>
          [
            `solzero-cleanup-ownership-${item.run}-${item.attempt}`,
            // Explicit manual recovery may use a historical diagnostic archive containing this exact file.
            `solzero-e2e-${item.run}-${item.attempt}`,
          ].includes(artifact.name) && !artifact.expired,
      )
      if (!artifact) throw new Error("Exact hosted ownership artifact is unavailable.")
      savedEvidence = [
        { run: item.run, attempt: item.attempt, rows: downloadOwnership(repository, artifact.id) },
      ]
    }
    const source = savedEvidence.find((entry) =>
      entry.rows.some((saved) => JSON.stringify(saved) === JSON.stringify(item)),
    )
    if (!source) throw new Error("Ownership receipt differs from immutable hosted evidence.")
    completedAttempt(repository, source.run, source.attempt)
  }
  await restoreVerifiedOwnership(requested.filter((item) => !item.completed))
}

export async function recoverHostedOwnership() {
  const repository = process.env.GITHUB_REPOSITORY
  if (!ci || !repository || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT)
    throw new Error("Automatic hosted recovery requires the current CI producer identity.")
  const evidence: OwnershipEvidence[] = []
  let inspected = 0
  let exhausted = false
  // Dedicated ownership archives are bounded separately from diagnostic archives. Never auto-import legacy reports.
  for (let page = 1; page <= 100; page++) {
    const inventory = artifactPage(repository, page)
    for (const artifact of inventory.artifacts) {
      const match = /^solzero-cleanup-ownership-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(artifact.name)
      if (!match || artifact.expired) continue
      const [, run, attempt] = match
      if (run === process.env.GITHUB_RUN_ID && attempt === process.env.GITHUB_RUN_ATTEMPT) continue
      if (String(artifact.workflow_run?.id) !== run)
        throw new Error("Ownership archive producer mismatch.")
      // An active producer may still own resources; leave its archive for a later completed-run recovery.
      const metadata = JSON.parse(
        githubApi(`repos/${repository}/actions/runs/${run}/attempts/${attempt}`).toString("utf8"),
      )
      if (
        metadata.path !== ".github/workflows/validate.yml" ||
        metadata.repository?.full_name !== repository ||
        String(metadata.id) !== run ||
        String(metadata.run_attempt) !== attempt ||
        !["completed", "queued", "in_progress", "waiting", "pending", "requested"].includes(
          metadata.status,
        )
      )
        throw new Error("Ownership archive attempt metadata mismatch.")
      if (metadata.status !== "completed") continue
      completedAttempt(repository, run, attempt)
      evidence.push({ run, attempt, rows: downloadOwnership(repository, artifact.id) })
      inspected++
    }
    if (page * 100 >= inventory.total_count) {
      exhausted = true
      break
    }
  }
  if (!exhausted) throw new Error("Hosted ownership inventory exceeds recovery bound.")
  const pending = new Map<string, OwnershipReceipt>()
  for (const source of evidence) {
    for (const row of source.rows.filter((row) => !row.completed)) {
      const previous = pending.get(row.owner)
      if (
        previous &&
        [
          "repository",
          "run",
          "attempt",
          "profile",
          "ci",
          "accountHash",
          "createdAt",
          "gatewayId",
          "tokenName",
        ].some(
          (key) => previous[key as keyof OwnershipReceipt] !== row[key as keyof OwnershipReceipt],
        )
      )
        throw new Error("Conflicting hosted ownership receipts.")
      if (!previous) pending.set(row.owner, row)
    }
  }
  // A fresh Linux checkout with no retained archives has not created .e2e yet.
  mkdirSync(resolve(repo, ".e2e"), { recursive: true, mode: 0o700 })
  const file = resolve(repo, ".e2e/hosted-recovery.json")
  writeFileSync(file, JSON.stringify([...pending.values()]), { mode: 0o600 })
  try {
    await restoreHostedOwnership(file, evidence)
  } finally {
    rmSync(file, { force: true })
  }
  const receipt = {
    schemaVersion: 1,
    inspectedArchives: inspected,
    pendingOwners: pending.size,
    verified: true,
  }
  writeFileSync(resolve(repo, ".e2e/hosted-recovery-summary.json"), JSON.stringify(receipt), {
    mode: 0o600,
  })
  console.log(JSON.stringify(receipt))
}
