import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const workspaceMocks = vi.hoisted(() => ({
  initializeWorkspace: vi.fn<(input: unknown) => Promise<void>>(),
}))

vi.mock("../../packages/agent-container/src/workspace", () => workspaceMocks)

vi.mock("../../packages/agent-container/src/harness-runtime", () => ({
  createCodingAgentRuntime: vi.fn(() => ({
    currentCursor: vi.fn(() => 0),
    currentSession: vi.fn(() => null),
    interrupt: vi.fn(async () => {}),
    poll: vi.fn(() => ({ events: [], cursor: 0 })),
    send: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
  })),
}))

import { startServer } from "../../packages/agent-container/src/server"

const previousPort = process.env.PORT

describe("agent container server", () => {
  beforeEach(() => {
    process.env.PORT = "0"
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (previousPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = previousPort
    }
  })

  it("does not expose internal error details in a server error response", async () => {
    const internalMessage = "failed at /workspace/private-repository/secret.ts:42:7"
    const internalError = new Error(internalMessage)
    internalError.stack = `${internalError.name}: ${internalMessage}\n    at initializeWorkspace (/workspace/private-repository/secret.ts:42:7)`
    workspaceMocks.initializeWorkspace.mockRejectedValueOnce(internalError)
    const errorLog = vi.spyOn(console, "log").mockImplementation(() => {})

    const server = startServer("codex")
    await once(server, "listening")

    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      })
      const responseText = await response.text()

      expect(response.status).toBe(500)
      expect(JSON.parse(responseText)).toEqual({ error: "Internal server error" })
      expect(responseText).not.toContain(internalMessage)

      const loggedValues = errorLog.mock.calls.flat()
      const loggedError = loggedValues.find((value): value is Error => value instanceof Error)
      const annotations = loggedValues.find(
        (value): value is Record<string, unknown> =>
          typeof value === "object" && value !== null && !(value instanceof Error),
      )

      expect(loggedError).toBe(internalError)
      expect(loggedError?.stack).toContain("initializeWorkspace")
      expect(annotations).toMatchObject({
        event: "agent_container.request_failed",
        method: "POST",
        path: "/init",
        runtimeKind: "codex",
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
