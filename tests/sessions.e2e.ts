import { test } from "@e2e-dev/web"
import { expect, unique } from "e2e"
import { requireFixture } from "./support/external-fixtures"
import { api, uniqueName } from "./support/api"

test(
  "session tools, archive and restoration persist through the real Worker",
  { session: "admin" },
  async ({ app, browser, screen, agent }) => {
    const title = uniqueName("e2e-session")
    const created = await api<{ sessionId: string; agentRuntime: string }>(
      browser,
      "/sessions",
      "POST",
      {
        title,
        agentRuntime: "isolate",
        tools: [{ kind: "workflow_builder" }],
        isolateStepLimit: 35,
        subagents: "disabled",
      },
    )
    expect(created.agentRuntime).toBe("isolate")
    const path = `/sessions/${created.sessionId}`
    try {
      const detail = await api<{ tools: object[] }>(browser, path)
      expect(detail.tools).toEqual([{ kind: "workflow_builder" }])
      await api(browser, `${path}/tools`, "PATCH", { tools: [], isolateStepLimit: 40 })
      const changed = await api<{ tools: object[] }>(browser, path)
      expect(changed.tools).toEqual([])
      await api(browser, `${path}/archive`, "POST")
      await app.open("/settings?category=data-controls")
      await expect(screen.getByText(title, { exact: true })).toBeVisible()
      await agent.act(
        "Click Unarchive on the archived chat named in params. Finish when the Archived chats section says No archived agents.",
        { params: { title: unique(title) } },
      )
      await expect(screen.getByText(title, { exact: true })).not.toBeVisible()
      const restored = await api<{ status: string }>(browser, path)
      expect(restored.status).not.toBe("archived")
      await app.open(`/session/${created.sessionId}`)
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
      await browser.reload()
      await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
    } finally {
      await api(browser, path, "DELETE")
    }
  },
)

test(
  "a second account cannot read or mutate another account's session",
  { session: "peer" },
  async ({ browser }) => {
    const signedIn = await fetch("http://localhost:3100/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        email: process.env.E2E_USER_ADMIN_USERNAME,
        password: process.env.E2E_USER_ADMIN_PASSWORD,
      }),
    })
    expect(signedIn.status).toBe(200)
    const ownerCookie = signedIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ")
    const create = await fetch("http://localhost:3100/sessions", {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: uniqueName("e2e-foreign"), agentRuntime: "isolate" }),
    })
    expect(create.status).toBe(201)
    const { sessionId } = await create.json()
    try {
      const peerCookie = (await browser.cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join("; ")
      for (const [path, method, payload] of [
        [`/sessions/${sessionId}`, "GET", undefined],
        [`/sessions/${sessionId}/ws-token`, "POST", {}],
        [`/sessions/${sessionId}/tools`, "PATCH", { tools: [] }],
        [`/sessions/${sessionId}`, "DELETE", undefined],
      ] as const) {
        const response = await fetch(`http://localhost:3100${path}`, {
          method,
          headers: { Cookie: peerCookie, "Content-Type": "application/json" },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        })
        expect(response.status, `${method} ${path}`).toBe(404)
      }
    } finally {
      const removed = await fetch(`http://localhost:3100/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Cookie: ownerCookie },
      })
      expect(removed.status).toBe(200)
    }
  },
)

for (const runtime of ["isolate", "opencode", "codex", "claude-code"]) {
  test(
    `${runtime} executes a real prompt and persists its output`,
    {
      session: "admin",
      tags:
        runtime === "isolate"
          ? ["runtime"]
          : runtime === "claude-code"
            ? ["runtime", "external", "harness"]
            : ["runtime", "harness"],
    },
    async ({ app, browser, screen }) => {
      if (runtime !== "isolate") requireFixture("E2E_CONTAINER_RUNTIME")
      if (runtime === "claude-code") requireFixture("E2E_CLAUDE_CODE_MODEL")
      const marker = uniqueName("E2E_OUTPUT")
      const result = await api<{
        sessionId: string
        messageId: string
        status: string
        output: string
        error?: string
      }>(browser, "/sessions/run", "POST", {
        title: uniqueName(`e2e-${runtime}`),
        agentRuntime: runtime,
        content:
          runtime === "codex"
            ? "Reply with only hello. Do not call any tools."
            : `Reply with only this marker: ${marker}. Do not call any external tools.`,
        ...((process.env[`E2E_${runtime.toUpperCase().replaceAll("-", "_")}_MODEL`] ??
        process.env.E2E_APP_MODEL)
          ? {
              model:
                process.env[`E2E_${runtime.toUpperCase().replaceAll("-", "_")}_MODEL`] ??
                process.env.E2E_APP_MODEL,
            }
          : {}),
      })
      try {
        expect(result.status, result.error ?? runtime).toBe("completed")
        if (runtime === "codex") expect(result.output.trim()).toBe("hello")
        else expect(result.output).toContain(marker)
        await app.open(`/session/${result.sessionId}`)
        // The final assistant card has mr-8; user prompts have ml-8 and must not satisfy this.
        const output =
          runtime === "codex"
            ? browser.locator("div.group.mr-8").getByText("hello", { exact: true })
            : screen.getByText(marker, { exact: false }).last()
        await expect(output).toBeVisible()
        if (runtime === "isolate") {
          await expect(screen.getByRole("button", "Copy markdown").last()).toBeVisible()
          await screen.getByText(marker, { exact: false }).last().hover()
          await screen.getByRole("button", "Copy markdown").last().tap()
          const copied = await browser.evaluate(() => navigator.clipboard.readText())
          expect(copied).toBe(result.output)
        }
        await browser.reload()
        await expect(screen.getByRole("button", "Stop", { exact: true })).not.toBeVisible()
        await expect(output).toBeVisible()
        if (runtime === "codex") {
          const persisted = await api<{
            events: Array<{ type: string; data: { content?: string } }>
          }>(browser, `/sessions/${result.sessionId}/events?messageId=${result.messageId}`)
          expect(
            persisted.events
              .filter((event) => event.type === "token")
              .at(-1)
              ?.data.content?.trim(),
          ).toBe("hello")
          expect(persisted.events.filter((event) => event.type === "tool_call").length).toBe(0)
        }
        const messages = await api<{ messages: object[] }>(
          browser,
          `/sessions/${result.sessionId}/messages`,
        )
        expect(messages.messages.length).toBeGreaterThan(0)
      } finally {
        await api(browser, `/sessions/${result.sessionId}`, "DELETE")
      }
    },
  )
}
