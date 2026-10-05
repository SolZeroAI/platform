/* oxlint-disable no-console -- Prints only lifecycle decisions and stage identifiers. */
import { appendFileSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
const mode = process.argv[2]
if (!["deploy", "cleanup"].includes(mode)) throw new Error("Unknown preview lifecycle mode")
const repository = process.env.GITHUB_REPOSITORY
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
  throw new Error("Invalid repository identity")
const number = event.pull_request?.number ?? event.number
const stage =
  mode === "cleanup" && process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    ? event.inputs?.stage
    : number
      ? `pre-${number}`
      : "pre"
if (!stage || (stage !== "pre" && !/^pre-[1-9][0-9]*$/.test(stage)))
  throw new Error("Preview stage must be pre or a canonical pre-<PR number>")
if (mode === "cleanup" && stage === "pre") throw new Error("Standing pre cannot be cleaned here")
let permitted = true
if (stage !== "pre") {
  const pullNumber = stage.slice(4)
  const response = spawnSync("gh", ["api", `repos/${repository}/pulls/${pullNumber}`], {
    encoding: "utf8",
  })
  if (response.status !== 0) throw new Error("Cannot verify current preview PR ownership/state")
  const pull = JSON.parse(response.stdout)
  if (
    pull.number !== Number(pullNumber) ||
    pull.head?.repo?.full_name !== repository ||
    pull.base?.repo?.full_name !== repository
  )
    throw new Error("Preview PR ownership does not match this repository")
  permitted =
    mode === "cleanup"
      ? pull.state === "closed"
      : pull.state === "open" && pull.head.sha === event.pull_request?.head?.sha
}
console.log(`${permitted ? "Permit" : "Skip"} ${mode} for ${stage}: current PR lifetime checked`)
appendFileSync(process.env.GITHUB_OUTPUT, `stage=${stage}\npermitted=${permitted}\n`)
