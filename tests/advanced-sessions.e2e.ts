import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"

test(
  "incognito sessions stay outside normal lists but open directly",
  { session: "admin" },
  async ({ app, browser, screen }) => {
    const title = uniqueName("e2e-incognito")
    const { sessionId } = await api<{ sessionId: string }>(browser, "/sessions", "POST", {
      title,
      incognito: true,
      agentRuntime: "isolate",
    })
    try {
      const hidden = await api<{ sessions: Array<{ id: string }> }>(browser, `/sessions?q=${title}`)
      expect(hidden.sessions).toEqual([])
      const visible = await api<{ sessions: Array<{ id: string }> }>(
        browser,
        `/sessions?q=${title}&includeIncognito=true`,
      )
      expect(visible.sessions.map((item) => item.id)).toContain(sessionId)
      await app.open(`/session/${sessionId}`)
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
      await browser.reload()
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
    } finally {
      await api(browser, `/sessions/${sessionId}`, "DELETE")
    }
  },
)

test(
  "session MCP definitions and subagent preferences persist",
  { session: "admin" },
  async ({ app, browser, screen, agent }) => {
    const customMcpServers = {
      remote: { type: "remote", url: "http://localhost:4319/mcp", enabled: false },
      local: { type: "local", command: ["node", "--version"], enabled: false },
    }
    const { sessionId } = await api<{ sessionId: string }>(browser, "/sessions", "POST", {
      title: uniqueName("e2e-tools"),
      agentRuntime: "isolate",
      customMcpServers,
      subagents: "disabled",
      isolateStepLimit: 37,
    })
    try {
      const path = `/sessions/${sessionId}`
      const first = await api<{
        customMcpServers: object
        subagents: string
        isolateStepLimit: number
      }>(browser, path)
      expect(first).toMatchObject({ customMcpServers, subagents: "disabled", isolateStepLimit: 37 })
      await api(browser, `${path}/tools`, "PATCH", {
        customMcpServers: {},
        subagents: "enabled",
        isolateStepLimit: 38,
      })
      const second = await api<object>(browser, path)
      expect(second).toMatchObject({
        customMcpServers: {},
        subagents: "enabled",
        isolateStepLimit: 38,
      })
      await app.open(`/session/${sessionId}`)
      await expect(screen.getByRole("button", "Tools", { exact: true })).toBeVisible()
      await agent.act("Open the Agent tools editor")
      await expect(screen.getByLabel("Tool call limit")).toHaveValue("38")
      await screen.getByLabel("Tool call limit").fill("39")
      await agent.act(
        "Set Sub-agents to Disabled and click Update tools. Finish when the Agent tools dialog closes.",
      )
      await expect(screen.getByRole("dialog")).not.toBeVisible()
      await browser.reload()
      const saved = await api<object>(browser, path)
      expect(saved).toMatchObject({ isolateStepLimit: 39, subagents: "disabled" })
    } finally {
      await api(browser, `/sessions/${sessionId}`, "DELETE")
    }
  },
)

test(
  "an attachment-bearing prompt can be cancelled without leaving processing",
  { session: "admin", tags: ["runtime"] },
  async ({ app, browser, screen }) => {
    const title = uniqueName("e2e-cancel")
    const { sessionId } = await api<{ sessionId: string }>(browser, "/sessions", "POST", {
      title,
      agentRuntime: "isolate",
    })
    const path = `/sessions/${sessionId}`
    const attachments = [
      { type: "url", name: "e2e-reference", url: "https://example.test/reference" },
    ]
    try {
      await api(browser, `${path}/prompt`, "POST", {
        content:
          "Count from one to five hundred slowly. Do not fetch the reference URL or call external tools.",
        attachments,
      })
      await expect
        .poll(async () => {
          const current = await api<{ messages: Array<{ status: string }> }>(
            browser,
            `${path}/messages`,
          )
          return current.messages[0]?.status
        })
        .toBe("processing")
      await api(browser, `${path}/stop`, "POST")
      await expect
        .poll(
          async () => {
            const messages = await api<{
              messages: Array<{ status: string; attachments: string | object[] }>
            }>(browser, `${path}/messages`)
            return messages.messages
          },
          { timeout: 30_000 },
        )
        .toHaveLength(1)
      await app.open(`/session/${sessionId}`)
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
      await browser.reload()
      const again = await api<{ messages: Array<{ status: string }> }>(browser, `${path}/messages`)
      await expect
        .poll(async () => {
          const final = await api<{ messages: Array<{ status: string }> }>(
            browser,
            `${path}/messages`,
          )
          return final.messages[0]!.status
        })
        .toBe("failed")
      expect(again.messages).toHaveLength(1)
    } finally {
      await api(browser, path, "DELETE")
    }
  },
)

test(
  "isolate delegation records child events and returns the result",
  { session: "admin", tags: ["runtime"] },
  async ({ browser }) => {
    const marker = uniqueName("delegated")
    const result = await api<{ sessionId: string; status: string; output: string }>(
      browser,
      "/sessions/run",
      "POST",
      {
        title: uniqueName("e2e-subagent"),
        agentRuntime: "isolate",
        subagents: "enabled",
        content: `Use delegate_to_subagent to delegate exactly one task: return the marker ${marker}. Wait for the child to finish and include its marker in your final response.`,
        ...(process.env.E2E_APP_MODEL ? { model: process.env.E2E_APP_MODEL } : {}),
      },
    )
    try {
      expect(result.status).toBe("completed")
      expect(result.output).toContain(marker)
      const session = await api<{ events: Array<{ type: string }> }>(
        browser,
        `/sessions/${result.sessionId}/events`,
      )
      expect(session.events.some((event) => event.type === "subagent_event")).toBe(true)
    } finally {
      await api(browser, `/sessions/${result.sessionId}`, "DELETE")
    }
  },
)
