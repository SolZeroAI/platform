/* oxlint-disable no-console -- Reports artifact counts, never private contents. */
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"

const repository = process.env.GITHUB_REPOSITORY
const stage = process.env.ALCHEMY_STAGE
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
  !/^pre-[1-9][0-9]*$/.test(stage ?? "")
)
  throw new Error("Invalid preview ownership scope")
const prefix = `preview-ownership-${stage}-`
const candidates = []
function api(path) {
  const result = spawnSync("gh", ["api", path], { maxBuffer: 1_048_576 })
  if (result.status !== 0) throw new Error("Cannot retrieve preview ownership evidence")
  return result.stdout
}
for (let page = 1; page <= 100; page++) {
  const result = JSON.parse(api(`repos/${repository}/actions/artifacts?per_page=100&page=${page}`))
  candidates.push(
    ...result.artifacts.filter((artifact) => !artifact.expired && artifact.name.startsWith(prefix)),
  )
  if (page * 100 >= result.total_count) break
  if (page === 100) throw new Error("Preview artifact inventory exceeded its limit")
}
const artifact = candidates.sort((a, b) => b.id - a.id)[0]
if (!artifact) {
  console.log("No previous preview ownership evidence to restore")
} else {
  // Only this repository's preview workflow can supply ownership evidence.
  const run = JSON.parse(api(`repos/${repository}/actions/runs/${artifact.workflow_run.id}`))
  if (run.path !== ".github/workflows/preview.yml" || run.repository.full_name !== repository)
    throw new Error("Preview ownership evidence came from another workflow")
  mkdirSync(".e2e", { recursive: true })
  const archive = ".e2e/preview-ownership.zip"
  writeFileSync(archive, api(`repos/${repository}/actions/artifacts/${artifact.id}/zip`), {
    mode: 0o600,
  })
  let parsed
  try {
    const result = spawnSync("unzip", ["-p", archive, `preview-${stage}-ownership.json`], {
      encoding: "utf8",
      maxBuffer: 65_536,
    })
    if (result.status !== 0) throw new Error("Cannot read preview ownership evidence")
    parsed = JSON.parse(result.stdout)
  } finally {
    unlinkSync(archive)
  }
  if (
    !/^[a-f0-9]{64}$/.test(parsed.accountHash ?? "") ||
    parsed.repository !== repository ||
    parsed.stage !== stage ||
    String(parsed.runId) !== String(artifact.workflow_run.id)
  )
    throw new Error("Preview ownership evidence scope mismatch")
  for (const key of ["namespaceIds", "applicationIds", "gatewayIds", "tokenIds"]) {
    if (
      !Array.isArray(parsed[key]) ||
      parsed[key].length > 10 ||
      parsed[key].some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{3,128}$/.test(id))
    )
      throw new Error("Invalid bounded preview resource identifiers")
  }
  if (
    !Array.isArray(parsed.providerSecrets) ||
    parsed.providerSecrets.length > 50 ||
    parsed.providerSecrets.some(
      (item) =>
        !/^[a-zA-Z0-9-]{3,128}$/.test(item.storeId ?? "") ||
        !/^[a-zA-Z0-9-]{3,128}$/.test(item.secretId ?? ""),
    )
  )
    throw new Error("Invalid bounded provider secret identifiers")
  const safe = {
    repository,
    stage,
    runId: process.env.GITHUB_RUN_ID ?? parsed.runId,
    accountHash: parsed.accountHash,
    gatewayIds: parsed.gatewayIds,
    tokenIds: parsed.tokenIds,
    providerSecrets: parsed.providerSecrets.map(({ storeId, secretId }) => ({ storeId, secretId })),
    namespaceIds: parsed.namespaceIds,
    applicationIds: parsed.applicationIds,
  }
  writeFileSync(`.e2e/preview-${stage}-ownership.json`, JSON.stringify(safe), { mode: 0o600 })
  console.log(
    `Restored owned identifiers: ${safe.namespaceIds.length} namespaces, ${safe.applicationIds.length} applications`,
  )
}
