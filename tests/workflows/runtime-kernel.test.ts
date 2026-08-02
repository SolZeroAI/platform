import { describe, expect, it } from "vitest"
import {
  createWorkflowRuntimeKernel,
  normalizeActionResult,
} from "../../packages/api/src/server/background/workflows/runtime-kernel"
import { WORKFLOW_MANIFEST_VERSION, type WorkflowManifest } from "../../packages/shared/src"

function multiBranchManifest(): WorkflowManifest {
  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name: "Kernel workflow",
    nodes: [
      {
        id: "manual",
        type: "manual-trigger",
        label: "Manual",
        position: { x: 80, y: 100 },
        options: {},
      },
      {
        id: "webhook",
        type: "webhook-trigger",
        label: "Webhook",
        position: { x: 80, y: 260 },
        options: {},
      },
      {
        id: "branch",
        type: "if-else",
        label: "If / Else",
        position: { x: 320, y: 100 },
        options: {},
      },
      {
        id: "manualAction",
        type: "javascript",
        label: "Manual action",
        position: { x: 560, y: 80 },
        options: {
          inputValues: {
            fallback: "configured",
            payload: "overridden",
          },
        },
      },
      {
        id: "webhookAction",
        type: "javascript",
        label: "Webhook action",
        position: { x: 560, y: 260 },
        options: {},
      },
    ],
    edges: [
      {
        id: "manual-branch",
        source: "manual",
        target: "branch",
        sourceHandle: "payload",
        targetHandle: "value",
      },
      {
        id: "branch-manual-action",
        source: "branch",
        target: "manualAction",
        sourceHandle: "true",
        targetHandle: "payload",
      },
      {
        id: "webhook-action",
        source: "webhook",
        target: "webhookAction",
        sourceHandle: "body",
        targetHandle: "payload",
      },
    ],
  }
}

