import { test } from "@e2e-dev/web"
import { credentials, expect } from "e2e"
import { requireFixture } from "./support/external-fixtures"

test(
  "OIDC member sign-in returns to SolZero and denies admin access",
  { tags: ["external", "oidc"] },
  async ({ app, browser, screen, agent }) => {
    const provider = requireFixture("E2E_OIDC_PROVIDER_NAME")
    requireFixture("E2E_OIDC_USERNAME")
    requireFixture("E2E_OIDC_PASSWORD")
    const member = credentials.user("oidcMember")
    await app.open("/settings?category=learn-more")
    await expect(screen.getByRole("button", `Sign in with ${provider}`)).toBeVisible()
    await screen.getByRole("button", `Sign in with ${provider}`).tap()
    await agent.act(
      "Sign in to the isolated identity provider using the supplied username and password. Return to SolZero after sign-in.",
      { params: { username: member.username, password: member.password } },
    )
    await expect(screen.getByRole("button", "Account menu")).toBeVisible()
    const cookie = (await browser.cookies()).map(({ name, value }) => `${name}=${value}`).join("; ")
    const memberSession = await fetch("http://localhost:3100/auth/session", {
      headers: { Cookie: cookie },
    })
    expect(memberSession.status).toBe(200)
    const state = await memberSession.json()
    expect(state.isAdmin).toBe(false)
    const forbidden = await fetch("http://localhost:3100/admin/summary", {
      headers: { Cookie: cookie },
    })
    expect(forbidden.status).toBe(403)
    await app.open("/admin/agents")
    await expect(screen.getByText("Access Denied", { exact: true })).toBeVisible()
  },
)
