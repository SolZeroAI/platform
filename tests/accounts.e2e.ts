import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"

test(
  "create, use and revoke an isolated user API key",
  { session: "admin" },
  async ({ app, browser, screen }) => {
    const label = uniqueName("e2e-key")
    const created = await api<{ key: string; keyId: string }>(browser, "/auth/api-keys", "POST", {
      label,
    })
    try {
      await app.open("/settings?category=api-access")
      await expect(screen.getByText(label, { exact: true })).toBeVisible()
      const authorized = await fetch("http://localhost:3100/sessions", {
        headers: { "x-api-key": created.key },
      })
      expect(authorized.status).toBe(200)
    } finally {
      await api(browser, `/auth/api-keys/${created.keyId}`, "DELETE")
    }
    const revoked = await fetch("http://localhost:3100/sessions", {
      headers: { "x-api-key": created.key },
    })
    expect(revoked.status).toBe(401)
    await browser.reload()
    await expect(screen.getByText(label, { exact: true })).not.toBeVisible()
  },
)
