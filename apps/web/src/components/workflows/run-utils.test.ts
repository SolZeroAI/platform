import { describe, expect, it } from "vitest"
import {
  buildWorkflowEditorPrompt,
  getLatestSlackTestTrigger,
  parseSlackTestTriggerInput,
} from "./run-utils"
import type { WorkflowRun } from "./types"

function workflowRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "wfr_1",
    workflowId: "wf_1",
    workflowVersion: 1,
    workflowInstanceId: null,
    status: "completed",
    triggerKind: "slack",
    triggerNodeId: null,
    input: {},
    output: null,
    startedAt: 1,
    completedAt: 2,
    updatedAt: 2,
    error: null,
    ...overrides,
  }
}

describe("Slack workflow test runs", () => {
  it("accepts the preview workflow input JSON shape", () => {
    const trigger = {
      kind: "slack" as const,
      nodeId: "incident_question",
      payload: {
        teamId: "T02P98BKE",
        channelId: "C0BCULSH3QV",
        channelName: "test-incident-0",
        userId: "U01J6SKQK8W",
        text: "<@U0BCGGD1XK9> ack reaction verification",
        eventType: "app_mention",
        command: null,
        messageTs: "1782852795.847629",
        threadTs: "1782852795.847629",
        triggerId: null,
        actionId: null,
        responseUrl: null,
        rawPayload: {
          type: "event_callback",
          event_id: "Ev0BE7RSJX9C",
        },
      },
    }

    expect(
      parseSlackTestTriggerInput(
        JSON.stringify({
          trigger,
          userId: "OCHf35bvvnOF2oHAx9dWygDK7Vvc7fJP",
        }),
        "fallback_node",
      ),
    ).toEqual(trigger)
  })

  it("accepts a raw Slack payload object", () => {
    expect(
      parseSlackTestTriggerInput(
        JSON.stringify({
          teamId: "T1",
          channelId: "C1",
          text: "hello",
        }),
        "slack_event",
      ),
    ).toEqual({
      kind: "slack",
      nodeId: "slack_event",
      payload: {
        teamId: "T1",
        channelId: "C1",
        text: "hello",
      },
    })
  })

  it("rejects explicit non-Slack triggers", () => {
    expect(() =>
      parseSlackTestTriggerInput(
        JSON.stringify({ trigger: { kind: "manual", payload: {} } }),
        "slack_event",
      ),
    ).toThrow("Slack input trigger kind must be slack.")
  })

  it("reuses the latest Slack trigger regardless of the selected node", () => {
    const older = workflowRun({
      id: "wfr_old",
      triggerNodeId: "slack_event",
      startedAt: 10,
      input: {
        trigger: {
          kind: "slack",
          nodeId: "slack_event",
          payload: { text: "old" },
        },
      },
    })
    const newer = workflowRun({
      id: "wfr_new",
      triggerNodeId: "slack_event",
      startedAt: 20,
      input: {
        trigger: {
          kind: "slack",
          nodeId: "slack_event",
          payload: { text: "new" },
        },
      },
    })
    const otherNode = workflowRun({
      id: "wfr_other",
      triggerNodeId: "other_slack_event",
      startedAt: 30,
      input: {
        trigger: {
          kind: "slack",
          nodeId: "other_slack_event",
          payload: { text: "other" },
        },
      },
    })

    expect(getLatestSlackTestTrigger([older, otherNode, newer], "slack_event")).toEqual({
      kind: "slack",
      nodeId: "other_slack_event",
      payload: { text: "other" },
    })
  })
})

describe("workflow editor prompt", () => {
  it("includes selected run inputs and outputs as untrusted runtime context", () => {
    const prompt = buildWorkflowEditorPrompt({
      userPrompt: "Fix the misleading tool availability response.",
      manifest: {
        name: "Alert investigation",
        version: 4,
        nodes: [],
        edges: [],
      },
      runs: [
        workflowRun({
          id: "wfr_failed_context",
          input: { alert: "high latency" },
          output: { response: "No tools were available" },
          error: "agent response was incomplete",
        }),
      ],
      runEventsById: {
        wfr_failed_context: [
          {
            id: "event_1",
            sequence: 12,
            nodeId: "investigate",
            eventType: "node_completed",
            level: "info",
            message: "Investigate completed",
            data: { toolCalls: 4 },
            createdAt: 3,
          },
        ],
      },
    })

    expect(prompt).toContain("Current Workflow YAML:")
    expect(prompt).toContain("Selected Workflow Run Context:")
    expect(prompt).toContain("untrusted runtime evidence")
    expect(prompt).toContain('"id": "wfr_failed_context"')
    expect(prompt).toContain('"alert": "high latency"')
    expect(prompt).toContain('"response": "No tools were available"')
    expect(prompt).toContain('"message": "Investigate completed"')
    expect(prompt).toContain('"toolCalls": 4')
  })

  it("omits the run context section when no runs are selected", () => {
    const prompt = buildWorkflowEditorPrompt({
      userPrompt: "Rename the workflow.",
      manifest: {
        name: "Alert investigation",
        version: 4,
        nodes: [],
        edges: [],
      },
      runs: [],
    })

    expect(prompt).not.toContain("Selected Workflow Run Context:")
  })
})
