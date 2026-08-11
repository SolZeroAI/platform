import { describe, expect, it } from "vitest"
import { WORKFLOW_MANIFEST_VERSION, type WorkflowManifest } from "@solzero/shared"
import { migrateWorkflowManifestForBuilder } from "./manifest-utils"

function legacyManifest(version: number): WorkflowManifest {
  return {
    version,
    name: "Legacy workflow",
    nodes: [
      {
        id: "isolate",
        type: "isolate-session",
        label: "Isolate",
        position: { x: 0, y: 0 },
        options: { model: "litellm/gpt-5.4-mini" },
      },
      {
        id: "sandbox",
        type: "sandbox-session",
        label: "Sandbox",
        position: { x: 200, y: 0 },
        options: { model: "litellm/gpt-5.4-mini" },
      },
    ],
    edges: [],
  } as unknown as WorkflowManifest
}

describe("workflow builder manifest migration", () => {
  it("preserves legacy agent behavior by disabling sub-agents only on Isolate nodes", () => {
    const migrated = migrateWorkflowManifestForBuilder(legacyManifest(3))

    expect(migrated.version).toBe(WORKFLOW_MANIFEST_VERSION)
    expect(migrated.nodes.find((node) => node.id === "isolate")?.options.subagents).toBe("disabled")
    expect(migrated.nodes.find((node) => node.id === "sandbox")?.options).not.toHaveProperty(
      "subagents",
    )
  })

  it("does not rewrite current manifests", () => {
    const current = legacyManifest(WORKFLOW_MANIFEST_VERSION)

    expect(migrateWorkflowManifestForBuilder(current)).toBe(current)
  })
})
