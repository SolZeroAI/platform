// Checks that a destroyed pre-<number> stage left nothing behind. Alchemy puts
// the stage in every physical name, so each resource is found by name. The AI
// Search namespace names can be hashed, so those are looked up by their exact
// derived names.
import { readFileSync } from "node:fs"
import { parse } from "jsonc-parser"
import {
  getAiSearchNamespaceName,
  getWorkflowAiSearchNamespaceName,
} from "../packages/infra/src/aiSearch.ts"

const stage = process.env.ALCHEMY_STAGE

if (!/^pre-[1-9][0-9]*$/.test(stage ?? ""))
  throw new Error("Verify requires a canonical pre-<number> stage")

const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN

if (!account || !token) throw new Error("Verify requires Cloudflare credentials")

const profile = process.env.S0_CONFIG_PROFILE ?? ""

if (profile && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile))
  throw new Error("Invalid preview config profile")

const config = parse(readFileSync(`config/${profile ? `${profile}-` : ""}pre.config.jsonc`, "utf8"))
const appName = config.deployment.appName

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName)) throw new Error("Invalid preview application name")

const named = new RegExp(`(^|[-_])${stage}([-_]|$)`)

function cloudflare(path, query = {}) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/${path}?${new URLSearchParams(query)}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  )
}

// Each list API pages its own way: page numbers, a cursor or a page token.
async function list(path, query = {}, rows = (result) => result, next = byPage) {
  const found = []
  let cursor = {}

  for (let page = 1; page <= 50; page++) {
    const response = await cloudflare(path, {
      per_page: "100",
      ...query,
      ...cursor,
      page: String(page),
    })

    if (!response.ok) throw new Error(`Cloudflare ${path} returned HTTP ${response.status}`)
    const data = await response.json()
    const result = rows(data.result) ?? []
    found.push(...result)
    cursor = next(data, result)

    if (!cursor) return found
  }

  throw new Error(`Cloudflare ${path} has more than 50 pages`)
}

function byPage(data, result) {
  return result.length < 100 ? undefined : {}
}

function byToken(key, param) {
  return (data) => (data.result_info?.[key] ? { [param]: data.result_info[key] } : undefined)
}

const once = () => undefined

async function remaining() {
  const left = []

  const lists = [
    ["worker", "workers/scripts", {}, undefined, once, "id"],
    ["durable object", "workers/durable_objects/namespaces", {}, undefined, byPage, "script"],
    [
      "container",
      "containers/applications",
      {},
      undefined,
      byToken("next_page_token", "page_token"),
      "name",
    ],
    ["d1", "d1/database", { name: `${appName}-db-${stage}` }, undefined, byPage, "name"],
    [
      "r2",
      "r2/buckets",
      { name_contains: stage },
      (result) => result.buckets,
      byToken("cursor", "cursor"),
      "name",
    ],
    ["kv", "storage/kv/namespaces", {}, undefined, byPage, "title"],
    ["workflow", "workflows", {}, undefined, byPage, "name"],
    ["ai gateway", "ai-gateway/gateways", {}, undefined, byPage, "id"],
    ["api token", "tokens", {}, undefined, byPage, "name"],
  ]

  for (const [kind, path, query, rows, next, field] of lists)
    for (const row of await list(path, query, rows, next))
      if (named.test(row[field] ?? "")) left.push(`${kind} ${row[field]}`)

  for (const store of await list("secrets_store/stores"))
    for (const secret of await list(`secrets_store/stores/${store.id}/secrets`))
      if (named.test(secret.name ?? "")) left.push(`secret ${secret.name}`)

  for (const name of [getAiSearchNamespaceName, getWorkflowAiSearchNamespaceName].map((derive) =>
    derive({ appName, stageName: stage }),
  )) {
    const response = await cloudflare(`ai-search/namespaces/${name}`)

    if (response.ok) left.push(`ai search namespace ${name}`)
    else if (response.status !== 404)
      throw new Error(`Cloudflare AI Search lookup returned HTTP ${response.status}`)
  }

  return left
}

// Container applications delete asynchronously, and lists can lag a delete.
const deadline = Date.now() + 120_000
let left = await remaining()

while (left.length > 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  left = await remaining()
}

if (left.length > 0) {
  for (const resource of left) console.error(`Still present: ${resource}`)
  throw new Error(`Preview ${stage} cleanup left ${left.length} resources`)
}

console.log(`Verified that no ${stage} resources remain`)
