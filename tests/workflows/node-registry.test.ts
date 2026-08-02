import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import {
  getWorkflowNodeDefaultOptions,
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_NODE_TYPES,
  type WorkflowNodeAdapterCategory,
} from "../../packages/shared/src/workflow-nodes"
import type { Env } from "../../packages/api/src/server/background/types"
import {
  executeWorkflowNodeWithAdapters,
  getRegisteredWorkflowNodeAdapterCategories,
  resolveWorkflowNodeAdapter,
} from "../../packages/api/src/server/background/workflows/nodes/registry"

describe("workflow node adapter registry", () => {
  it("keeps the Workflow Node catalog complete for defaults, validation, runtime, and editor support", () => {
    const catalogTypes = WORKFLOW_NODE_CATALOG.map((node) => node.type)
    expect(catalogTypes).toEqual([...WORKFLOW_NODE_TYPES])
    expect(new Set(catalogTypes).size).toBe(WORKFLOW_NODE_TYPES.length)

    for (const definition of WORKFLOW_NODE_CATALOG) {
      expect(getWorkflowNodeDefaultOptions(definition.type)).toEqual(expect.any(Object))
      expect(definition.validation.templateReferences).toBe("connected-inputs")
      expect(definition.validation.optionRules).toEqual(expect.any(Array))
      expect(definition.editor.icon).toEqual(expect.any(String))
      expect(definition.editor.configuration).toEqual(expect.any(String))
      expect(definition.runtime.kind).toMatch(/^(trigger|inline|adapter)$/)

      if (definition.runtime.kind === "adapter") {
        expect(definition.runtime.adapterCategory).toBe(definition.category)
      }
      if (definition.runtime.kind === "trigger") {
        expect(definition.category).toBe("trigger")
      }
      if (definition.runtime.kind === "inline") {
        expect(definition.category).toBe("logic")
      }
    }
  })

  it("registers a runtime adapter for every adapter category declared by Workflow Node metadata", () => {
    const registeredCategories = new Set(getRegisteredWorkflowNodeAdapterCategories())
    const catalogAdapterCategories = new Set<WorkflowNodeAdapterCategory>(
      WORKFLOW_NODE_CATALOG.flatMap((definition) =>
        definition.runtime.kind === "adapter" ? [definition.runtime.adapterCategory] : [],
      ),
    )

    expect(registeredCategories).toEqual(catalogAdapterCategories)
  })

  it("resolves action node adapters from shared Workflow Node metadata categories", () => {
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("http-request"))?.category).toBe("network")
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("isolate-session"))?.category).toBe(
      "session",
    )
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("sandbox-session"))?.category).toBe(
      "session",
    )
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("slack-send-message"))?.category).toBe(
      "slack",
    )
    expect(Option.isNone(resolveWorkflowNodeAdapter("slack-notification"))).toBe(true)
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("email-notification"))?.category).toBe(
      "notification",
    )
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("r2-put-object"))?.category).toBe("storage")
    expect(Option.getOrNull(resolveWorkflowNodeAdapter("get-secret"))?.category).toBe("storage")
  })

  it("leaves trigger and inline nodes unsupported by the action adapter registry", async () => {
    for (const definition of WORKFLOW_NODE_CATALOG) {
      if (definition.runtime.kind !== "adapter") {
        expect(Option.isNone(resolveWorkflowNodeAdapter(definition.type))).toBe(true)
      }
    }
    expect(Option.isNone(resolveWorkflowNodeAdapter("unknown-node"))).toBe(true)

    await expect(
      executeWorkflowNodeWithAdapters({
        env: {} as Env,
        workflowId: "wf_1",
        runId: "run_1",
        node: {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          options: {},
        },
        inputs: {},
        trigger: { kind: "manual", payload: {} },
        userId: "user_1",
      }),
    ).rejects.toThrow("Unsupported workflow action node 'manual-trigger'")
  })
})
