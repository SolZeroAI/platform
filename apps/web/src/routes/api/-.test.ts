import { afterEach, describe, expect, it, vi } from "vitest"
import { proxyApiRequest } from "./$"

vi.mock("@/lib/auth-session", () => ({
  getAuthSessionContext: vi.fn(async () => null),
}))

vi.mock("@/lib/control-plane", () => ({
  getControlPlaneHeaders: (init?: HeadersInit) => {
    const headers = new Headers(init)
    headers.delete("authorization")
    headers.delete("x-api-key")
    headers.delete("x-user-id")
    headers.delete("x-okta-user-id")
    return headers
  },
  getControlPlaneUrl: () => "http://api.example",
  getWebAppUrl: () => "http://localhost:3000",
}))

const { getAuthSessionContext } = await import("@/lib/auth-session")

const AUTH_SESSION = {
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  },
  githubAccountId: null,
  isAdmin: false,
}

describe("API proxy route", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(getAuthSessionContext).mockReset()
    vi.mocked(getAuthSessionContext).mockResolvedValue(null)
  })

  it("rejects unauthenticated session API requests", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    const response = await proxyApiRequest(
      new Request("http://localhost:3000/api/sessions/session-123"),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards the authenticated session cookie without identity headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(getAuthSessionContext).mockResolvedValue(AUTH_SESSION)

    const response = await proxyApiRequest(
      new Request("http://localhost:3000/api/sessions/session-123", {
        headers: { cookie: "better-auth.session_token=session-token", "x-user-id": "spoofed" },
      }),
    )

    expect(response.status).toBe(200)
    const [upstreamUrl, init] = fetchMock.mock.calls[0] ?? []
    if (!init) {
      throw new Error("Expected proxy fetch options")
    }
    const headers = new Headers(init.headers)
    expect(upstreamUrl?.toString()).toBe("http://api.example/sessions/session-123")
    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-user-id")).toBeNull()
    expect(headers.get("cookie")).toBe("better-auth.session_token=session-token")
    expect(headers.get("x-forwarded-for")).toBe("127.0.0.1")
  })

  it("passes successful session WebSocket upgrades through without wrapping", async () => {
    const upgradeResponse = new Response(null)
    Object.defineProperty(upgradeResponse, "status", { value: 101 })
    const fetchMock = vi.fn<typeof fetch>(async () => upgradeResponse)
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(getAuthSessionContext).mockResolvedValue(AUTH_SESSION)

    const response = await proxyApiRequest(
      new Request("http://localhost:3000/api/sessions/session-123/ws", {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
        },
      }),
    )

    expect(response).toBe(upgradeResponse)
    const [upstreamUrl, init] = fetchMock.mock.calls[0] ?? []
    if (!init) {
      throw new Error("Expected proxy fetch options")
    }
    const headers = new Headers(init.headers)
    expect(upstreamUrl?.toString()).toBe("http://api.example/sessions/session-123/ws")
    expect(headers.get("x-user-id")).toBeNull()
    expect(headers.get("upgrade")).toBe("websocket")
  })
})
