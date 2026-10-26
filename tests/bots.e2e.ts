import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"

test(
  "create a bot and manage a temporary routine through the UI",
  { session: "admin" },
  async ({ app, browser, screen }) => {
    const name = uniqueName("e2e-bot")
    await app.open("/bots")
    await expect(screen.getByLabel("Bot name")).toBeVisible()
    await screen.getByLabel("Bot name").fill(name)
    await screen
      .getByLabel("Bot instructions")
      .fill("Disposable e2e bot. Never call external tools.")
    await screen.getByRole("button", "Create bot", { exact: true }).tap()
    await expect(screen.getByRole("heading", name)).toBeVisible()
    await expect(browser).toHaveURL(/\/bots\/[^/]+$/)
    const botId = (await browser.url()).split("/").pop()!
    const routineName = uniqueName("e2e-routine")

    const { routine } = await api<{ routine: { id: string } }>(
      browser,
      `/bots/${botId}/routines`,
      "POST",
      {
        name: routineName,
        kind: "temporary",
        cadence: { kind: "interval", intervalSeconds: 86400 },
        prompt: "Do nothing. This routine is removed before its first execution.",
        until: Date.now() + 86400_000,
      },
    )

    try {
      await browser.reload()
      await expect(screen.getByText(routineName, { exact: true })).toBeVisible()
      await screen.getByRole("button", `Delete ${routineName}`, { exact: true }).tap()
      await expect(screen.getByRole("heading", "No routines")).toBeVisible()
      await expect(screen.getByText(routineName, { exact: true })).not.toBeVisible()
      const list = await api<{ routines: object[] }>(browser, `/bots/${botId}/routines`)
      expect(list.routines).toEqual([])
    } finally {
      const list = await api<{ routines: Array<{ id: string }> }>(
        browser,
        `/bots/${botId}/routines`,
      )

      if (list.routines.some((item) => item.id === routine.id))
        await api(browser, `/bots/${botId}/routines/${routine.id}`, "DELETE")
    }
  },
)
