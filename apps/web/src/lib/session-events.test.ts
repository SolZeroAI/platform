import { describe, expect, it } from "vitest"
import type { SandboxEvent, ServerMessage } from "@c0-agent/shared"
import {
  buildToolCallDiscoveryErrorMap,
  collapseTimelineEvents,
  isToolCallFailed,
  formatExecutionDuration,
  getActiveAssistantTimelineKey,
  getAssistantTimelineKey,
  getAutoExpandedMcpDiscoveryErrorKey,
  getStreamingExpandedGroupId,
  getExecutionDurationMsByMessageId,
  getFinalAssistantTimelineKeys,
  getMcpDiscoveryErrorTimelineKey,
  shouldHideMcpDiscoveryError,
} from "./session-events"
import { parseReasoningSummary } from "./reasoning-summary"

describe("parseReasoningSummary", () => {
  it("extracts a leading summary title and leaves markdown body", () => {
    expect(
      parseReasoningSummary(
        "**Continuing Quality Review**\n\nDetails.\n\n**Next section**\n\nMore.",
      ),
    ).toEqual({
      title: "Continuing Quality Review",
      body: "Details.\n\n**Next section**\n\nMore.",
    })
  })

  it("extracts a completed title before its streamed body arrives", () => {
    expect(parseReasoningSummary("**Continuing Quality Review**")).toEqual({
      title: "Continuing Quality Review",
      body: "",
    })
  })

  it("preserves markdown-significant indentation in the extracted body", () => {
    expect(
      parseReasoningSummary("**Continuing Quality Review**\n\n    const value = true\n"),
    ).toEqual({
      title: "Continuing Quality Review",
      body: "    const value = true",
    })
  })

  it("does not consume ordinary leading bold content", () => {
    expect(parseReasoningSummary("**Important:** keep this in the body.")).toEqual({
      title: null,
      body: "**Important:** keep this in the body.",
    })
  })

  it("leaves content without a leading title in its body", () => {
    expect(parseReasoningSummary("Details only.")).toEqual({
      title: null,
      body: "Details only.",
    })
  })
})

