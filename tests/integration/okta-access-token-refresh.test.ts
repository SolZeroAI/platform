import * as Effect from "effect/Effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  OktaAccountReconnectRequiredError,
  getOktaAccessTokenForUserId,
} from "../../packages/api/src/server/lib/better-auth"
import type { ApiEnv } from "../../packages/infra/src/types/env"

interface AccountRow {
  id: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  scope: string | null
}

interface AuthProviderTestConfig {
  providerId: string
  issuer: string
  clientId: string
  scopes: string[]
}

function createDb(row: AccountRow | null) {
  const first = vi.fn().mockResolvedValue(row)
  const run = vi.fn().mockResolvedValue({ success: true })
  const selectBind = vi.fn().mockReturnValue({ first })
  const updateBind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn((sql: string) => ({
    bind: sql.includes("UPDATE") ? updateBind : selectBind,
  }))

  return {
    db: { prepare } as unknown as D1Database,
    first,
    prepare,
    run,
    updateBind,
  }
}

function createEnv(db: D1Database, authOverrides: Partial<AuthProviderTestConfig> = {}): ApiEnv {
  const providerConfig: AuthProviderTestConfig = {
    providerId: "okta",
    issuer: "https://example.okta.com/oauth2/default",
    clientId: "oidc-client",
    scopes: ["openid", "profile", "email", "offline_access"],
    ...authOverrides,
  }

  const clientSecretEnv = "TEST_OIDC_CLIENT_SECRET"
  return {
    DB: db,
    C0_CONFIG_AUTH: {
      defaultSignInProviderId: providerConfig.providerId,
      adminPassword: { env: "TEST_ADMIN_PASSWORD" },
      providers: {
        [providerConfig.providerId]: {
          kind: "oidc",
          enabled: true,
          displayName: "Okta",
          issuer: providerConfig.issuer,
          clientId: providerConfig.clientId,
          clientSecret: { env: clientSecretEnv },
          scopes: providerConfig.scopes,
          capabilities: { signIn: true, provisionUsers: true, link: true },
        },
      },
    },
    [clientSecretEnv]: "oidc-secret",
  } as ApiEnv
}

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "account_1",
    accountId: "00u-okta-user",
    accessToken: "okta_existing_access_token",
    refreshToken: "okta_existing_refresh_token",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    scope: "openid profile email offline_access",
    ...overrides,
  }
}

function jwtWithIssuer(issuer: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "")

  return [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({
      iss: issuer,
      sub: "admin@example.test",
      aud: "https://example.okta.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "signature",
  ].join(".")
}

function createLog() {
  return { error: vi.fn() }
}

async function expectFetchPostUrl(url: string): Promise<void> {
  const [requestUrl, requestInit] = vi.mocked(fetch).mock.calls[0]
  expect(requestUrl.toString()).toBe(url)
  expect(requestInit).toMatchObject({ method: "POST" })
  const body = new URLSearchParams(await new Request(requestUrl, requestInit).text())
  expect(body.get("client_id")).toBe("oidc-client")
  expect(body.get("client_secret")).toBe("oidc-secret")
}

function mockFetchJson(body: unknown, init?: ResponseInit): void {
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(Response.json(body, init)))
}

