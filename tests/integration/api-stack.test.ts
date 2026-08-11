import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Test from "alchemy/Test/Vitest"
import * as Effect from "effect/Effect"
import { expect } from "vitest"
import { S0_CONFIG_KEYS } from "../../packages/api/src/server/background/db/s0-config"
import { hashToken } from "../../packages/api/src/server/background/auth/crypto"
import { AI_SEARCH_SOURCE_HEADER } from "../../packages/api/src/server/background/session/mcp-config"
import {
  s0ApiRequest,
  s0ApiRequestWhenReady,
  createS0AlchemyTestOptions,
  makeS0ApiTestResources,
  setS0AlchemyTestEnv,
} from "../../packages/infra/src/testing"
import { createLitellmModelRegistry } from "./litellm-env-fixture"

const MCP_ACCEPT_HEADER = "application/json, text/event-stream"
const MCP_PROTOCOL_VERSION = "2025-03-26"
const AI_SEARCH_TEST_SOURCE_ID = "product-docs"
const TEST_BETTER_AUTH_SECRET = "u7Qm9Kx2Vp8Ls4Nr6Tb1Wd5Yc3Hf0ZaE"
const TEST_SESSION_TOKEN = "test-user-session-token"

setS0AlchemyTestEnv()

const testOptions = createS0AlchemyTestOptions()
const { test } = Test.make(testOptions)

interface ApiStackOutput {
  readonly agentResources?: {
    readonly s0Config?: {
      readonly accountId?: string
      readonly namespaceId?: string
    }
    readonly db?: {
      readonly accountId?: string
      readonly databaseId?: string
    }
    readonly repoCache?: {
      readonly accountId?: string
      readonly namespaceId?: string
    }
  }
  readonly api?: {
    readonly durableObjectNamespaces?: Record<string, string>
    readonly url?: string
  }
  readonly agentContainers?: {
    readonly opencode?: { readonly className?: string }
    readonly codex?: { readonly className?: string }
    readonly claudeCode?: { readonly className?: string }
  }
  readonly agentContainerApplications?: {
    readonly opencode?: object
    readonly codex?: object
    readonly claudeCode?: object
  }
}

interface JsonRpcResultMessage {
  readonly jsonrpc: "2.0"
  readonly id?: number | string | null
  readonly result?: Record<string, unknown>
  readonly error?: {
    readonly code?: number
    readonly message?: string
  }
}

test.provider(
  "serves the API integration suite with locally emulated Cloudflare resources",
  (stack) =>
    Effect.gen(function* () {
      const output = yield* stack.deploy(makeLocallySeededS0ApiTestResources())
      const apiOutput = output as ApiStackOutput

      yield* Effect.promise(() => expectApiReference(apiOutput))
      yield* Effect.promise(() => expectDocsMcp(apiOutput))
      yield* Effect.promise(() => expectUnauthenticatedRequests(apiOutput))
      yield* Effect.promise(() => expectExplicitCredentialPrecedence(apiOutput))
      yield* Effect.promise(() => expectReposApi(apiOutput))
      yield* Effect.promise(() => expectWorkflowsApi(apiOutput))
      yield* Effect.promise(() => expectAdminApi(apiOutput))
      yield* Effect.promise(() => expectSessionsApi(apiOutput))
    }),
  { timeout: 240_000 },
)

function makeLocallySeededS0ApiTestResources() {
  return Effect.gen(function* () {
    const resources = yield* makeS0ApiTestResources(testOptions)
    const SeedControlPlaneFixture = Alchemy.Action(
      "SeedControlPlaneFixture",
      Effect.gen(function* () {
        const db = yield* Cloudflare.D1.QueryDatabase(resources.agentResources.db)
        const s0Config = yield* Cloudflare.KV.ReadWriteNamespace(resources.agentResources.s0Config)
        const repoCache = yield* Cloudflare.KV.ReadWriteNamespace(
          resources.agentResources.repoCache,
        )

        return Effect.fn(function* (_input: {
          readonly databaseId: string
          readonly s0ConfigNamespaceId: string
          readonly repoCacheNamespaceId: string
          readonly fixtureVersion: number
        }) {
          yield* seedControlPlaneFixture(db, s0Config, repoCache)
          return { seeded: true }
        })
      }).pipe(
        Effect.provide(Cloudflare.D1.QueryDatabaseLocal),
        Effect.provide(Cloudflare.KV.ReadWriteNamespaceLocal),
      ),
    )

    yield* SeedControlPlaneFixture({
      databaseId: resources.agentResources.db.databaseId,
      s0ConfigNamespaceId: resources.agentResources.s0Config.namespaceId,
      repoCacheNamespaceId: resources.agentResources.repoCache.namespaceId,
      fixtureVersion: 1,
    })

    return resources
  })
}

