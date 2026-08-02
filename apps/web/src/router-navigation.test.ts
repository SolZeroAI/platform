import { createMemoryHistory, createRouter } from "@tanstack/react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const routeData = vi.hoisted(() => {
  const session = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "user@example.com",
    },
    isAdmin: false,
    githubAccountId: null,
  }

  return {
    session,
    loadAuthenticatedShellForRoute: vi.fn(async () => ({
      authSession: session,
      authProviderConfig: {
        defaultSignInProviderId: "test",
        providers: [
          {
            id: "test",
            kind: "oidc",
            displayName: "Test",
            capabilities: { signIn: true, link: true },
          },
        ],
        configurationFile: "config/dev.config.jsonc",
      },
      providerSettings: null,
    })),
  }
})

vi.mock("@/lib/authenticated-shell.functions", () => ({
  loadAuthenticatedShellForRoute: routeData.loadAuthenticatedShellForRoute,
}))

vi.mock("@/lib/admin-console.functions", () => ({
  loadAdminAiSearchForRoute: vi.fn(async () => null),
  loadAdminIntegrationsForRoute: vi.fn(async () => null),
}))

vi.mock("@/lib/auth-session", () => ({
  getAuthSessionContext: vi.fn(async () => routeData.session),
}))

vi.mock("@/lib/control-plane", () => ({
  getControlPlaneHeaders: vi.fn(async (headers?: HeadersInit) => new Headers(headers)),
  getControlPlaneUrl: vi.fn(() => "http://localhost:1337"),
  getWebAppUrl: vi.fn(() => "http://localhost:3000"),
}))

import { routeTree } from "./routeTree.gen"

describe("authenticated navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not reload shell data while navigating between authenticated views", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })

    await router.load()
    expect(routeData.loadAuthenticatedShellForRoute).toHaveBeenCalledTimes(1)

    await router.navigate({ to: "/workflows" })
    await router.navigate({ to: "/settings" })

    expect(routeData.loadAuthenticatedShellForRoute).toHaveBeenCalledTimes(1)
  })
})
