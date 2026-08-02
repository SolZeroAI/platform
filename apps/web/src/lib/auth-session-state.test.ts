import { describe, expect, it } from "vitest"
import { resolveAppSession, type AppSession } from "./auth-session-state"

const adminSession: AppSession = {
  user: {
    id: "admin-user",
    name: "Admin User",
    email: "admin@example.com",
  },
  isAdmin: true,
}

describe("resolveAppSession", () => {
  it("uses the server-loaded session while the client session is pending", () => {
    expect(
      resolveAppSession({ clientUser: null, initialSession: adminSession, pending: true }),
    ).toBe(adminSession)
  })

  it("preserves server-loaded admin access for the same client user", () => {
    expect(
      resolveAppSession({
        clientUser: adminSession.user,
        initialSession: adminSession,
        pending: false,
      }),
    ).toEqual(adminSession)
  })

  it("does not transfer admin access to a different client user", () => {
    expect(
      resolveAppSession({
        clientUser: {
          id: "different-user",
          name: "Different User",
          email: "different@example.com",
        },
        initialSession: adminSession,
        pending: false,
      }),
    ).toMatchObject({ isAdmin: false })
  })

  it("clears the server-loaded session after the client reports sign-out", () => {
    expect(
      resolveAppSession({ clientUser: null, initialSession: adminSession, pending: false }),
    ).toBeNull()
  })
})