describe("collapseTimelineEvents", () => {
  it("keeps separate assistant messages for the same prompt", () => {
    const events: SandboxEvent[] = [
      {
        type: "token",
        content: "First assistant response",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "Read",
        args: { filePath: "README.md" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "Second assistant response",
        messageId: "prompt-1",
        assistantMessageId: "assistant-2",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ]

    expect(collapseTimelineEvents(events).map((event) => event.content ?? event.tool)).toEqual([
      "First assistant response",
      "Read",
      "Second assistant response",
    ])
  })

  it("collapses adjacent visible assistant token updates for one assistant message", () => {
    const events: SandboxEvent[] = [
      {
        type: "token",
        content: "First",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "token",
        content: "First assistant response",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "token",
        content: "First assistant response",
        assistantMessageId: "assistant-1",
      },
    ])
  })

  it("collapses streaming reasoning updates for one assistant message", () => {
    const events: SandboxEvent[] = [
      {
        type: "reasoning",
        content: "Acknowledging user input",
        messageId: "prompt-1",
        assistantMessageId: "assistant-reasoning-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "reasoning",
        content: "Acknowledging user input\n\nI should answer concisely.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-reasoning-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "Ready.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-final-1",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "reasoning",
        content: "Acknowledging user input\n\nI should answer concisely.",
        assistantMessageId: "assistant-reasoning-1",
      },
      {
        type: "token",
        content: "Ready.",
        assistantMessageId: "assistant-final-1",
      },
    ])
  })

  it("drops general errors duplicated by MCP discovery failures", () => {
    const events: SandboxEvent[] = [
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect Okta in Settings to use MCP Context Forge tools.",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
        terminal: true,
      },
      {
        type: "error",
        error: "Reconnect Okta in Settings to use MCP Context Forge tools.",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "mcp_discovery_error",
        terminal: true,
      },
    ])
  })

  it("preserves legacy assistant token runs separated by tool calls", () => {
    const events: SandboxEvent[] = [
      {
        type: "token",
        content: "Looking that up",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "Grep",
        args: { pattern: "coordinator" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "Here is what I found",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ]

    expect(collapseTimelineEvents(events).map((event) => event.content ?? event.tool)).toEqual([
      "Looking that up",
      "Grep",
      "Here is what I found",
    ])
  })

  it("collapses adjacent legacy streaming updates", () => {
    const events: SandboxEvent[] = [
      {
        type: "token",
        content: "First",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "token",
        content: "First response",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "token",
        content: "First response",
      },
    ])
  })

  it("merges successful tool results into the visible tool call", () => {
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
        type: "tool_result",
        callId: "tool-1",
        result: "2026-05-21T15:52:16Z",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "tool_call",
        output: "2026-05-21T15:52:16Z",
        result: "2026-05-21T15:52:16Z",
        success: true,
      },
    ])
  })

  it("annotates failed tool calls without duplicating tool_result rows", () => {
    const events: SandboxEvent[] = [
      {
        type: "tool_call",
        tool: "Bash",
        args: { command: "exit 1" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_result",
        callId: "tool-1",
        result: "",
        error: "Command failed",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(collapseTimelineEvents(events)).toMatchObject([
      {
        type: "tool_call",
        error: "Command failed",
        success: false,
      },
    ])
  })

  it("consumes sandbox events from the shared session socket message contract", () => {
    const callMessage = {
      type: "sandbox_event",
      event: {
        type: "tool_call",
        tool: "Read",
        args: { filePath: "CONTEXT.md" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "runtime-1",
        timestamp: 1,
      },
    } satisfies ServerMessage
    const resultMessage = {
      type: "sandbox_event",
      event: {
        type: "tool_result",
        callId: "tool-1",
        result: "domain context",
        messageId: "prompt-1",
        sandboxId: "runtime-1",
        timestamp: 2,
      },
    } satisfies ServerMessage

    expect(collapseTimelineEvents([callMessage.event, resultMessage.event])).toMatchObject([
      {
        type: "tool_call",
        output: "domain context",
        result: "domain context",
        success: true,
      },
    ])
  })
})

describe("isToolCallFailed", () => {
  it("treats execution and discovery failures as failed tool calls", () => {
    const failedCall: SandboxEvent = {
      type: "tool_call",
      tool: "Bash",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      error: "Command failed",
      success: false,
      timestamp: 1,
    }
    const discoveryError: SandboxEvent = {
      type: "mcp_discovery_error",
      serverName: "time",
      error: "MCP server unavailable",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    expect(isToolCallFailed(failedCall)).toBe(true)
    expect(
      isToolCallFailed(
        {
          type: "tool_call",
          tool: "tool_custom_time__24b0t_get_utc_time",
          args: {},
          callId: "tool-2",
          messageId: "prompt-1",
          sandboxId: "sandbox-1",
          timestamp: 2,
        },
        discoveryError,
      ),
    ).toBe(true)
  })
})

describe("buildToolCallDiscoveryErrorMap", () => {
  it("links MCP discovery errors to matching tool calls on the same prompt", () => {
    const discoveryError: SandboxEvent = {
      type: "mcp_discovery_error",
      serverName: "time",
      error: "MCP server unavailable",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }
    const toolCall: SandboxEvent = {
      type: "tool_call",
      tool: "tool_custom_time__24b0t_get_utc_time",
      args: {},
      callId: "tool-1",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 2,
    }

    const { discoveryErrorsByCallId, hiddenDiscoveryErrorKeys } = buildToolCallDiscoveryErrorMap([
      discoveryError,
      toolCall,
    ])

    expect(discoveryErrorsByCallId.get("tool-1")).toEqual(discoveryError)
    expect(shouldHideMcpDiscoveryError(discoveryError, hiddenDiscoveryErrorKeys)).toBe(true)
  })

  it("keeps unmatched MCP discovery errors visible in the timeline", () => {
    const discoveryError: SandboxEvent = {
      type: "mcp_discovery_error",
      serverName: "time",
      error: "MCP server unavailable",
      messageId: "prompt-1",
      sandboxId: "sandbox-1",
      timestamp: 1,
    }

    const { hiddenDiscoveryErrorKeys } = buildToolCallDiscoveryErrorMap([discoveryError])

    expect(shouldHideMcpDiscoveryError(discoveryError, hiddenDiscoveryErrorKeys)).toBe(false)
  })
})

describe("getFinalAssistantTimelineKeys", () => {
  it("marks the latest assistant message before execution complete as final for the prompt", () => {
    const events = collapseTimelineEvents([
      {
        type: "token",
        content: "Progress update",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "Read",
        args: { filePath: "README.md" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "Final response",
        messageId: "prompt-1",
        assistantMessageId: "assistant-2",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
      {
        type: "execution_complete",
        messageId: "prompt-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 4,
      },
    ])

    const finalToken = events.find(
      (event) => event.type === "token" && event.content === "Final response",
    )
    const finalKey = finalToken ? getAssistantTimelineKey(finalToken) : null

    expect(finalKey).not.toBeNull()
    expect([...getFinalAssistantTimelineKeys(events)]).toEqual([finalKey])
  })

  it("does not mark reasoning as the final assistant response", () => {
    const events = collapseTimelineEvents([
      {
        type: "token",
        content: "Final response",
        messageId: "prompt-1",
        assistantMessageId: "assistant-final-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "reasoning",
        content: "Double checking whether the answer is complete.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-reasoning-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "execution_complete",
        messageId: "prompt-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ])

    const finalToken = events.find(
      (event) => event.type === "token" && event.content === "Final response",
    )
    const finalKey = finalToken ? getAssistantTimelineKey(finalToken) : null

    expect(finalKey).not.toBeNull()
    expect([...getFinalAssistantTimelineKeys(events)]).toEqual([finalKey])
  })

  it("tracks final assistant responses independently for each prompt", () => {
    const events = collapseTimelineEvents([
      {
        type: "token",
        content: "Prompt 1 final",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "execution_complete",
        messageId: "prompt-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "Prompt 2 progress",
        messageId: "prompt-2",
        assistantMessageId: "assistant-2",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ])

    const finalToken = events.find(
      (event) => event.type === "token" && event.content === "Prompt 1 final",
    )
    const finalKey = finalToken ? getAssistantTimelineKey(finalToken) : null

    expect(finalKey).not.toBeNull()
    expect([...getFinalAssistantTimelineKeys(events)]).toEqual([finalKey])
  })
})

describe("getExecutionDurationMsByMessageId", () => {
  it("measures elapsed time from the user prompt to execution complete", () => {
    const durations = getExecutionDurationMsByMessageId([
      {
        type: "user_message",
        content: "What time is it?",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 100,
      },
      {
        type: "token",
        content: "It is 18:03 UTC.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 102,
      },
      {
        type: "execution_complete",
        messageId: "prompt-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 103.4,
      },
    ])

    expect(durations.get("prompt-1")).toBe(3400)
  })

  it("measures resumed prompt duration from the latest user prompt", () => {
    const durations = getExecutionDurationMsByMessageId([
      {
        type: "user_message",
        content: "What pod is using the most CPU?",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 100,
      },
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect Okta",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 102,
        terminal: true,
      },
      {
        type: "resume_started",
        messageId: "resume-1",
        resumedFromMessageId: "prompt-1",
        reason: "okta_reconnect",
        summary: "Resuming after Okta authentication",
        sandboxId: "sandbox-1",
        timestamp: 120,
      },
      {
        type: "execution_complete",
        messageId: "resume-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 124.25,
      },
    ])

    expect(durations.get("resume-1")).toBe(24250)
  })

  it("skips resumed completions without a previous user prompt", () => {
    const durations = getExecutionDurationMsByMessageId([
      {
        type: "resume_started",
        messageId: "resume-1",
        resumedFromMessageId: "prompt-1",
        reason: "okta_reconnect",
        summary: "Resuming after Okta authentication",
        sandboxId: "sandbox-1",
        timestamp: 100,
      },
      {
        type: "execution_complete",
        messageId: "resume-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 104.25,
      },
    ])

    expect(durations.has("resume-1")).toBe(false)
  })

  it("skips completions without a matching start event", () => {
    const durations = getExecutionDurationMsByMessageId([
      {
        type: "execution_complete",
        messageId: "prompt-1",
        success: true,
        sandboxId: "sandbox-1",
        timestamp: 103.4,
      },
    ])

    expect(durations.has("prompt-1")).toBe(false)
  })
})

describe("formatExecutionDuration", () => {
  it.each([
    [500, "less than 1s"],
    [1_200, "1s"],
    [64_500, "1m 5s"],
    [3_600_000, "1h"],
    [7_530_000, "2h 5m"],
  ])("formats %dms as %s", (durationMs, label) => {
    expect(formatExecutionDuration(durationMs)).toBe(label)
  })
})

describe("getActiveAssistantTimelineKey", () => {
  it("returns the active assistant token when the latest timeline event is a token", () => {
    const events = collapseTimelineEvents([
      {
        type: "user_message",
        content: "Do the thing",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "token",
        content: "Working on it",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ])

    const activeToken = events.find((event) => event.type === "token")

    expect(getActiveAssistantTimelineKey(events)).toBe(
      activeToken ? getAssistantTimelineKey(activeToken) : null,
    )
  })

  it("returns the active assistant reasoning when the latest timeline event is reasoning", () => {
    const events = collapseTimelineEvents([
      {
        type: "user_message",
        content: "test",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "reasoning",
        content: "I should acknowledge this input.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-reasoning-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ])

    expect(getActiveAssistantTimelineKey(events)).toBe("assistant-reasoning-1")
  })

  it("does not return an assistant token after a later runtime event arrives", () => {
    const events = collapseTimelineEvents([
      {
        type: "token",
        content: "I will check",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "Read",
        args: { filePath: "README.md" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ])

    expect(getActiveAssistantTimelineKey(events)).toBeNull()
  })
})

describe("getStreamingExpandedGroupId", () => {
  it("expands the last tool group while processing", () => {
    const groups = [
      {
        type: "single" as const,
        id: "single-token-1",
        event: {
          type: "user_message" as const,
          content: "Hi",
          messageId: "prompt-1",
          sandboxId: "sandbox-1",
          timestamp: 1,
        },
      },
      {
        type: "tool_group" as const,
        id: "tool-group-1",
      },
    ]

    expect(getStreamingExpandedGroupId(groups, true)).toBe("tool-group-1")
    expect(getStreamingExpandedGroupId(groups, false)).toBeNull()
  })

  it("expands the last discovery error while processing", () => {
    const groups = [
      {
        type: "single" as const,
        id: "single-discovery-1",
        event: {
          type: "mcp_discovery_error" as const,
          serverName: "grafana",
          error: "Unavailable",
          messageId: "prompt-1",
          sandboxId: "sandbox-1",
          timestamp: 1,
        },
      },
    ]

    expect(getStreamingExpandedGroupId(groups, true)).toBe("single-discovery-1")
  })

  it("expands the last reasoning event while processing", () => {
    const groups = [
      {
        type: "single" as const,
        id: "single-reasoning-1",
        event: {
          type: "reasoning" as const,
          content: "I should inspect the configured MCPs.",
          messageId: "prompt-1",
          assistantMessageId: "assistant-reasoning-1",
          sandboxId: "sandbox-1",
          timestamp: 1,
        },
      },
    ]

    expect(getStreamingExpandedGroupId(groups, true)).toBe("single-reasoning-1")
    expect(getStreamingExpandedGroupId(groups, false)).toBeNull()
  })

  it("collapses layer cards when assistant tokens stream after tools", () => {
    const groups = [
      {
        type: "tool_group" as const,
        id: "tool-group-1",
      },
      {
        type: "single" as const,
        id: "single-token-1",
        event: {
          type: "token" as const,
          content: "Here is the answer",
          messageId: "prompt-1",
          sandboxId: "sandbox-1",
          timestamp: 2,
        },
      },
    ]

    expect(getStreamingExpandedGroupId(groups, true)).toBeNull()
  })

  it("moves focus from discovery error to a newer tool group", () => {
    const groups = [
      {
        type: "single" as const,
        id: "single-discovery-1",
        event: {
          type: "mcp_discovery_error" as const,
          serverName: "grafana",
          error: "Unavailable",
          messageId: "prompt-1",
          sandboxId: "sandbox-1",
          timestamp: 1,
        },
      },
      {
        type: "tool_group" as const,
        id: "tool-group-1",
      },
    ]

    expect(getStreamingExpandedGroupId(groups, true)).toBe("tool-group-1")
  })
})

describe("getAutoExpandedMcpDiscoveryErrorKey", () => {
  it("returns the latest terminal discovery error only when the session is idle", () => {
    const events: SandboxEvent[] = [
      {
        type: "user_message",
        content: "Check Grafana",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect Okta",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
        terminal: true,
      },
    ]

    expect(getAutoExpandedMcpDiscoveryErrorKey(events, false)).toBe(
      getMcpDiscoveryErrorTimelineKey(events[1]!),
    )
    expect(getAutoExpandedMcpDiscoveryErrorKey(events, true)).toBeNull()
  })

  it("does not auto-expand stale discovery errors after later timeline events", () => {
    const events: SandboxEvent[] = [
      {
        type: "mcp_discovery_error",
        serverName: "MCP Context Forge",
        error: "Reconnect Okta",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
        terminal: true,
      },
      {
        type: "resume_started",
        messageId: "prompt-2",
        resumedFromMessageId: "prompt-1",
        reason: "okta_reconnect",
        summary: "Resuming after Okta authentication",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
    ]

    expect(getAutoExpandedMcpDiscoveryErrorKey(events, false)).toBeNull()
  })

  it("does not auto-expand non-terminal discovery errors", () => {
    const events: SandboxEvent[] = [
      {
        type: "mcp_discovery_error",
        serverName: "time",
        error: "MCP unavailable",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
    ]

    expect(getAutoExpandedMcpDiscoveryErrorKey(events, false)).toBeNull()
  })
})
