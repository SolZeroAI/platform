import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, authErrorCode, authRequest, linkedAuthAccounts, uniqueName } from "./support/api"

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

      const authorized = await fetch("http://localhost:3000/api/sessions", {
        headers: { "x-api-key": created.key },
      })

      expect(authorized.status).toBe(200)
    } finally {
      await api(browser, `/auth/api-keys/${created.keyId}`, "DELETE")
    }

    const revoked = await fetch("http://localhost:3000/api/sessions", {
      headers: { "x-api-key": created.key },
    })

    expect(revoked.status).toBe(401)
    await browser.reload()
    await expect(screen.getByText(label, { exact: true })).not.toBeVisible()
  },
)

test(
  "Better Auth 1.7 account APIs select the local account row id",
  { session: "admin" },
  async ({ browser }) => {
    const listed = await authRequest(browser, "/api/auth/list-accounts")
    expect(listed.status).toBe(200)
    const accounts = linkedAuthAccounts(listed.payload)
    const credential = accounts.find((account) => account.providerId === "credential")
    expect(credential, "isolated admin keeps a credential account").toBeDefined()

    if (!credential) {
      return
    }

    expect(credential.id.length).toBeGreaterThan(0)
    expect(credential.accountId.length).toBeGreaterThan(0)
    expect(
      accounts.some((account) => account.providerId === "github"),
      "core e2e has no GitHub App provider to link",
    ).toBe(false)

    const foreignId =
      credential.accountId === credential.id ? uniqueName("foreign") : credential.accountId

    const profile = await authRequest(
      browser,
      `/api/auth/account-info?accountId=${encodeURIComponent(credential.id)}`,
    )

    expect(profile.status).toBe(400)
    expect(authErrorCode(profile.payload)).toBe("PROVIDER_NOT_CONFIGURED")

    const missingProfile = await authRequest(
      browser,
      `/api/auth/account-info?accountId=${encodeURIComponent(foreignId)}`,
    )

    expect(missingProfile.status).toBe(400)
    expect(authErrorCode(missingProfile.payload)).toBe("ACCOUNT_NOT_FOUND")

    const token = await authRequest(browser, "/api/auth/get-access-token", "POST", {
      accountId: credential.id,
    })

    expect(token.status).toBe(400)
    expect(authErrorCode(token.payload)).toBe("PROVIDER_NOT_SUPPORTED")

    const missingToken = await authRequest(browser, "/api/auth/get-access-token", "POST", {
      accountId: foreignId,
    })

    expect(missingToken.status).toBe(400)
    expect(authErrorCode(missingToken.payload)).toBe("ACCOUNT_NOT_FOUND")

    const legacySelector = await authRequest(browser, "/api/auth/get-access-token", "POST", {
      providerId: "credential",
    })

    expect(legacySelector.status).toBeGreaterThanOrEqual(400)

    const unlink = await authRequest(browser, "/api/auth/unlink-account", "POST", {
      accountId: credential.id,
    })

    expect(unlink.status).toBe(400)
    expect(authErrorCode(unlink.payload)).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT")
  },
)

test(
  "Accounts settings shows GitHub as unlinked without OAuth providers",
  { session: "admin" },
  async ({ app, screen }) => {
    await app.open("/settings?category=api-access")
    await expect(screen.getByRole("heading", "Link to section: Accounts")).toBeVisible()
    await expect(screen.getByText("No GitHub account linked", { exact: true })).toBeVisible()
    await expect(screen.getByText("Not enabled in the stage config", { exact: true })).toBeVisible()
    await expect(screen.getByRole("button", "Unlink")).not.toBeVisible()
  },
)
