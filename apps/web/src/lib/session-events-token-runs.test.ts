import { describe, expect, it } from "vitest"
import type { SandboxEvent } from "@c0-agent/shared"
import {
  collapseTimelineEvents,
  getAssistantTimelineKey,
  getFinalAssistantTimelineKeys,
} from "./session-events"

describe("session event assistant token runs", () => {
  it("keeps visible assistant token snapshots separated by runtime events", () => {
    const events: SandboxEvent[] = [
      {
        type: "token",
        content: "I am checking the opencode config path.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 1,
      },
      {
        type: "tool_call",
        tool: "glob",
        args: { pattern: "**/opencode.json" },
        callId: "tool-1",
        messageId: "prompt-1",
        sandboxId: "sandbox-1",
        timestamp: 2,
      },
      {
        type: "token",
        content: "I am checking the opencode config path.\n\nI have loaded the config rules.",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
        sandboxId: "sandbox-1",
        timestamp: 3,
      },
    ]

    expect(collapseTimelineEvents(events).map((event) => event.content ?? event.tool)).toEqual([
      "I am checking the opencode config path.",
      "glob",
      "I am checking the opencode config path.\n\nI have loaded the config rules.",
    ])
  })

  it("marks only the latest token snapshot as final when an assistant id repeats", () => {
    const events = collapseTimelineEvents([
      {
        type: "token",
        content: "Progress",
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
        content: "Progress complete",
        messageId: "prompt-1",
        assistantMessageId: "assistant-1",
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
      (event) => event.type === "token" && event.content === "Progress complete",
    )
    const firstToken = events.find(
      (event) => event.type === "token" && event.content === "Progress",
    )
    const finalKey = finalToken ? getAssistantTimelineKey(finalToken) : null

    expect(finalKey).not.toBeNull()
    expect(firstToken ? getAssistantTimelineKey(firstToken) : null).not.toBe(finalKey)
    expect([...getFinalAssistantTimelineKeys(events)]).toEqual([finalKey])
  })
})
