import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"
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
