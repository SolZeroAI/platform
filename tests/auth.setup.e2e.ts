import "../scripts/e2e/environment"
import { test } from "@e2e-dev/web"
import { expect } from "e2e"

for (const name of ["admin", "peer"] as const) {
  test.setup(
    `authenticate isolated ${name}`,
    { sessions: [name] },
    async ({ app, browser, screen, session }) => {
      const health = await fetch("http://localhost:3100/health")
      expect(health.status).toBe(200)
      expect(await health.json()).toMatchObject({
        status: "healthy",
        service: "s0-agent-control-plane",
      })
      const key = name.toUpperCase()
      const response = await fetch("http://localhost:3100/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: process.env[`E2E_USER_${key}_USERNAME`],
          password: process.env[`E2E_USER_${key}_PASSWORD`],
        }),
      })
      expect(response.status, "isolated configured administrator signs in").toBe(200)
      const cookies = response.headers.getSetCookie().map((cookie) => {
        const first = cookie.split(";")[0]!
        const index = first.indexOf("=")
        return {
          name: first.slice(0, index),
          value: first.slice(index + 1),
          url: "http://localhost:3000",
        }
      })
      expect(cookies.length).toBeGreaterThan(0)
      await browser.setCookies(cookies)
      await app.open("/settings?category=agents&tab=runtimes")
      await expect(screen.getByLabel("Default isolate step call limit")).toBeVisible()
      await session.save(name)
    },
  )
}