async function expectText(response: Response, status: number) {
  const body = await response.clone().text()
  expect(response.status, body).toBe(status)
  return body
}

async function expectJson<T>(response: Response, status: number): Promise<T> {
  const body = await expectText(response, status)
  return JSON.parse(body) as T
}

function deployedApiUrl(output: ApiStackOutput) {
  return output.api?.url
}

async function expectApiReference(output: ApiStackOutput) {
  const apiUrl = deployedApiUrl(output)

  expect(output.agentContainers?.opencode?.className).toBe("OpenCodeAgentContainer")
  expect(output.agentContainers?.codex?.className).toBe("CodexAgentContainer")
  expect(output.agentContainers?.claudeCode?.className).toBe("ClaudeCodeAgentContainer")
  expect(output.api?.durableObjectNamespaces).toMatchObject({
    OpenCodeAgentContainer: expect.any(String),
    CodexAgentContainer: expect.any(String),
    ClaudeCodeAgentContainer: expect.any(String),
  })
  expect(output.api?.durableObjectNamespaces).not.toHaveProperty("Sandbox")
  expect(output.agentContainerApplications).toMatchObject({
    opencode: expect.any(Object),
    codex: expect.any(Object),
    claudeCode: expect.any(Object),
  })

  const openApiResponse = await s0ApiRequestWhenReady(apiUrl, "/openapi.json")
  await expectText(openApiResponse, 200)
  const openApi = (await openApiResponse.json()) as {
    readonly openapi?: string
    readonly paths?: Record<string, unknown>
  }

  expect(openApi.openapi).toBe("3.1.0")
  expect(openApi.paths?.["/workflows"]).toBeDefined()
  expect(openApi.paths?.["/sessions/run"]).toBeDefined()
  expect(openApi.paths?.["/sessions/run/isolate"]).toBeUndefined()
  expect(openApi.paths?.["/sessions/run/sandbox"]).toBeUndefined()

  const referenceResponse = await s0ApiRequestWhenReady(apiUrl, "/reference")
  const referenceHtml = await expectText(referenceResponse, 200)
  expect(referenceHtml).toContain("scalar")
}

async function expectDocsMcp(output: ApiStackOutput) {
  const headers = await initializeMcpSession(output.api?.url)
  const listedTools = await postMcpMessage(
    output.api?.url,
    {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    },
    headers,
  )

  expect(listedTools.response.status).toBe(200)
  expect(listedTools.messages).toEqual([
    expect.objectContaining({
      id: 2,
      jsonrpc: "2.0",
      result: expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining("Search Product Docs"),
            name: "search_product_docs",
          }),
          expect.objectContaining({
            description: expect.stringContaining("Search Product Docs"),
            name: "ask_product_docs",
          }),
        ]),
      }),
    }),
  ])
}

