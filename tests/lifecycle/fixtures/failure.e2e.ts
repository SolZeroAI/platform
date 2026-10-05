import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api } from "../../support/api"

test(
  "intentional failure leaves a real session for suite recovery",
  { session: "admin" },
  async ({ browser }) => {
    const session = await api<{ sessionId: string }>(browser, "/sessions", "POST", {
      title: "Owned failure cleanup regression",
      agentRuntime: "isolate",
    })
    expect(session.sessionId).toBeTruthy()
    expect(false, "Intentional negative lifecycle probe").toBe(true)
  },
)
