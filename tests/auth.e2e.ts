import { test } from "@e2e-dev/web"
import { credentials, expect } from "e2e"

test("sign-in gate protects every application route", async ({ app, screen }) => {
  for (const path of ["/", "/settings", "/workflows", "/bots"]) {
    await app.open(path)
    await expect(screen.getByRole("button", "Sign In")).toBeVisible()
    await expect(screen.getByLabel("Email")).toBeVisible()
  }
})

test("credential sign-in opens the requested settings page", async ({ app, screen }) => {
  const admin = credentials.user("admin")
  await app.open("/settings?category=agents&tab=runtimes")
  await screen.getByLabel("Email").fill(admin.username)
  await screen.getByLabel("Password").fill(admin.password)
  await screen.getByRole("button", "Sign In").tap()
  await expect(screen.getByLabel("Default isolate step call limit")).toBeVisible()
})

test("anonymous callers cannot access any protected API group", async () => {
  for (const path of [
    "/sessions",
    "/secrets",
    "/skills",
    "/bots",
    "/workflows",
    "/providers",
    "/admin/summary",
    "/repos",
  ]) {
    const response = await fetch(`http://localhost:3100${path}`)
    expect(response.status, path).toBe(401)
  }
})

test("sign-out removes authenticated UI access", async ({ app, screen, browser }) => {
  const peer = credentials.user("peer")
  await app.open("/settings?category=agents&tab=runtimes")
  await screen.getByLabel("Email").fill(peer.username)
  await screen.getByLabel("Password").fill(peer.password)
  await screen.getByRole("button", "Sign In").tap()
  await expect(screen.getByLabel("Default isolate step call limit")).toBeVisible()
  await screen.getByRole("button", "Account menu").tap()
  await screen.getByRole("button", "Sign out").tap()
  await expect(screen.getByRole("button", "Sign In")).toBeVisible()
  await browser.reload()
  await expect(screen.getByRole("button", "Sign In")).toBeVisible()
})