async function expectUnauthenticatedRequests(output: ApiStackOutput) {
  const apiUrl = deployedApiUrl(output)

  const workflowsResponse = await s0ApiRequestWhenReady(apiUrl, "/workflows?limit=1&offset=0")
  const workflowsBody = await expectText(workflowsResponse, 401)
  expect(workflowsBody).toContain("Unauthorized")

  const spoofedIdentityResponse = await s0ApiRequestWhenReady(
    apiUrl,
    "/workflows?limit=1&offset=0",
    {
      headers: { "x-user-id": "user_1", "x-okta-user-id": "okta_1" },
    },
  )
  await expectText(spoofedIdentityResponse, 401)

  const genericBearerResponse = await s0ApiRequestWhenReady(apiUrl, "/workflows?limit=1&offset=0", {
    headers: { Authorization: "Bearer legacy-internal-token" },
  })
  await expectText(genericBearerResponse, 401)

  const webhookResponse = await s0ApiRequest(apiUrl, "/workflows/webhooks/missing", {
    body: JSON.stringify({ ok: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const webhookBody = await expectText(webhookResponse, 404)
  expect(webhookBody).toContain("Workflow webhook not found")
}

async function expectExplicitCredentialPrecedence(output: ApiStackOutput) {
  const cookie = await userSessionCookie()
  const unsupportedBearerResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/workflows?limit=1&offset=0",
    {
      headers: {
        Authorization: "Bearer stale-client-token",
        Cookie: cookie,
      },
    },
  )
  await expectText(unsupportedBearerResponse, 401)

  const invalidApiKeyResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/workflows?limit=1&offset=0",
    {
      headers: {
        Authorization: `Bearer oiak_deadbeef_${"0".repeat(48)}`,
        Cookie: cookie,
      },
    },
  )
  await expectText(invalidApiKeyResponse, 401)
}

async function expectWorkflowsApi(output: ApiStackOutput) {
  const headers = authorizedHeaders("user_1")

  const listResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/workflows?limit=10&offset=0&q=slack&status=active&sortBy=name&sortDir=asc",
    { headers },
  )
  const listBody = await expectJson<{
    readonly workflows: readonly { readonly id: string; readonly name: string }[]
    readonly total: number
    readonly hasMore: boolean
  }>(listResponse, 200)
  expect(listBody).toMatchObject({
    hasMore: false,
    total: 1,
    workflows: [{ id: "wf_1", name: "Slack workflow" }],
  })

  const artifactResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/workflows/wf_1/runs/wfr_1/artifacts/save",
    { headers },
  )
  const artifactBody = await expectJson<{
    readonly artifact: {
      readonly binding: string
      readonly content: unknown
      readonly key: string
      readonly nodeId: string
      readonly storageType: string
    }
  }>(artifactResponse, 200)
  expect(artifactBody.artifact).toMatchObject({
    binding: "REPOS_CACHE",
    content: { alertId: "alert_1", status: "firing" },
    key: "workflow-outputs/wf_1/wfr_1/save.json",
    nodeId: "save",
    storageType: "kv",
  })

  const deleteResponse = await s0ApiRequest(output.api?.url, "/workflows/wf_1/runs/wfr_delete", {
    headers,
    method: "DELETE",
  })
  await expectJson(deleteResponse, 200).then((body) =>
    expect(body).toEqual({
      runId: "wfr_delete",
      status: "deleted",
      workflowId: "wf_1",
    }),
  )

  const missingRunResponse = await s0ApiRequest(
    output.api?.url,
    "/workflows/wf_1/runs/wfr_missing",
    { headers, method: "DELETE" },
  )
  const missingRunBody = await expectText(missingRunResponse, 404)
  expect(missingRunBody).toContain("Workflow run not found")
}

async function expectReposApi(output: ApiStackOutput) {
  const reposResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/repos?owner=example-org&perPage=10",
    {
      headers: authorizedHeaders("user_1"),
    },
  )
  const reposBody = await expectJson<{
    readonly repos: readonly {
      readonly defaultBranch: string
      readonly fullName: string
      readonly name: string
      readonly owner: string
    }[]
    readonly owners: readonly { readonly login: string; readonly type: string }[]
    readonly pagination: { readonly totalCount: number | null; readonly hasMore: boolean }
  }>(reposResponse, 200)

  expect(reposBody).toMatchObject({
    owners: [{ login: "example-org", type: "Organization" }],
    pagination: { hasMore: false, totalCount: 2 },
    repos: [
      {
        defaultBranch: "main",
        fullName: "example-org/s0",
        name: "s0",
        owner: "example-org",
      },
      {
        defaultBranch: "main",
        fullName: "example-org/docs",
        name: "docs",
        owner: "example-org",
      },
    ],
  })

  const sessionResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/workflows?limit=10&offset=0",
    {
      headers: { Cookie: await userSessionCookie() },
    },
  )
  const sessionBody = await expectJson<{ readonly total: number }>(sessionResponse, 200)
  expect(sessionBody.total).toBe(1)
}

