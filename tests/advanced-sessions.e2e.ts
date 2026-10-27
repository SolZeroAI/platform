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
  async ({ app, browser, screen }) => {
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
      await screen.getByRole("button", "Tools", { exact: true }).tap()
      await expect(screen.getByLabel("Tool call limit")).toHaveValue("38")
      await screen.getByLabel("Tool call limit").fill("39")
      await screen.getByRole("dialog").getByRole("combobox").tap()
      await screen.getByRole("option", "Disabled").tap()
      await screen.getByRole("dialog").getByRole("button", "Update tools", { exact: true }).tap()
      await expect(screen.getByRole("dialog")).not.toBeVisible()
      await browser.reload()
      const saved = await api<object>(browser, path)
      expect(saved).toMatchObject({ isolateStepLimit: 39, subagents: "disabled" })
    } finally {
      await api(browser, `/sessions/${sessionId}`, "DELETE")
    }
  },
)
