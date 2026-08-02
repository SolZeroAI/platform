import { describe, expect, it } from "vitest"
import { isOktaReconnectMcpDiscoveryError, type SandboxEvent } from "@c0-agent/shared"
import {
  formatToolCall,
  formatToolGroup,
  getToolMcpServerRegistrationNames,
  toolMatchesMcpDiscoveryServer,
} from "./tool-formatters"

describe("formatToolCall", () => {
  it("formats isolate custom MCP tool ids for display", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_custom_time__24b0t_get_utc_time",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      result: "2026-05-21T15:52:16Z",
      timestamp: 1,
    }

    const formatted = formatToolCall(event)

    expect(formatted.toolName).toBe("Time MCP")
    expect(formatted.summary).toBe("get UTC time")
    expect(formatted.icon).toBe("plug")
    expect(formatted.getDetails()).toMatchObject({
      metadata: [
        { label: "MCP server", value: "time" },
        { label: "MCP tool", value: "get_utc_time" },
        { label: "Tool id", value: "tool_custom_time__24b0t_get_utc_time" },
      ],
      output: "2026-05-21T15:52:16Z",
    })
  })

  it("keeps a generic icon for unknown tools", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_external_lookup",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event).icon).toBe("tool")
  })

  it("formats wrapped MCP Context Forge isolate tool ids for display", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_mcpcf_grafana_broker_mcp_mcpcf_grafana_broker_mcp__grafana-broker-mcp-list-my-orgs",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event)).toMatchObject({
      toolName: "Grafana Broker MCP",
      summary: "list my orgs",
      icon: "plug",
      mcpLabels: {
        server: "Grafana Broker MCP",
        tool: "list my orgs",
      },
    })
  })

  it("drops broker MCP vendor prefixes from firehydrant tools", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_mcpcf_firehydrant_broker_mcp_token_mcpcf_firehydrant_broker_mcp_token__firehydrant-broker-mcp-firehydrant-list-incidents",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event).mcpLabels).toEqual({
      server: "Firehydrant Broker MCP Token MCP",
      tool: "list incidents",
    })
  })

  it("drops repeated MCP server tokens from broker tool names", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_mcpcf_grafana_broker_mcp_mcpcf_grafana_broker_mcp__grafana-broker-mcp-broker-health",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event).mcpLabels).toEqual({
      server: "Grafana Broker MCP",
      tool: "broker health",
    })
  })

  it("formats underscore-separated MCP Context Forge isolate tool ids for display", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_mcpcf_firehydrant_list_incidents",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event)).toMatchObject({
      toolName: "Firehydrant MCP",
      summary: "list incidents",
      mcpLabels: {
        server: "Firehydrant MCP",
        tool: "list incidents",
      },
    })
  })

  it("formats custom MCP tool ids with short server hashes", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_custom_qa__2s0_check_status",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolCall(event)).toMatchObject({
      toolName: "QA MCP",
      summary: "check status",
      icon: "plug",
    })
  })
})

describe("toolMatchesMcpDiscoveryServer", () => {
  it("matches custom MCP tool ids to discovery server names", () => {
    expect(toolMatchesMcpDiscoveryServer("tool_custom_time__24b0t_get_utc_time", "time")).toBe(true)
    expect(getToolMcpServerRegistrationNames("tool_custom_time__24b0t_get_utc_time")).toContain(
      "time",
    )
  })

  it("matches MCP Context Forge registration names embedded in tool ids", () => {
    expect(
      toolMatchesMcpDiscoveryServer(
        "tool_mcpcf_firehydrant_broker_mcp_token_firehydrant-broker-mcp-firehydrant-list-incidents",
        "mcpcf_firehydrant_broker_mcp_token",
      ),
    ).toBe(true)
  })
})

describe("formatToolGroup", () => {
  it("uses the formatted MCP display name for grouped custom MCP calls", () => {
    const events: SandboxEvent[] = [
      {
        type: "tool_call",
        tool: "tool_custom_time__24b0t_get_utc_time",
        args: {},
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "tool_custom_time__24b0t_get_utc_time",
        args: {},
        callId: "tool-2",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(formatToolGroup(events)).toMatchObject({
      toolName: "Time MCP",
      summary: "2 calls",
      icon: "plug",
    })
  })

  it("summarizes mixed consecutive tool calls", () => {
    const events: SandboxEvent[] = [
      {
        type: "tool_call",
        tool: "tool_custom_time__24b0t_get_utc_time",
        args: {},
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "tool_custom_qa__2s0_check_status",
        args: {},
        callId: "tool-2",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(formatToolGroup(events)).toMatchObject({
      toolName: "Tool calls",
      summary: "2 calls",
      icon: "tool",
    })
  })

  it("uses the formatted tool summary for a single call group", () => {
    const event: SandboxEvent = {
      type: "tool_call",
      tool: "tool_custom_qa__2s0_check_status",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(formatToolGroup([event])).toMatchObject({
      toolName: "QA MCP",
      summary: "check status",
      icon: "plug",
    })
  })
})

describe("isOktaReconnectMcpDiscoveryError", () => {
  it("uses the structured OAuth reconnect discovery reason", () => {
    expect(
      isOktaReconnectMcpDiscoveryError({
        serverName: "MCP Context Forge",
        discoveryReason: "oauth_reconnect_required",
        error: "Discovery failed",
      }),
    ).toBe(true)
  })

  it("recognizes current MCP Context Forge reconnect errors without a typed reason", () => {
    expect(
      isOktaReconnectMcpDiscoveryError({
        serverName: "MCP Context Forge",
        error: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
      }),
    ).toBe(true)
  })

  it("recognizes persisted reconnect errors that were recorded as server unavailable", () => {
    expect(
      isOktaReconnectMcpDiscoveryError({
        serverName: "MCP Context Forge",
        discoveryReason: "server_unavailable",
        error: "Reconnect your configured OAuth account to use MCP Context Forge tools.",
      }),
    ).toBe(true)
  })

  it("does not classify generic MCP Context Forge discovery failures as Okta reconnects", () => {
    expect(
      isOktaReconnectMcpDiscoveryError({
        serverName: "MCP Context Forge",
        discoveryReason: "server_unavailable",
        error: "Streamable HTTP error: upstream unavailable",
      }),
    ).toBe(false)
  })
})