async function expectSessionsApi(output: ApiStackOutput) {
  const headers = authorizedHeaders("user_1")
  const createResponse = await s0ApiRequest(output.api?.url, "/sessions", {
    body: JSON.stringify({
      model: "litellm/gpt-5.4-mini",
      repoName: "s0",
      repoOwner: "example-org",
      sessionKind: "isolate",
      title: "Repo-backed session",
    }),
    headers,
    method: "POST",
  })
  const createBody = await expectJson<{
    readonly sessionId: string
    readonly sessionKind: string
    readonly status: string
  }>(createResponse, 201)
  expect(createBody).toMatchObject({
    sessionKind: "isolate",
    status: "created",
  })
  expect(createBody.sessionId).toEqual(expect.any(String))

  const slackResponse = await s0ApiRequest(output.api?.url, "/sessions/slack", {
    body: JSON.stringify({
      model: "litellm/gpt-5.4-mini",
      repoName: "docs",
      repoOwner: "example-org",
      sessionKind: "isolate",
      slackUserId: "U123",
      title: "Slack repo-backed session",
    }),
    headers: authorizedHeaders("user_1"),
    method: "POST",
  })
  const slackBody = await expectJson<{
    readonly sessionId: string
    readonly sessionKind: string
    readonly status: string
  }>(slackResponse, 201)
  expect(slackBody).toMatchObject({
    sessionKind: "isolate",
    status: "created",
  })
  expect(slackBody.sessionId).toEqual(expect.any(String))
}

async function expectAdminApi(output: ApiStackOutput) {
  const unauthenticated = await s0ApiRequestWhenReady(output.api?.url, "/admin/summary")
  await expectText(unauthenticated, 401)

  const forbidden = await s0ApiRequestWhenReady(output.api?.url, "/admin/summary", {
    headers: authorizedHeaders("user_1"),
  })
  await expectText(forbidden, 403)

  const adminHeaders = authorizedHeaders("admin_1")
  const summary = await s0ApiRequestWhenReady(output.api?.url, "/admin/summary", {
    headers: adminHeaders,
  })
  const summaryBody = await expectJson<{
    readonly sessions: readonly { readonly status: string; readonly count: number }[]
    readonly workflows: readonly { readonly status: string; readonly count: number }[]
    readonly workflowRuns: readonly { readonly status: string; readonly count: number }[]
  }>(summary, 200)
  expect(summaryBody.sessions).toContainEqual({ count: 2, status: "active" })
  expect(summaryBody.workflows).toContainEqual({ count: 1, status: "active" })
  expect(summaryBody.workflowRuns).toContainEqual({ count: 1, status: "completed" })

  const sessionsResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/admin/sessions?limit=25&offset=0&q=debug&status=active&kind=sandbox&source=web&userId=user_1&repoOwner=example-org&repoName=ai&sortBy=userEmail&sortDir=asc",
    { headers: adminHeaders },
  )
  const sessionsBody = await expectJson<{
    readonly total: number
    readonly sessions: readonly { readonly id: string; readonly userId: string }[]
  }>(sessionsResponse, 200)
  expect(sessionsBody).toMatchObject({
    sessions: [{ id: "session_1", userId: "user_1" }],
    total: 1,
  })

  const workflowsResponse = await s0ApiRequestWhenReady(
    output.api?.url,
    "/admin/workflows?limit=25&offset=0&q=slack&status=active&userId=user_1&sortBy=name&sortDir=asc",
    { headers: adminHeaders },
  )
  const workflowsBody = await expectJson<{
    readonly total: number
    readonly workflows: readonly {
      readonly id: string
      readonly userId: string
      readonly webhookPath: string
    }[]
  }>(workflowsResponse, 200)
  expect(workflowsBody).toMatchObject({
    total: 1,
    workflows: [{ id: "wf_1", userId: "user_1", webhookPath: "/workflows/webhooks/wh_1" }],
  })
}

function authorizedHeaders(userId: string): HeadersInit {
  return {
    "x-api-key": apiKeyForUser(userId),
    "Content-Type": "application/json",
  }
}

function apiKeyForUser(userId: string): string {
  return `oiak_${userId === "admin_1" ? "aaaaaaaa" : "11111111"}_${"b".repeat(48)}`
}