describe("Okta access token resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns an unexpired stored Okta access token without refreshing", async () => {
    const store = createDb(accountRow())

    const token = await Effect.runPromise(
      getOktaAccessTokenForUserId(createEnv(store.db), "user_1", {
        log: createLog(),
      }),
    )

    expect(token).toMatchObject({
      oktaUserId: "00u-okta-user",
      accessToken: "okta_existing_access_token",
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(store.updateBind).not.toHaveBeenCalled()
  })

  it("refreshes an expired Okta access token and persists the rotated tokens", async () => {
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    )
    mockFetchJson({
      access_token: "okta_fresh_access_token",
      expires_in: 3600,
      refresh_token: "okta_fresh_refresh_token",
      refresh_token_expires_in: 2_592_000,
      scope: "openid profile email offline_access",
      token_type: "Bearer",
    })

    const token = await Effect.runPromise(
      getOktaAccessTokenForUserId(createEnv(store.db), "user_1", {
        log: createLog(),
      }),
    )

    expect(token).toMatchObject({
      oktaUserId: "00u-okta-user",
      accessToken: "okta_fresh_access_token",
    })
    await expectFetchPostUrl("https://example.okta.com/oauth2/default/v1/token")
    expect(store.updateBind).toHaveBeenCalledWith(
      "okta_fresh_access_token",
      "okta_fresh_refresh_token",
      expect.any(String),
      expect.any(String),
      "openid profile email offline_access",
      expect.any(String),
      "account_1",
    )
  })

  it("refreshes org-issuer Okta access tokens against the default authorization server", async () => {
    const store = createDb(
      accountRow({
        accessToken: jwtWithIssuer("https://example.okta.com"),
      }),
    )
    mockFetchJson({
      access_token: "okta_default_authorization_server_token",
      expires_in: 3600,
      refresh_token: "okta_fresh_refresh_token",
      refresh_token_expires_in: 2_592_000,
      scope: "openid profile email offline_access",
      token_type: "Bearer",
    })

    const token = await Effect.runPromise(
      getOktaAccessTokenForUserId(
        createEnv(store.db, { issuer: "https://example.okta.com" }),
        "user_1",
        { log: createLog() },
      ),
    )

    expect(token.accessToken).toBe("okta_default_authorization_server_token")
    await expectFetchPostUrl("https://example.okta.com/oauth2/default/v1/token")
  })

  it("returns a reconnect error when an org-issuer Okta token cannot refresh", async () => {
    const store = createDb(
      accountRow({
        accessToken: jwtWithIssuer("https://example.okta.com"),
      }),
    )
    mockFetchJson(
      {
        error: "invalid_grant",
        error_description: "The refresh token is invalid.",
      },
      { status: 400 },
    )

    await expect(
      Effect.runPromise(
        getOktaAccessTokenForUserId(
          createEnv(store.db, { issuer: "https://example.okta.com" }),
          "user_1",
          { log: createLog() },
        ),
      ),
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        reason: "invalid_issuer",
        tokenIssuer: "https://example.okta.com",
        expectedIssuer: "https://example.okta.com/oauth2/default",
      }),
    })
  })

  it("returns a reconnect error when no linked Okta row exists", async () => {
    const store = createDb(null)

    await expect(
      Effect.runPromise(
        getOktaAccessTokenForUserId(createEnv(store.db), "user_1", { log: createLog() }),
      ),
    ).rejects.toMatchObject({
      name: OktaAccountReconnectRequiredError.name,
      context: {
        reason: "missing_account",
      },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not refresh Okta tokens with credentials from another primary OIDC provider", async () => {
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    )

    await expect(
      Effect.runPromise(
        getOktaAccessTokenForUserId(createEnv(store.db, { providerId: "example-oidc" }), "user_1", {
          log: createLog(),
        }),
      ),
    ).rejects.toMatchObject({
      context: expect.objectContaining({ reason: "refresh_unavailable" }),
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(store.updateBind).not.toHaveBeenCalled()
  })

  it("returns a reconnect error for expired unrefreshable Okta tokens", async () => {
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
        refreshToken: null,
      }),
    )

    await expect(
      Effect.runPromise(
        getOktaAccessTokenForUserId(createEnv(store.db), "user_1", { log: createLog() }),
      ),
    ).rejects.toMatchObject({
      message: "Reconnect Okta in Settings to use MCP Context Forge tools.",
      context: expect.objectContaining({
        reason: "missing_refresh_token",
        hasAccessToken: true,
        hasRefreshToken: false,
        scopeHasOfflineAccess: true,
      }),
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not log Okta refresh token values when refresh fails", async () => {
    const refreshToken = "okta_refresh_secret"
    const log = { error: vi.fn() }
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
        refreshToken,
      }),
    )
    mockFetchJson(
      {
        error: "invalid_grant",
        error_description: `The refresh token ${refreshToken} is invalid.`,
      },
      { status: 400 },
    )

    await expect(
      Effect.runPromise(getOktaAccessTokenForUserId(createEnv(store.db), "user_1", { log })),
    ).rejects.toThrow("Reconnect Okta")

    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        event: "auth.okta.token.refresh_failed",
        boundary: "auth.okta.refresh",
        oauth: expect.objectContaining({
          providerId: "okta",
          userId: "user_1",
          providerUserId: "00u-okta-user",
          hasRefreshToken: true,
        }),
        upstream: expect.objectContaining({
          issuer: "https://example.okta.com/oauth2/default",
          phase: "provider_response",
          status: 400,
          error: "invalid_grant",
          errorDescription: "The refresh token [redacted] is invalid.",
        }),
      }),
    )
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(refreshToken)
    expect(store.updateBind).not.toHaveBeenCalled()
  })
})
