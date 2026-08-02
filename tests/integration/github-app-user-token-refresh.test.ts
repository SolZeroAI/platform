import * as Effect from "effect/Effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiEnv } from "../../packages/infra/src/types/env"
import { getGitHubAppUserAccessTokenForUserId } from "../../packages/api/src/server/lib/better-auth"

interface AccountRow {
  id: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
}

function createDb(row: AccountRow | null) {
  const first = vi.fn().mockResolvedValue(row)
  const run = vi.fn().mockResolvedValue({ success: true })
  const selectBind = vi.fn().mockReturnValue({ first })
  const updateBind = vi.fn().mockReturnValue({ run })
  const deleteBind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn((sql: string) => ({
    bind: sql.includes("UPDATE") ? updateBind : sql.includes("DELETE") ? deleteBind : selectBind,
  }))

  return {
    db: { prepare } as unknown as D1Database,
    deleteBind,
    first,
    prepare,
    run,
    updateBind,
  }
}

function createEnv(db: D1Database): ApiEnv {
  return {
    DB: db,
    GITHUB_APP_CLIENT_ID: "Iv1.client",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
  } as ApiEnv
}

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "account_1",
    accountId: "90707158",
    accessToken: "ghu_existing_access_token",
    refreshToken: "ghr_existing_refresh_token",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

function expectFetchPostUrl(url: string): void {
  const [requestUrl, requestInit] = vi.mocked(fetch).mock.calls[0]
  expect(requestUrl.toString()).toBe(url)
  expect(requestInit).toMatchObject({ method: "POST" })
}

function mockFetchJson(body: unknown, init?: ResponseInit): void {
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(Response.json(body, init)))
}

describe("GitHub App user access token resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns an unexpired stored GitHub App user token without refreshing", async () => {
    const store = createDb(accountRow())

    const token = await Effect.runPromise(
      getGitHubAppUserAccessTokenForUserId(createEnv(store.db), "user_1"),
    )

    expect(token).toMatchObject({
      githubUserId: "90707158",
      accessToken: "ghu_existing_access_token",
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(store.updateBind).not.toHaveBeenCalled()
  })

  it("refreshes an expired GitHub App user token and persists the rotated tokens", async () => {
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    )
    mockFetchJson({
      access_token: "ghu_fresh_access_token",
      expires_in: 28_800,
      refresh_token: "ghr_fresh_refresh_token",
      refresh_token_expires_in: 15_897_600,
      scope: "",
      token_type: "bearer",
    })

    const token = await Effect.runPromise(
      getGitHubAppUserAccessTokenForUserId(createEnv(store.db), "user_1"),
    )

    expect(token).toMatchObject({
      githubUserId: "90707158",
      accessToken: "ghu_fresh_access_token",
    })
    expectFetchPostUrl("https://github.com/login/oauth/access_token")
    expect(store.updateBind).toHaveBeenCalledWith(
      "ghu_fresh_access_token",
      "ghr_fresh_refresh_token",
      expect.any(String),
      expect.any(String),
      "",
      expect.any(String),
      "account_1",
    )
  })

  it("does not return a stale token when refresh fails", async () => {
    const store = createDb(
      accountRow({
        accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    )
    mockFetchJson({
      error: "bad_refresh_token",
      error_description: "The refresh token is invalid.",
    })

    const token = await Effect.runPromise(
      getGitHubAppUserAccessTokenForUserId(createEnv(store.db), "user_1"),
    )

    expect(token).toBeNull()
    expect(store.updateBind).not.toHaveBeenCalled()
    expect(store.deleteBind).toHaveBeenCalledWith("account_1", "github")
  })

  it("rejects legacy GitHub OAuth App tokens", async () => {
    const store = createDb(
      accountRow({
        accessToken: "gho_legacy_oauth_token",
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      }),
    )

    const token = await Effect.runPromise(
      getGitHubAppUserAccessTokenForUserId(createEnv(store.db), "user_1"),
    )

    expect(token).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
