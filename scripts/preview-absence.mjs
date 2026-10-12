/* oxlint-disable no-console -- Reports bounded owned resource absence. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { parse } from "jsonc-parser"
// Node 24 strips types in this pure naming helper; use the shipping declaration, not duplicate names.
import {
  getAiSearchNamespaceName,
  getWorkflowAiSearchNamespaceName,
} from "../packages/infra/src/aiSearch.ts"

const stage = process.env.ALCHEMY_STAGE
if (!/^pre-[1-9][0-9]*$/.test(stage ?? ""))
  throw new Error("Only canonical PR stages can be verified")
const profile = process.env.S0_CONFIG_PROFILE ?? ""
if (profile && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile))
  throw new Error("Invalid preview config profile")
const config = parse(readFileSync(`config/${profile ? `${profile}-` : ""}pre.config.jsonc`, "utf8"))
const appName = config.deployment.appName
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName)) throw new Error("Invalid preview application name")
const mode = process.argv[2] ?? "verify"
if (!["capture", "verify"].includes(mode)) throw new Error("Unknown absence verification mode")
const ownershipFile = `.e2e/preview-${stage}-ownership.json`
const receiptFile = ".e2e/preview-cleanup-summary.json"
mkdirSync(".e2e", { recursive: true })
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!account || !token) throw new Error("Cloudflare absence verification requires credentials")
async function list(path, select) {
  const items = []
  let cursor
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({ per_page: "100" })
    if (path === "r2/buckets") {
      query.set("name_contains", appName)
      if (cursor) query.set("cursor", cursor)
    } else if (path === "containers/applications") {
      if (cursor) query.set("page_token", cursor)
    } else if (path === "d1/database") {
      query.set("name", `${appName}-db-${stage}`)
      query.set("page", String(page))
    } else query.set("page", String(page))
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/${path}?${query}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!response.ok) throw new Error(`Cloudflare inventory failed (${response.status})`)
    const data = await response.json()
    if (!data.success) throw new Error("Cloudflare inventory failed")
    items.push(...select(data.result))
    if (path === "r2/buckets") {
      const next = data.result_info?.cursor
      if (!next) return items
      if (next === cursor) throw new Error("Cloudflare inventory cursor did not advance")
      cursor = next
    } else if (path === "containers/applications") {
      const next = data.result_info?.next_page_token
      if (!next) return items
      if (next === cursor) throw new Error("Cloudflare application cursor did not advance")
      cursor = next
    } else if (path === "workers/scripts") return items
    else {
      const size = select(data.result).length
      const total = data.result_info?.total_count
      if (typeof total === "number" && items.length >= total) return items
      if (size < 100) return items
      if (!size) throw new Error("Cloudflare inventory pagination did not advance")
    }
  }
  throw new Error("Cloudflare inventory exceeded its bounded pagination limit")
}
const checks = [
  {
    type: "workers",
    path: "workers/scripts",
    select: (result) => result,
    names: [`${appName}-api-${stage}`, `${appName}-web-${stage}`],
    field: "id",
  },
  {
    type: "databases",
    path: "d1/database",
    select: (result) => result,
    names: [`${appName}-db-${stage}`],
    field: "name",
  },
  {
    type: "buckets",
    path: "r2/buckets",
    select: (result) => result.buckets,
    names: ["workflow-artifacts", "skills", "ai-search-content"].map(
      (kind) => `${appName}-${kind}-${stage}`,
    ),
    field: "name",
  },
]
checks.push({
  type: "kv",
  path: "storage/kv/namespaces",
  select: (result) => result,
  names: ["repo-cache", "s0-config", "user-workflow-kv", "wf-sess-resp-cache"].map(
    (kind) => `${appName}-${kind}-${stage}`,
  ),
  field: "title",
})
const workerNames = checks[0].names
async function ownedRuntime() {
  const namespaces = await list("workers/durable_objects/namespaces", (result) => result)
  const ownedNamespaces = namespaces.filter((namespace) => workerNames.includes(namespace.script))
  const applications = await list("containers/applications", (result) => result)
  return { namespaces, ownedNamespaces, applications }
}
if (mode === "capture") {
  const runtime = await ownedRuntime()
  const namespaceIds = runtime.ownedNamespaces.map((namespace) => namespace.id)
  const applicationIds = runtime.applications
    .filter((application) => namespaceIds.includes(application.durable_objects?.namespace_id))
    .map((application) => application.id)
  const gatewayIds = []
  const providerSecrets = []
  for (const worker of workerNames) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/settings`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    )
    if (response.status === 404) continue
    if (!response.ok) throw new Error("Owned Worker binding inventory failed")
    const settings = await response.json()
    if (!settings.success) throw new Error("Owned Worker binding inventory failed")
    const binding = settings.result.bindings?.find(
      (item) => item.name === "AI_GATEWAY_ID" && item.type === "plain_text",
    )
    if (binding?.text) {
      if (binding.text === "default" || !/^[a-zA-Z0-9-]{3,128}$/.test(binding.text))
        throw new Error("Shared or invalid gateway binding is not preview ownership")
      gatewayIds.push(binding.text)
      const store = settings.result.bindings?.find(
        (item) => item.name === "AI_GATEWAY_SECRETS_STORE_ID" && item.type === "plain_text",
      )
      if (store?.text) {
        if (!/^[a-zA-Z0-9-]{3,128}$/.test(store.text))
          throw new Error("Invalid bound secrets store")
        const secrets = await list(`secrets_store/stores/${store.text}/secrets`, (result) => result)
        for (const secret of secrets)
          if (
            secret.name?.startsWith(`${binding.text}_`) &&
            secret.scopes?.includes("ai_gateway")
          ) {
            if (!/^[a-zA-Z0-9-]{3,128}$/.test(secret.id))
              throw new Error("Invalid owned provider secret identifier")
            providerSecrets.push({ storeId: store.text, secretId: secret.id })
          }
      }
    }
  }
  const tokens = await list("tokens", (result) => result)
  const tokenIds = tokens
    .filter((item) => item.name === `${appName}-${stage}-ai-gateway-run`)
    .map((item) => {
      const policy = item.policies?.[0]
      if (
        item.policies?.length !== 1 ||
        policy.effect !== "allow" ||
        JSON.stringify(policy.permission_groups.map((group) => group.name).sort()) !==
          JSON.stringify(["AI Gateway Run", "Workers AI Read"]) ||
        JSON.stringify(Object.keys(policy.resources)) !==
          JSON.stringify([`com.cloudflare.api.account.${account}`]) ||
        policy.resources[`com.cloudflare.api.account.${account}`] !== "*"
      )
        throw new Error("Preview token ownership metadata mismatch")
      return item.id
    })
  const previous = existsSync(ownershipFile)
    ? JSON.parse(readFileSync(ownershipFile, "utf8"))
    : { stage, namespaceIds: [], applicationIds: [], gatewayIds: [], tokenIds: [] }
  if (
    previous.stage !== stage ||
    (previous.accountHash &&
      previous.accountHash !== createHash("sha256").update(account).digest("hex"))
  )
    throw new Error("Preview ownership stage mismatch")
  writeFileSync(
    ownershipFile,
    JSON.stringify({
      repository: process.env.GITHUB_REPOSITORY ?? "SolZeroAI/platform",
      runId: process.env.GITHUB_RUN_ID ?? "local",
      stage,
      accountHash: createHash("sha256").update(account).digest("hex"),
      gatewayIds: [...new Set([...(previous.gatewayIds ?? []), ...gatewayIds])],
      tokenIds: [...new Set([...(previous.tokenIds ?? []), ...tokenIds])],
      providerSecrets: [
        ...new Map(
          [...(previous.providerSecrets ?? []), ...providerSecrets].map((item) => [
            `${item.storeId}/${item.secretId}`,
            item,
          ]),
        ).values(),
      ],
      namespaceIds: [...new Set([...previous.namespaceIds, ...namespaceIds])],
      applicationIds: [...new Set([...previous.applicationIds, ...applicationIds])],
    }),
    { mode: 0o600 },
  )
  writeFileSync(
    receiptFile,
    JSON.stringify({
      verified: false,
      failed: false,
      pending: true,
      ownedNamespaces: namespaceIds.length,
      ownedApplications: applicationIds.length,
    }),
  )
  console.log(
    `Captured owned runtime: ${namespaceIds.length} namespaces, ${applicationIds.length} applications`,
  )
} else {
  const owner = existsSync(ownershipFile)
    ? JSON.parse(readFileSync(ownershipFile, "utf8"))
    : { stage, namespaceIds: [], applicationIds: [], gatewayIds: [], tokenIds: [] }
  if (
    owner.stage !== stage ||
    (owner.accountHash && owner.accountHash !== createHash("sha256").update(account).digest("hex"))
  )
    throw new Error("Preview ownership stage mismatch")
  const remaining = {}
  try {
    for (const check of checks) {
      const resources = await list(check.path, check.select)
      const count = resources.filter((resource) =>
        check.names.includes(resource[check.field]),
      ).length
      remaining[check.type] = count
      console.log(`${check.type}: ${count} owned resources remain`)
      if (count) throw new Error("PR infrastructure cleanup is incomplete")
    }
    const exactPaths = [
      `workflows/${appName}-dynamic-workflow-${stage}`,
      ...[getAiSearchNamespaceName, getWorkflowAiSearchNamespaceName].map(
        (name) => `ai-search/namespaces/${name({ appName, stageName: stage })}`,
      ),
    ]
    remaining.workflows = 0
    remaining.searchNamespaces = 0
    for (const path of exactPaths) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
      )
      if (response.status !== 404)
        throw new Error("Owned workflow or search namespace remains or cannot be verified")
    }
    // Container deletion is asynchronous. Poll exact captured IDs; no other
    // application's name or credentials enter the receipt or deletion scope.
    for (let attempt = 0; attempt < 13; attempt++) {
      const runtime = await ownedRuntime()
      remaining.namespaces = runtime.namespaces.filter(
        (namespace) =>
          workerNames.includes(namespace.script) || owner.namespaceIds.includes(namespace.id),
      ).length
      remaining.applications = runtime.applications.filter(
        (application) =>
          owner.applicationIds.includes(application.id) ||
          owner.namespaceIds.includes(application.durable_objects?.namespace_id),
      ).length
      if (!remaining.namespaces && !remaining.applications) break
      if (attempt === 12) throw new Error("Owned preview runtime remains after deletion deadline")
      await new Promise((done) => setTimeout(done, 10_000))
    }
    for (const [kind, ids, path] of [
      ["gateways", owner.gatewayIds ?? [], "ai-gateway/gateways"],
      ["tokens", owner.tokenIds ?? [], "tokens"],
    ]) {
      remaining[kind] = 0
      for (const id of ids) {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account}/${path}/${id}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
        )
        if (response.status !== 404) {
          remaining[kind] += 1
          throw new Error("Owned preview remote resource remains or cannot be verified")
        }
      }
    }
    remaining.providerSecrets = 0
    for (const secret of owner.providerSecrets ?? []) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/secrets_store/stores/${secret.storeId}/secrets/${secret.secretId}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
      )
      if (response.status !== 404)
        throw new Error("Owned provider secret remains or cannot be verified")
    }
    writeFileSync(
      receiptFile,
      JSON.stringify({ verified: true, failed: false, remaining }, null, 2),
    )
    console.log("Verified owned preview runtime absent")
  } catch (cause) {
    writeFileSync(
      receiptFile,
      JSON.stringify({ verified: false, failed: true, remaining }, null, 2),
    )
    throw cause
  }
}
