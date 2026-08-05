import { describe, expect, it } from "vitest"
import {
  issueMcpcfProxyCapability,
  verifyMcpcfProxyCapability,
} from "../../packages/api/src/server/background/auth/mcpcf-capability"
import {
  INTERNAL_AI_SEARCH_MCP_ROUTE,
  INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE,
  MCPCF_PROXY_MCP_ROUTE,
} from "../../packages/api/src/server/background/session/mcp-config"
import {
  isS0McpPath,
  isMcpcfProxyMcpPath,
  isMcpPath,
  shouldDispatchMcpRequest,
} from "../../packages/api/src/server/mcp/internal-routes"

const SIGNING_SECRET = "test-mcpcf-proxy-signing-secret-at-least-32-bytes"

function requestFor(pathname: string, token?: string): Request {
  return new Request(`https://api.s0.example.com${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

describe("MCP route auth", () => {
  it("classifies s0 MCP and MCPCF proxy routes separately", () => {
    expect(isS0McpPath(INTERNAL_AI_SEARCH_MCP_ROUTE)).toBe(true)
    expect(isS0McpPath(`${INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE}/`)).toBe(true)
    expect(isS0McpPath(MCPCF_PROXY_MCP_ROUTE)).toBe(false)
    expect(isMcpcfProxyMcpPath(MCPCF_PROXY_MCP_ROUTE)).toBe(true)
    expect(isMcpcfProxyMcpPath(`${MCPCF_PROXY_MCP_ROUTE}/`)).toBe(true)
    expect(isMcpPath(MCPCF_PROXY_MCP_ROUTE)).toBe(true)
    expect(isMcpPath("/mcp/mcpcf")).toBe(false)
    expect(isMcpPath("/mcp/unknown")).toBe(false)
  })

  it("dispatches s0 MCP only when its worker route is enabled", async () => {
    for (const route of [INTERNAL_AI_SEARCH_MCP_ROUTE, INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE]) {
      await expect(
        shouldDispatchMcpRequest({
          request: requestFor(route),
          workerRouteEnabled: true,
        }),
      ).resolves.toBe(true)
      await expect(
        shouldDispatchMcpRequest({
          request: requestFor(route),
          workerRouteEnabled: false,
        }),
      ).resolves.toBe(false)
    }
  })

  it("requires a valid session-bound capability for the MCPCF proxy", async () => {
    const token = await issueMcpcfProxyCapability(SIGNING_SECRET, "session_123")
    await expect(verifyMcpcfProxyCapability(token, SIGNING_SECRET)).resolves.toBe("session_123")

    for (const request of [
      requestFor(MCPCF_PROXY_MCP_ROUTE),
      requestFor(MCPCF_PROXY_MCP_ROUTE, "invalid-token"),
      requestFor(MCPCF_PROXY_MCP_ROUTE, token),
    ]) {
      const expected = request.headers.get("authorization") === `Bearer ${token}`
      await expect(
        shouldDispatchMcpRequest({
          request,
          mcpcfProxySigningSecret: SIGNING_SECRET,
          workerRouteEnabled: true,
        }),
      ).resolves.toBe(expected)
    }
  })

  it("rejects capabilities signed with a different key", async () => {
    const token = await issueMcpcfProxyCapability(SIGNING_SECRET, "session_123")
    await expect(
      shouldDispatchMcpRequest({
        request: requestFor(MCPCF_PROXY_MCP_ROUTE, token),
        mcpcfProxySigningSecret: "different-signing-secret-that-is-at-least-32-bytes",
        workerRouteEnabled: false,
      }),
    ).resolves.toBe(false)
  })

  it("rejects expired capabilities", async () => {
    const token = await issueMcpcfProxyCapability(SIGNING_SECRET, "session_123", -60)
    await expect(verifyMcpcfProxyCapability(token, SIGNING_SECRET)).rejects.toThrow()
  })
})
