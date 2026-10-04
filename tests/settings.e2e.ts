import { test } from "@e2e-dev/web"
import { expect, secrets } from "e2e"
import { api, uniqueName } from "./support/api"

test("all settings categories load real data", { session: "admin" }, async ({ app, screen }) => {
  for (const [category, title] of [
    ["providers", "AI Providers"],
    ["agents", "Agents"],
    ["api-access", "Accounts"],
    ["data-controls", "Data Controls"],
    ["learn-more", "Learn More"],
  ]) {
    await app.open(`/settings?category=${category}`)
    await expect(screen.getByRole("heading", `Link to section: ${title}`)).toBeVisible()
  }
})

test(
  "runtime default persists after reload",
  { session: "admin" },
  async ({ app, agent, screen, browser }) => {
    await app.open("/settings?category=agents&tab=runtimes")
    const limit = screen.getByLabel("Default isolate step call limit")
    await expect(limit).toBeVisible()
    const original = await limit.inputValue()
    const next = original === "35" ? "36" : "35"
    try {
      await limit.fill(next)
      await expect(limit).toHaveValue(next)
      await expect(screen.getByRole("button", "Save", { exact: true })).toBeEnabled()
      await agent.act(
        "Save the supplied isolate step call limit using Save. Finish when Save is disabled and the supplied limit remains in the field.",
        { params: { limit: Number(next) } },
      )
      await expect(screen.getByRole("button", "Save", { exact: true })).not.toBeEnabled()
      await browser.reload()
      await expect(limit).toHaveValue(next)
    } finally {
      await limit.fill(original)
      const save = screen.getByRole("button", "Save", { exact: true })
      if (await save.isEnabled()) {
        await save.tap()
        await expect(save).not.toBeEnabled()
      }
    }
  },
)

test(
  "MCP deep link and legacy settings URL open the MCP tab",
  { session: "admin" },
  async ({ app, screen, browser, agent }) => {
    await app.open("/settings?category=mcp")
    await expect(browser).toHaveURL(/category=agents.*tab=mcps/)
    await expect(screen.getByLabel("Search MCPs")).toBeVisible()
    await agent.act("Search MCPs for the supplied query", { params: { query: "e2e-no-server" } })
    await expect(screen.getByLabel("Search MCPs")).toHaveValue("e2e-no-server")
  },
)

test(
  "secret editor creates, finds and deletes a disposable secret",
  { session: "admin" },
  async ({ app, screen, browser, agent }) => {
    const key = uniqueName("E2E_SECRET").replaceAll("-", "_")
    await app.open("/settings?category=secrets")
    await expect(screen.getByRole("button", "Add secret", { exact: true })).toBeVisible()
    let created = false
    try {
      await agent.act("Open the Add secret editor")
      await expect(screen.getByRole("dialog")).toBeVisible()
      await screen.getByLabel("Secret key").fill(key)
      await screen.getByLabel("Secret value").fill(secrets.get("fixture"))
      await screen.getByRole("button", "Save", { exact: true }).tap()
      await expect(screen.getByText(key, { exact: true })).toBeVisible()
      created = true
      await browser.reload()
      await screen.getByLabel("Search secrets by key").fill(key)
      await expect(screen.getByText(key, { exact: true })).toBeVisible()
      const listed = await api<{ secrets: object[] }>(browser, `/secrets?q=${key}`)
      expect(listed.secrets).toEqual([{ key, tags: [] }])
    } finally {
      if (created) await api(browser, `/secrets/${key}`, "DELETE")
    }
  },
)

test(
  "theme preference survives reload",
  { session: "admin" },
  async ({ app, browser, screen, agent }) => {
    await app.open("/settings?category=learn-more")
    await expect(screen.getByRole("button", "Account menu")).toBeVisible()
    const original = await browser.evaluate(() => document.documentElement.dataset.mode ?? "light")
    const next = original === "dark" ? "light" : "dark"
    try {
      await agent.act(
        `Click Switch to ${next} mode. Finish when the button is named Switch to ${original} mode.`,
      )
      await expect(screen.getByRole("button", `Switch to ${original} mode`)).toBeVisible()
      await browser.reload()
      await expect(screen.getByRole("button", `Switch to ${original} mode`)).toBeVisible()
      expect(await browser.evaluate(() => document.documentElement.dataset.mode ?? "")).toBe(next)
    } finally {
      await screen.getByRole("button", `Switch to ${original} mode`).tap()
      await expect(screen.getByRole("button", `Switch to ${next} mode`)).toBeVisible()
    }
  },
)