function seedControlPlaneFixture(
  db: Cloudflare.D1.QueryDatabaseClient,
  s0Config: Cloudflare.KV.ReadWriteNamespaceClient,
  repoCache: Cloudflare.KV.ReadWriteNamespaceClient,
) {
  return Effect.gen(function* () {
    const userApiKey = apiKeyForUser("user_1")
    const adminApiKey = apiKeyForUser("admin_1")
    const userApiKeyHash = yield* hashToken(userApiKey)
    const adminApiKeyHash = yield* hashToken(adminApiKey)

    yield* Effect.forEach(
      [
        {
          sql: `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: [
            "admin_1",
            "Admin",
            "admin@example.test",
            1,
            "2026-06-18T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO "user_api_keys" ("key_id", "user_id", "label", "key_hash", "created_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: ["11111111", "user_1", "Integration test", userApiKeyHash, 1, 1],
        },
        {
          sql: `INSERT INTO "user_api_keys" ("key_id", "user_id", "label", "key_hash", "created_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: ["aaaaaaaa", "admin_1", "Integration test", adminApiKeyHash, 1, 1],
        },
        {
          sql: `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: [
            "user_1",
            "User One",
            "user.one@example.test",
            1,
            "2026-06-18T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: [
            "user_2",
            "User Two",
            "user.two@example.test",
            1,
            "2026-06-18T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO "account" ("id", "userId", "accountId", "providerId", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: [
            "slack_account_1",
            "user_1",
            "U123",
            "slack",
            "2026-06-18T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          params: [
            "better_auth_session_1",
            "user_1",
            TEST_SESSION_TOKEN,
            "2030-01-01T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
            "2026-06-18T00:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO "sessions" ("id", "user_id", "title", "repo_owner", "repo_name", "model", "session_kind", "source", "status", "created_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          params: [
            "session_1",
            "user_1",
            "Debug session",
            "example-org",
            "ai",
            "litellm/gpt-5.4-mini",
            "sandbox",
            "web",
            "active",
            1,
            2,
          ],
        },
        {
          sql: `INSERT INTO "sessions" ("id", "user_id", "title", "repo_owner", "repo_name", "model", "session_kind", "source", "status", "created_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          params: [
            "session_2",
            "user_2",
            "Other session",
            "example-org",
            "ai",
            "litellm/gpt-5.4-mini",
            "sandbox",
            "web",
            "active",
            1,
            2,
          ],
        },
        {
          sql: `INSERT INTO "workflows" ("id", "user_id", "name", "status", "manifest_version", "manifest_key", "code_key", "webhook_id", "created_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
          params: [
            "wf_1",
            "user_1",
            "Slack workflow",
            "active",
            2,
            "user_1/workflows/wf_1/v2/manifest.json",
            "user_1/workflows/wf_1/v2/workflow.js",
            "wh_1",
            1,
            2,
          ],
        },
        workflowRunInsert("wfr_1", "completed", {
          outputs: {
            save: {
              key: "workflow-outputs/wf_1/wfr_1/save.json",
              namespace: "REPOS_CACHE",
            },
          },
        }),
        workflowRunInsert("wfr_delete", "completed", {}),
        {
          sql: `INSERT INTO "workflow_run_events" ("id", "workflow_id", "run_id", "sequence", "node_id", "event_type", "level", "message", "data_json", "created_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
          params: [
            "wfe_1",
            "wf_1",
            "wfr_1",
            6,
            "save",
            "node_completed",
            "info",
            "Save to KV completed",
            JSON.stringify({
              nodeType: "kv-put",
              result: {
                outputs: {
                  key: "workflow-outputs/wf_1/wfr_1/save.json",
                  namespace: "REPOS_CACHE",
                },
              },
            }),
            4,
          ],
        },
      ],
      ({ sql, params }) =>
        db
          .prepare(sql)
          .bind(...params)
          .run(),
      { concurrency: 1, discard: true },
    )

    yield* repoCache.put(
      "user_1/workflow-outputs/wf_1/wfr_1/save.json",
      JSON.stringify({ alertId: "alert_1", status: "firing" }, null, 2),
    )
    yield* s0Config.put(
      S0_CONFIG_KEYS.aiSearch.source(AI_SEARCH_TEST_SOURCE_ID),
      JSON.stringify({
        id: AI_SEARCH_TEST_SOURCE_ID,
        label: "Product Docs",
        description: "Product documentation",
        enabled: true,
        maxResults: 5,
        dataSource: {
          type: "r2",
          bucketName: "s0-alchemy-test-ai-search-content-test",
          prefix: null,
          r2Jurisdiction: null,
        },
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    yield* s0Config.put(
      S0_CONFIG_KEYS.aiProviders.litellmModels,
      JSON.stringify(
        createLitellmModelRegistry({
          baseUrl: "https://litellm.example.test",
        }),
      ),
    )
  })
}

function workflowRunInsert(id: string, status: string, output: Record<string, unknown>) {
  return {
    sql: `INSERT INTO "workflow_runs" ("id", "workflow_id", "workflow_version", "workflow_instance_id", "user_id", "trigger_kind", "trigger_node_id", "status", "input_json", "output_json", "started_at", "completed_at", "updated_at") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    params: [
      id,
      "wf_1",
      2,
      null,
      "user_1",
      "webhook",
      "webhook",
      status,
      JSON.stringify({ trigger: { kind: "webhook" } }),
      JSON.stringify(output),
      1,
      3,
      3,
    ],
  }
}

async function userSessionCookie(): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(TEST_SESSION_TOKEN),
  )
  const signedToken = `${TEST_SESSION_TOKEN}.${btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )}`
  return `better-auth.session_token=${signedToken}`
}

function mcpHeaders(extraHeaders?: HeadersInit): Headers {
  return new Headers({
    accept: MCP_ACCEPT_HEADER,
    "content-type": "application/json",
    [AI_SEARCH_SOURCE_HEADER]: AI_SEARCH_TEST_SOURCE_ID,
    ...extraHeaders,
  })
}

async function postMcpMessage(
  apiUrl: string | undefined,
  body: Record<string, unknown>,
  headers?: HeadersInit,
  whenReady = false,
) {
  const init = {
    body: JSON.stringify(body),
    headers: mcpHeaders(headers),
    method: "POST",
  }
  const response = await (whenReady
    ? s0ApiRequestWhenReady(apiUrl, "/mcp", init, { retryNotFound: false })
    : s0ApiRequest(apiUrl, "/mcp", init))

  return {
    response,
    messages: await readMcpMessages(response),
  }
}

async function initializeMcpSession(apiUrl: string | undefined) {
  const initialize = await postMcpMessage(
    apiUrl,
    {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: {
          name: "alchemy-vitest",
          version: "1.0.0",
        },
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
    },
    undefined,
    true,
  )

  expect(initialize.response.status).toBe(200)
  expect(initialize.messages).toEqual([
    expect.objectContaining({
      id: 1,
      jsonrpc: "2.0",
      result: expect.objectContaining({
        protocolVersion: expect.any(String),
        serverInfo: expect.objectContaining({
          name: "s0-ai-search",
        }),
      }),
    }),
  ])

  const protocolVersion =
    (initialize.messages[0]?.result?.protocolVersion as string | undefined) ?? MCP_PROTOCOL_VERSION
  const headers: Record<string, string> = {
    [AI_SEARCH_SOURCE_HEADER]: AI_SEARCH_TEST_SOURCE_ID,
    "MCP-Protocol-Version": protocolVersion,
  }

  const sessionId = initialize.response.headers.get("mcp-session-id")
  if (sessionId) {
    headers["mcp-session-id"] = sessionId
  }

  const initialized = await postMcpMessage(
    apiUrl,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    headers,
  )

  expect([200, 202, 204]).toContain(initialized.response.status)

  return headers
}

async function readMcpMessages(response: Response): Promise<JsonRpcResultMessage[]> {
  const text = await response.text()
  if (!text) {
    return []
  }

  if (response.headers.get("content-type")?.includes("application/json")) {
    return [JSON.parse(text) as JsonRpcResultMessage]
  }

  const messages: JsonRpcResultMessage[] = []
  for (const chunk of text.split("\n\n")) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    if (!lines.includes("event: message")) {
      continue
    }

    const data = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n")
      .trim()

    if (data) {
      messages.push(JSON.parse(data) as JsonRpcResultMessage)
    }
  }

  return messages
}
