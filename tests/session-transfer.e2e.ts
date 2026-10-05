import { test } from "@e2e-dev/web"
import { expect } from "e2e"

test(
  "admin authentication transfer redeems once and retains its deep link",
  { session: "admin" },
  async ({ app, browser, screen }) => {
    const cookie = (await browser.cookies()).map(({ name, value }) => `${name}=${value}`).join("; ")
    const redirect = "/settings?category=agents&tab=runtimes"
    const generated = await fetch(
      `http://localhost:3100/api/auth/session-transfer?${new URLSearchParams({ redirect })}`,
      { headers: { Cookie: cookie, accept: "application/json" } },
    )
    expect(generated.status).toBe(200)
    const transfer = (await generated.json()) as { redeemUrl: string; expiresAt: string }
    const redeem = new URL(transfer.redeemUrl)
    expect(redeem.pathname).toBe("/api/auth/session-transfer/redeem")
    expect(redeem.searchParams.has("token")).toBe(true)
    expect(Date.parse(transfer.expiresAt)).toBeGreaterThan(Date.now())
    const response = await fetch(redeem, { redirect: "manual" })
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(redirect)
    const cookies = response.headers.getSetCookie().map((item) => {
      const first = item.split(";")[0]!
      const index = first.indexOf("=")
      return {
        name: first.slice(0, index),
        value: first.slice(index + 1),
        url: "http://localhost:3000",
      }
    })
    expect(cookies.length).toBeGreaterThan(0)
    await browser.setCookies(cookies)
    await app.open(redirect)
    await expect(screen.getByLabel("Default isolate step call limit")).toBeVisible()
    const consumed = await fetch(redeem, { redirect: "manual" })
    expect(consumed.status).toBe(400)
  },
)
