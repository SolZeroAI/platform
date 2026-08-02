import { describe, expect, it } from "vitest"
import {
  WORKFLOW_MANIFEST_VERSION,
  WORKFLOW_TEMPLATES,
  getWorkflowExecutionOrder,
  parseWorkflowExport,
  serializeWorkflowExport,
  validateWorkflowDraft,
  type WorkflowManifest,
} from "../../packages/shared/src"

function storageManifest(): WorkflowManifest {
  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name: "Export me",
    nodes: [
      {
        id: "manual",
        type: "manual-trigger",
        label: "Manual",
        position: { x: 80, y: 120 },
        options: {},
      },
      {
        id: "save",
        type: "r2-put-object",
        label: "Save",
        position: { x: 340, y: 120 },
        options: {
          bucket: "WORKFLOW_BUCKET",
          key: "workflow-outputs/{{workflowId}}/{{runId}}/save.json",
        },
      },
    ],
    edges: [
      {
        id: "manual-save",
        source: "manual",
        target: "save",
        sourceHandle: "payload",
        targetHandle: "content",
      },
    ],
  }
}

describe("workflow authoring helpers", () => {
  it("round-trips portable YAML exports without owner or runtime metadata", () => {
    const yaml = serializeWorkflowExport({
      manifest: storageManifest(),
      exportedAt: "2026-05-11T00:00:00.000Z",
      sourceManifestVersion: 7,
    })

    expect(yaml).toContain("kind: c0.workflow")
    expect(yaml).toContain("executionOrder:")
    expect(yaml).toContain("workflow-outputs/{{workflowId}}/{{runId}}/save.json")
    expect(yaml).not.toContain("userId")
    expect(yaml).not.toContain("webhookId")
    expect(yaml).not.toContain("manifestKey")
    expect(yaml).not.toContain("codeKey")

    const parsed = parseWorkflowExport(yaml)
    expect(parsed.manifest).toEqual(storageManifest())
    expect(parsed.executionOrder).toEqual(["manual", "save"])
    expect(parsed.metadata.sourceManifestVersion).toBe(7)
  })

  it("derives execution order and rejects cycles", () => {
    expect(getWorkflowExecutionOrder(storageManifest())).toEqual(["manual", "save"])

    const manifest = storageManifest()
    manifest.edges.push({
      id: "save-manual",
      source: "save",
      target: "manual",
      sourceHandle: "bucket",
      targetHandle: "payload",
    })

    expect(() => getWorkflowExecutionOrder(manifest)).toThrow("Workflow graph contains a cycle")
  })

  it("normalizes pre-v2 R2 save encodings to text", () => {
    const validation = validateWorkflowDraft({
      ...storageManifest(),
      version: 1,
      nodes: storageManifest().nodes.map((node) =>
        node.id === "save"
          ? {
              ...node,
              options: {
                ...node.options,
                contentType: "image/png",
                encoding: "base64",
              },
            }
          : node,
      ),
    })

    expect(validation.valid).toBe(true)
    expect(validation.manifest?.version).toBe(WORKFLOW_MANIFEST_VERSION)
    expect(validation.manifest?.nodes.find((node) => node.id === "save")?.options).toMatchObject({
      encoding: "text",
    })
  })

  it("normalizes pre-v4 Isolate nodes to disabled sub-agents", () => {
    const validation = validateWorkflowDraft({
      version: 3,
      name: "Legacy Isolate",
      nodes: [
        {
          id: "agent",
          type: "isolate-session",
          label: "Agent",
          position: { x: 0, y: 0 },
          options: { model: "litellm/gpt-5.4-mini", subagents: "enabled" },
        },
      ],
      edges: [],
    })

    expect(validation.valid).toBe(true)
    expect(validation.manifest?.version).toBe(WORKFLOW_MANIFEST_VERSION)
    expect(validation.manifest?.nodes[0]?.options.subagents).toBe("disabled")
  })

  it("validates storage portability without rewriting authored keys", () => {
    const manifest = storageManifest()
    manifest.nodes[1] = {
      ...manifest.nodes[1],
      options: {
        ...manifest.nodes[1].options,
        key: "kfjowM6F6tYOJm5T8JmR6JeJZI8fTx5K/workflow-outputs/{{runId}}.json",
      },
    }

    const validation = validateWorkflowDraft(manifest)

    expect(validation.valid).toBe(true)
    expect(validation.warnings.join("\n")).toContain("appears to include a user prefix")
    expect(validation.manifest?.nodes[1]?.options.key).toBe(
      "kfjowM6F6tYOJm5T8JmR6JeJZI8fTx5K/workflow-outputs/{{runId}}.json",
    )
  })

  it("rejects invalid node types, broken edges, and unsupported storage bindings", () => {
    expect(
      validateWorkflowDraft({
        ...storageManifest(),
        nodes: [{ id: "bad", type: "unknown", label: "Bad", options: {} }],
      }).errors[0],
    ).toContain("invalid type")

    expect(
      validateWorkflowDraft({
        ...storageManifest(),
        edges: [{ id: "bad-edge", source: "missing", target: "save" }],
      }).errors[0],
    ).toContain("unknown source node")

    expect(
      validateWorkflowDraft({
        ...storageManifest(),
        edges: [
          {
            id: "bad-source-handle",
            source: "manual",
            target: "save",
            sourceHandle: "missing",
            targetHandle: "content",
          },
        ],
      }).errors[0],
    ).toContain("unknown source handle")

    expect(
      validateWorkflowDraft({
        ...storageManifest(),
        edges: [
          {
            id: "bad-target-handle",
            source: "manual",
            target: "save",
            sourceHandle: "payload",
            targetHandle: "missing",
          },
        ],
      }).errors[0],
    ).toContain("unknown target handle")

    const manifest = storageManifest()
    manifest.nodes[1] = {
      ...manifest.nodes[1],
      options: {
        ...manifest.nodes[1].options,
        bucket: "DO_NOT_USE",
      },
    }

    expect(validateWorkflowDraft(manifest).errors[0]).toContain("unsupported R2 bucket")
  })

  it("rejects templates that reference unconnected node outputs", () => {
    const manifest = storageManifest()
    manifest.nodes[1] = {
      ...manifest.nodes[1],
      options: {
        ...manifest.nodes[1].options,
        key: "{{nodes.manual.payload.id}}.json",
      },
    }

    const validation = validateWorkflowDraft(manifest)

    expect(validation.valid).toBe(false)
    expect(validation.errors[0]).toContain("templates can only read connected inputs")
  })

  it("rejects input templates without a matching connected target handle", () => {
    const manifest = storageManifest()
    manifest.nodes[1] = {
      ...manifest.nodes[1],
      options: {
        ...manifest.nodes[1].options,
        key: "{{inputs.missing}}.json",
      },
    }

    const validation = validateWorkflowDraft(manifest)

    expect(validation.valid).toBe(false)
    expect(validation.errors[0]).toContain("unavailable input 'missing'")
  })

  it("allows input templates backed by manual input values", () => {
    const manifest = storageManifest()
    manifest.nodes[1] = {
      ...manifest.nodes[1],
      options: {
        ...manifest.nodes[1].options,
        key: "{{inputs.objectKey}}.json",
        inputValues: {
          objectKey: "manual-key",
        },
      },
    }

    const validation = validateWorkflowDraft(manifest)

    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
  })

  it("validates JSON object node field handles", () => {
    const manifest: WorkflowManifest = {
      version: WORKFLOW_MANIFEST_VERSION,
      name: "Combine values",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 80, y: 120 },
          options: {},
        },
        {
          id: "combine",
          type: "json-object",
          label: "JSON Object",
          position: { x: 340, y: 120 },
          options: { fields: ["alertId", "note"] },
        },
      ],
      edges: [
        {
          id: "manual-alert",
          source: "manual",
          target: "combine",
          sourceHandle: "payload",
          targetHandle: "alertId",
        },
      ],
    }

    expect(validateWorkflowDraft(manifest).valid).toBe(true)

    const invalidHandle = structuredClone(manifest)
    invalidHandle.edges[0] = {
      ...invalidHandle.edges[0],
      targetHandle: "missing",
    }
    expect(validateWorkflowDraft(invalidHandle).errors[0]).toContain("unknown target handle")

    const invalidField = structuredClone(manifest)
    invalidField.edges = []
    invalidField.nodes[1] = {
      ...invalidField.nodes[1],
      options: { fields: ["bad.field"] },
    }
    expect(validateWorkflowDraft(invalidField).errors[0]).toContain("invalid JSON object field")
  })

  it("keeps scheduled templates from embedding a module-load timestamp", () => {
    const scheduledTemplate = WORKFLOW_TEMPLATES.find(
      (template) => template.id === "scheduled-http",
    )
    const scheduleNode = scheduledTemplate?.manifest.nodes.find((node) => node.id === "schedule")

    expect(scheduleNode?.options.scheduledAt).toBe("")
  })

  it("groups workflow templates by complexity and validates Slack templates", () => {
    const complexities = new Set(WORKFLOW_TEMPLATES.map((template) => template.complexity))
    expect(complexities).toEqual(new Set(["simple", "moderate", "complex"]))

    for (const template of WORKFLOW_TEMPLATES) {
      const validation = validateWorkflowDraft(template.manifest)
      expect(validation.valid, template.id).toBe(true)
      expect(validation.manifest?.version).toBe(WORKFLOW_MANIFEST_VERSION)
      for (const node of template.manifest.nodes) {
        if (node.type === "isolate-session") {
          expect(node.options.subagents, `${template.id}:${node.id}`).toBe("enabled")
        }
      }
    }

    const qaTemplate = WORKFLOW_TEMPLATES.find((template) => template.id === "slack-qa-bot")
    expect(qaTemplate?.complexity).toBe("moderate")
    expect(qaTemplate?.manifest.nodes.some((node) => node.type === "slack-trigger")).toBe(true)
    expect(JSON.stringify(qaTemplate?.manifest)).not.toContain("slack-agent-session")
    expect(qaTemplate?.manifest.nodes.some((node) => node.type === "isolate-session")).toBe(true)

    const alertTemplate = WORKFLOW_TEMPLATES.find(
      (template) => template.id === "alert-investigation",
    )
    if (!alertTemplate) {
      throw new Error("Expected alert investigation template")
    }
    const alertNodes = new Map(alertTemplate.manifest.nodes.map((node) => [node.id, node]))
    const alertAgent = alertNodes.get("investigate_and_draft_note")
    const alertPrompt = String(alertAgent?.options.prompt)

    expect(alertTemplate.complexity).toBe("moderate")
    expect(alertTemplate.tags).toEqual(["webhook", "sre", "opsgenie", "incident"])
    expect(alertTemplate.manifest.nodes.map((node) => node.id)).toEqual([
      "webhook",
      "normalize",
      "investigate_and_draft_note",
      "opsgenie_note_payload",
      "post_opsgenie_note",
    ])
    expect(alertAgent?.type).toBe("isolate-session")
    expect(alertAgent?.options).toMatchObject({
      subagents: "enabled",
      tools: [],
      customMcpServers: {},
    })
    expect(alertNodes.get("post_opsgenie_note")?.options.headers).toMatchObject({
      Authorization: "GenieKey replace-with-opsgenie-api-key",
    })
    expect(alertNodes.get("post_opsgenie_note")?.options.url).toBe(
      "https://api.opsgenie.com/v2/alerts/{{inputs.body.alert.alertId}}/notes",
    )
    expect(JSON.stringify(alertTemplate.manifest)).not.toContain(
      "3d78bbf6-02d0-47e4-9d6c-63ebd20f07b2",
    )
    expect(alertPrompt).toContain("Parallelize non-overlapping work")
    expect(alertPrompt).toContain("Observability: logs, traces, metrics, dashboards")
    expect(alertPrompt).toContain("Similar OpsGenie alerts")
    expect(alertPrompt).toContain("Runbooks and documentation")
    expect(alertPrompt).toContain("FireHydrant incidents")
    expect(alertPrompt).toContain("targeted follow-up tool calls or delegate another focused task")
    expect(alertPrompt).toContain(
      "Do not turn a tool-executable action into a recommended next step",
    )
    expect(alertPrompt).toContain("launch a distinct follow-up sub-agent")
    expect(alertPrompt).toContain("discoverable selector")
    expect(alertPrompt).toContain("every relevant configured read-only path")
    expect(alertPrompt).toContain("not identified after exhausting available investigation paths")
    expect(alertPrompt).toContain("Investigation limits:")
    expect(alertPrompt).toContain("Do not include a Recommended next steps section")
    expect(alertPrompt).not.toContain("Recommended next steps:\n")
    expect(alertPrompt).toContain("Do not invent logs, traces, metrics, dashboards")
    expect(alertTemplate.manifest.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "normalize",
          target: "investigate_and_draft_note",
          targetHandle: "context",
        }),
        expect.objectContaining({
          source: "normalize",
          target: "opsgenie_note_payload",
          targetHandle: "alert",
        }),
        expect.objectContaining({
          source: "investigate_and_draft_note",
          target: "opsgenie_note_payload",
          targetHandle: "note",
        }),
        expect.objectContaining({
          source: "opsgenie_note_payload",
          target: "post_opsgenie_note",
          targetHandle: "body",
        }),
      ]),
    )
    expect(alertTemplate.manifest.edges).toHaveLength(5)

    const incidentTemplate = WORKFLOW_TEMPLATES.find(
      (template) => template.id === "slack-incident-assistant",
    )
    expect(incidentTemplate?.complexity).toBe("complex")
    expect(JSON.stringify(incidentTemplate?.manifest)).not.toContain("incident-context")
    expect(
      incidentTemplate?.manifest.nodes.some((node) => node.id === "summarize_incident_context"),
    ).toBe(false)
    expect(
      incidentTemplate?.manifest.nodes.some((node) => node.id === "post_initial_context"),
    ).toBe(false)
    expect(
      incidentTemplate?.manifest.nodes.some((node) => node.type === "slack-join-channel"),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.nodes.some(
        (node) =>
          node.id === "ack_incident_question" &&
          node.type === "slack-add-reaction" &&
          node.options.name === "c0-thinking",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.edges.some(
        (edge) =>
          edge.source === "incident_question" &&
          edge.target === "ack_incident_question" &&
          edge.sourceHandle === "messageTs" &&
          edge.targetHandle === "timestamp",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.nodes.some(
        (node) =>
          node.id === "clear_incident_question_ack" &&
          node.type === "slack-remove-reaction" &&
          node.options.name === "c0-thinking",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.edges.some(
        (edge) =>
          edge.source === "reply_to_incident_question" &&
          edge.target === "clear_incident_question_ack" &&
          edge.sourceHandle === "channel" &&
          edge.targetHandle === "channel",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.nodes.some(
        (node) =>
          node.id === "ack_incident_keyword" &&
          node.type === "slack-add-reaction" &&
          node.options.name === "c0-thinking",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.edges.some(
        (edge) =>
          edge.source === "incident_keyword" &&
          edge.target === "ack_incident_keyword" &&
          edge.sourceHandle === "messageTs" &&
          edge.targetHandle === "timestamp",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.nodes.some(
        (node) =>
          node.id === "clear_incident_keyword_ack" &&
          node.type === "slack-remove-reaction" &&
          node.options.name === "c0-thinking",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.edges.some(
        (edge) =>
          edge.source === "post_proactive_context" &&
          edge.target === "clear_incident_keyword_ack" &&
          edge.sourceHandle === "channel" &&
          edge.targetHandle === "channel",
      ),
    ).toBe(true)
    expect(
      incidentTemplate?.manifest.nodes.some(
        (node) =>
          node.type === "slack-trigger" &&
          Array.isArray(node.options.eventTypes) &&
          node.options.eventTypes.includes("channel_created"),
      ),
    ).toBe(true)
  })
})
