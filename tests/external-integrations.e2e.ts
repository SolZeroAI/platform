import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, authErrorCode, authRequest, linkedAuthAccounts, uniqueName } from "./support/api"
import { requireFixture } from "./support/external-fixtures"

test(
  "linked GitHub identity discovers its isolated repository",
  { session: "admin", tags: ["external", "github"] },
  async ({ browser }) => {
    const repo = requireFixture("E2E_GITHUB_REPOSITORY")
    const [, name] = repo.split("/")

    const response = await api<{ repos: Array<{ full_name: string }> }>(
      browser,
      `/repos?q=${encodeURIComponent(name!)}`,
    )

    expect(
      response.repos.some((item) => item.full_name === repo),
      "Link the disposable admin GitHub identity and grant its app access to E2E_GITHUB_REPOSITORY",
    ).toBe(true)
  },
)

test(
  "linked GitHub identity loads account info and an access token by local account id",
  { session: "admin", tags: ["external", "github"] },
  async ({ app, browser, screen }) => {
    requireFixture("E2E_GITHUB_REPOSITORY")
    const listed = await authRequest(browser, "/api/auth/list-accounts")
    expect(listed.status).toBe(200)

    const github = linkedAuthAccounts(listed.payload).find(
      (account) => account.providerId === "github",
    )

    expect(
      github,
      "Link the disposable admin GitHub identity so list-accounts returns a github row",
    ).toBeDefined()

    if (!github) {
      return
    }

    const foreignId = github.accountId === github.id ? uniqueName("foreign") : github.accountId
    const profileLoad = browser.waitForResponse(/\/api\/auth\/account-info\?accountId=/)
    await app.open("/settings?category=api-access")
    const profileResponse = await profileLoad
    expect(profileResponse.status).toBe(200)
    expect(profileResponse.url).toContain(`accountId=${encodeURIComponent(github.id)}`)

    // SAFETY: a 200 account-info response carries the linked account id and login this test reads.
    const profile = (await profileResponse.json()) as {
      account?: { id?: string; accountId?: string }
      data?: { login?: string }
    }

    expect(profile.account?.id).toBe(github.id)
    expect(profile.account?.accountId).toBe(github.accountId)
    expect(profile.data?.login).toBeDefined()
    await expect(screen.getByText(`@${profile.data?.login}`, { exact: true })).toBeVisible()
    await expect(screen.getByRole("button", "Unlink").first()).toBeVisible()

    const missingProfile = await authRequest(
      browser,
      `/api/auth/account-info?accountId=${encodeURIComponent(foreignId)}`,
    )

    expect(missingProfile.status).toBe(400)
    expect(authErrorCode(missingProfile.payload)).toBe("ACCOUNT_NOT_FOUND")

    const token = await authRequest(browser, "/api/auth/get-access-token", "POST", {
      accountId: github.id,
    })

    expect(token.status).toBe(200)
    // SAFETY: a 200 get-access-token payload carries the GitHub access token string this test reads.
    const tokenPayload = token.payload as { accessToken?: string }
    expect(typeof tokenPayload.accessToken).toBe("string")
    expect(tokenPayload.accessToken?.startsWith("ghu_")).toBe(true)

    const missingToken = await authRequest(browser, "/api/auth/get-access-token", "POST", {
      accountId: foreignId,
    })

    expect(missingToken.status).toBe(400)
    expect(authErrorCode(missingToken.payload)).toBe("ACCOUNT_NOT_FOUND")
  },
)

test(
  "configured MCP server appears in settings and executes through an isolate",
  { session: "admin", tags: ["external", "mcpcf"] },
  async ({ app, browser, screen }) => {
    const serverId = requireFixture("E2E_MCPCF_SERVER_ID")
    const instruction = requireFixture("E2E_MCPCF_PROMPT")
    const marker = requireFixture("E2E_MCPCF_EXPECTED_OUTPUT")
    const list = await api<{ servers: Array<{ id: string }> }>(browser, "/sessions/mcpcf/servers")
    expect(
      list.servers.some((item) => item.id === serverId),
      "Enable/configure MCPCF and choose an ID returned by /sessions/mcpcf/servers",
    ).toBe(true)
    await app.open(`/settings?category=agents&tab=mcps&mcpServerId=${encodeURIComponent(serverId)}`)
    await expect(screen.getByLabel("Search MCPs")).toBeVisible()

    const result = await api<{ sessionId: string; status: string; output: string }>(
      browser,
      "/sessions/run",
      "POST",
      {
        title: uniqueName("e2e-mcp"),
        agentRuntime: "isolate",
        tools: [{ kind: "mcpcf_server", serverId }],
        content: instruction,
      },
    )

    try {
      expect(result.status).toBe("completed")
      expect(result.output).toContain(marker)
    } finally {
      await api(browser, `/sessions/${result.sessionId}`, "DELETE")
    }
  },
)

test(
  "AI Search retrieves a seeded document through the session tool",
  { session: "admin", tags: ["external", "ai-search"] },
  async ({ browser }) => {
    const sourceId = requireFixture("E2E_AI_SEARCH_SOURCE_ID")
    const query = requireFixture("E2E_AI_SEARCH_QUERY")
    const marker = requireFixture("E2E_AI_SEARCH_EXPECTED_OUTPUT")

    const sources = await api<{ sources: Array<{ id: string }> }>(
      browser,
      "/sessions/ai-search/sources",
    )

    expect(
      sources.sources.some((source) => source.id === sourceId),
      "Seed and enable the source in Admin > AI Search; use the listed source ID",
    ).toBe(true)

    const result = await api<{ sessionId: string; status: string; output: string }>(
      browser,
      "/sessions/run",
      "POST",
      {
        title: uniqueName("e2e-search"),
        agentRuntime: "isolate",
        tools: [{ kind: "ai_search", sourceId }],
        content: `Use the AI Search source to answer this question from the indexed documents: ${query}`,
      },
    )

    try {
      expect(result.status).toBe("completed")
      expect(result.output).toContain(marker)
    } finally {
      await api(browser, `/sessions/${result.sessionId}`, "DELETE")
    }
  },
)

test(
  "linked Slack fixture creates and opens an isolated Slack session",
  { session: "admin", tags: ["external", "slack"] },
  async ({ app, browser, screen }) => {
    const slackUserId = requireFixture("E2E_SLACK_USER_ID")
    const title = uniqueName("e2e-slack")

    const created = await api<{ sessionId: string }>(browser, "/sessions/slack", "POST", {
      slackUserId,
      title,
      agentRuntime: "isolate",
    })

    try {
      await app.open(`/session/${created.sessionId}`)
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
    } finally {
      await api(browser, `/sessions/${created.sessionId}`, "DELETE")
    }
  },
)
