import { describe, expect, it } from "vitest"
import { DYNAMIC_WORKFLOW_CLASS_NAME, getDynamicWorkflowName } from "../../apps/api/infra/resources"

describe("dynamic workflow resource", () => {
  it("uses a stable stage-scoped Cloudflare Workflow name", () => {
    expect(DYNAMIC_WORKFLOW_CLASS_NAME).toBe("DynamicUserWorkflow")
    expect(getDynamicWorkflowName("c0", "pre")).toBe("c0-dynamic-workflow-pre")
    expect(getDynamicWorkflowName("c0", "prod")).toBe("c0-dynamic-workflow-prod")
  })
})
