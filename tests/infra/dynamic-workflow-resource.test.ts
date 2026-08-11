import { describe, expect, it } from "vitest"
import { DYNAMIC_WORKFLOW_CLASS_NAME, getDynamicWorkflowName } from "../../apps/api/infra/resources"

describe("dynamic workflow resource", () => {
  it("uses a stable stage-scoped Cloudflare Workflow name", () => {
    expect(DYNAMIC_WORKFLOW_CLASS_NAME).toBe("DynamicUserWorkflow")
    expect(getDynamicWorkflowName("s0", "pre")).toBe("s0-dynamic-workflow-pre")
    expect(getDynamicWorkflowName("s0", "prod")).toBe("s0-dynamic-workflow-prod")
  })
})