describe("workflow runtime kernel", () => {
  it("creates outputs only for the active trigger branch", () => {
    const kernel = createWorkflowRuntimeKernel(multiBranchManifest())

    const outputs = kernel.createInitialOutputs(
      {
        kind: "manual",
        nodeId: "manual",
        payload: { deploy: true },
      },
      "2026-01-01T00:00:00.000Z",
    )

    expect(outputs).toEqual({
      manual: {
        payload: { deploy: true },
      },
    })
    expect(kernel.shouldRunNode("branch", outputs, new Set())).toBe(true)
    expect(kernel.shouldRunNode("webhookAction", outputs, new Set())).toBe(false)
  })

  it("collects connected inputs over configured fallback values", () => {
    const kernel = createWorkflowRuntimeKernel(multiBranchManifest())

    const inputs = kernel.collectInputs("manualAction", {
      manual: {
        payload: { deploy: true },
      },
      branch: {
        true: { ok: true },
        condition: true,
      },
    })

    expect(inputs).toEqual({
      fallback: "configured",
      payload: { ok: true },
    })
  })

  it("gates inactive branch handles and skipped upstream nodes", () => {
    const kernel = createWorkflowRuntimeKernel(multiBranchManifest())

    expect(
      kernel.shouldRunNode(
        "manualAction",
        {
          manual: {
            payload: {},
          },
          branch: {
            condition: false,
            false: {},
          },
        },
        new Set(),
      ),
    ).toBe(false)
    expect(
      kernel.shouldRunNode(
        "manualAction",
        {
          manual: {
            payload: {},
          },
          branch: {
            true: {},
            condition: true,
          },
        },
        new Set(["branch"]),
      ),
    ).toBe(false)
  })

  it("activates only the addressed Slack trigger branch and redacts response URLs from events", () => {
    const manifest = multiBranchManifest()
    manifest.nodes.push(
      {
        id: "slackMention",
        type: "slack-trigger",
        label: "Slack mention",
        position: { x: 80, y: 420 },
        options: { surface: "event", eventTypes: ["app_mention"] },
      },
      {
        id: "slackKeyword",
        type: "slack-trigger",
        label: "Slack keyword",
        position: { x: 80, y: 560 },
        options: { surface: "event", eventTypes: ["message"], keywordRules: ["error"] },
      },
      {
        id: "mentionAction",
        type: "javascript",
        label: "Mention action",
        position: { x: 320, y: 420 },
        options: {},
      },
      {
        id: "keywordAction",
        type: "javascript",
        label: "Keyword action",
        position: { x: 320, y: 560 },
        options: {},
      },
    )
    manifest.edges.push(
      {
        id: "mention-action",
        source: "slackMention",
        target: "mentionAction",
        sourceHandle: "text",
        targetHandle: "payload",
      },
      {
        id: "keyword-action",
        source: "slackKeyword",
        target: "keywordAction",
        sourceHandle: "text",
        targetHandle: "payload",
      },
    )

    const kernel = createWorkflowRuntimeKernel(manifest)
    const outputs = kernel.createInitialOutputs(
      {
        kind: "slack",
        nodeId: "slackMention",
        payload: {
          teamId: "T1",
          channelId: "C1",
          channelName: "incident-api",
          userId: "U1",
          text: "which deploy preceded this?",
          eventType: "app_mention",
          messageTs: "123.4",
          threadTs: "123.4",
          responseUrl: "https://hooks.slack.com/secret",
          rawPayload: { ok: true },
        },
      },
      "2026-01-01T00:00:00.000Z",
    )

    expect(outputs).toEqual({
      slackMention: expect.objectContaining({
        channelId: "C1",
        text: "which deploy preceded this?",
        responseUrl: "https://hooks.slack.com/secret",
      }),
    })
    expect(kernel.shouldRunNode("mentionAction", outputs, new Set())).toBe(true)
    expect(kernel.shouldRunNode("keywordAction", outputs, new Set())).toBe(false)
    expect(kernel.redactWorkflowOutputsForEvent(outputs).slackMention?.responseUrl).toBe(
      "[redacted]",
    )
  })

  it("redacts secret outputs and downstream inputs", () => {
    const manifest = multiBranchManifest()
    manifest.nodes.push(
      {
        id: "secret",
        type: "get-secret",
        label: "Get secret",
        position: { x: 320, y: 420 },
        options: {},
      },
      {
        id: "combine",
        type: "json-object",
        label: "JSON Object",
        position: { x: 560, y: 420 },
        options: { fields: ["token"] },
      },
      {
        id: "notify",
        type: "slack-send-message",
        label: "Slack",
        position: { x: 760, y: 420 },
        options: {},
      },
    )
    manifest.edges.push(
      {
        id: "secret-combine",
        source: "secret",
        target: "combine",
        sourceHandle: "value",
        targetHandle: "token",
      },
      {
        id: "combine-notify",
        source: "combine",
        target: "notify",
        sourceHandle: "object",
        targetHandle: "text",
      },
    )
    const kernel = createWorkflowRuntimeKernel(manifest)
    const secretNode = manifest.nodes.find((node) => node.id === "secret")
    if (!secretNode) {
      throw new Error("missing test node")
    }

    expect(
      kernel.redactActionResultForEvent(secretNode, {
        outputs: {
          found: true,
          value: "super-secret",
        },
      }),
    ).toEqual({
      outputs: {
        found: true,
        value: "[redacted]",
      },
    })
    expect(
      kernel.redactWorkflowOutputsForEvent({
        secret: {
          value: "super-secret",
        },
        combine: {
          object: {
            token: "super-secret",
          },
        },
      }),
    ).toEqual({
      secret: {
        value: "[redacted]",
      },
      combine: {
        object: {
          token: "[redacted]",
        },
      },
    })
    expect(
      kernel.redactInputsForEvent("notify", {
        text: {
          token: "super-secret",
        },
      }),
    ).toEqual({
      text: "[redacted]",
    })
  })

  it("normalizes primitive action results without wrapping existing output envelopes", () => {
    expect(normalizeActionResult("done")).toEqual({
      outputs: {
        result: "done",
      },
    })
    expect(normalizeActionResult({ outputs: { ok: true }, extra: "kept" })).toEqual({
      outputs: { ok: true },
      extra: "kept",
    })
  })
})
