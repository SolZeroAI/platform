import { readFile } from "node:fs/promises"

const marker = "<!-- e2e-ai-usage:v1 -->"

async function main() {
  const summary = JSON.parse(await readFile(".e2e/ai-usage/summary.json", "utf8"))
  if (
    summary.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(summary.validatedSha) ||
    typeof summary.needsComment !== "boolean"
  ) {
    throw new Error("Invalid sanitized AI usage summary.")
  }
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1"
  const token = process.env.GH_TOKEN
  if (!repository || !runId || !token) {
    console.log("AI usage summary saved; PR publishing requires GitHub run context.")
    return
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(runId + attempt)) {
    throw new Error("Invalid GitHub run context.")
  }
  if (
    process.env.E2E_AI_VALIDATED_SHA &&
    process.env.E2E_AI_VALIDATED_SHA !== summary.validatedSha
  ) {
    throw new Error("AI usage summary does not match the validated commit.")
  }
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    // Never print response bodies; permissions and HTTP status are sufficient.
    if (!response.ok) throw new Error(`PR usage API request failed (HTTP ${response.status}).`)
    return response.status === 204 ? null : response.json()
  }
  let event = {}
  if (process.env.GITHUB_EVENT_PATH) {
    event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
  }
  const candidates = event.pull_request
    ? [event.pull_request]
    : await api(`commits/${summary.validatedSha}/pulls?per_page=100`)
  const pullRequests = candidates.filter(
    (pr) =>
      pr.state === "open" &&
      Number.isSafeInteger(pr.number) &&
      pr.head?.repo?.full_name === repository &&
      pr.base?.repo?.full_name === repository &&
      pr.head.sha === summary.validatedSha,
  )
  if (!pullRequests.length) {
    console.log("AI usage summary saved; no current same-repository PR matches this commit.")
    return
  }
  const markdown = await readFile(".e2e/ai-usage/summary.md", "utf8")
  if (markdown.length > 40_000 || !markdown.startsWith("### E2E AI usage")) {
    throw new Error("Invalid generated AI usage comment.")
  }
  const metadata = `<!-- e2e-ai-run:${runId}:${attempt}:${summary.validatedSha} -->`
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`
  const body = `${marker}\n${metadata}\n${markdown.trim()}\n\n[CI run](${runUrl}) · Commit \`${summary.validatedSha.slice(0, 7)}\`\n`
  for (const candidate of pullRequests) {
    const number = candidate.number
    const comments = []
    for (let page = 1; page <= 10; page++) {
      const batch = await api(`issues/${number}/comments?per_page=100&page=${page}`)
      comments.push(...batch)
      if (batch.length < 100) break
      if (page === 10) throw new Error("PR comment pagination limit exceeded.")
    }
    const existing = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.user?.type === "Bot" &&
        comment.body?.startsWith(marker),
    )
    // A fully replayed run updates an existing notice, but does not create noise.
    if (!summary.needsComment && !existing) continue
    const previous = existing?.body.match(/<!-- e2e-ai-run:(\d+):(\d+):[a-f0-9]{40} -->/)
    if (
      previous &&
      (BigInt(previous[1]) > BigInt(runId) ||
        (previous[1] === runId && BigInt(previous[2]) > BigInt(attempt)))
    ) {
      console.log(`Skipped PR #${number}: a newer run already reported usage.`)
      continue
    }
    // Recheck immediately before writing so obsolete runs cannot replace results
    // after a new commit or a PR close. Forks never receive elevated publishing.
    const current = await api(`pulls/${number}`)
    if (
      current.state !== "open" ||
      current.head?.repo?.full_name !== repository ||
      current.base?.repo?.full_name !== repository ||
      current.head?.sha !== summary.validatedSha
    ) {
      console.log(`Skipped PR #${number}: its current head no longer matches.`)
      continue
    }
    if (existing) await api(`issues/comments/${existing.id}`, "PATCH", { body })
    else await api(`issues/${number}/comments`, "POST", { body })
    console.log(`Published AI usage for PR #${number}.`)
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error && /^PR usage API request failed \(HTTP \d{3}\)\.$/.test(error.message)
      ? error.message
      : "AI usage publishing failed; check the summary, commit and GitHub permissions.",
  )
  process.exitCode = 1
})
