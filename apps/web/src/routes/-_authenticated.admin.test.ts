import { isRedirect } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import type { AppSession } from "@/lib/auth-session-state"
import { requireAdminSession } from "./_authenticated.admin"

const userSession: AppSession = {
  user: {
    id: "user-123",
    name: "Test User",
    email: "user@example.com",
  },
  isAdmin: false,
}

describe("requireAdminSession", () => {
  it("allows admin sessions", () => {
    expect(() => requireAdminSession({ ...userSession, isAdmin: true })).not.toThrow()
  })

  it("redirects non-admin sessions", () => {
    let result: unknown
    try {
      requireAdminSession(userSession)
    } catch (error) {
      result = error
    }

    expect(isRedirect(result)).toBe(true)
  })

  it("redirects unauthenticated requests", () => {
    let result: unknown
    try {
      requireAdminSession(null)
    } catch (error) {
      result = error
    }

    expect(isRedirect(result)).toBe(true)
  })
})
