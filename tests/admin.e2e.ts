import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api } from "./support/api"

test(
  "administrator pages show live control-plane configuration",
  { session: "admin" },
  async ({ app, browser, screen }) => {
    const access = await api<{ isAdmin: boolean }>(browser, "/admin/access")
    expect(access.isAdmin).toBe(true)
    await app.open("/admin/agents")
    await expect(screen.getByPlaceholder("Search agents")).toBeVisible()
    await app.open("/admin/workflows")
    await expect(screen.getByPlaceholder("Search workflows")).toBeVisible()
    await app.open("/admin/integrations")
    await expect(screen.getByRole("heading", "AI Providers")).toBeVisible()
    await app.open("/admin/ai-search")
    await expect(screen.getByRole("heading", "AI Search")).toBeVisible()
    for (const path of [
      "/admin/summary",
      "/admin/sessions",
      "/admin/workflows",
      "/admin/ai-providers",
      "/admin/ai-search",
      "/admin/mcpcf",
    ]) {
      const value = await api<object>(browser, path)
      expect(value).toBeDefined()
    }
  },
)
