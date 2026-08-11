import { describe, expect, it } from "vitest"
import {
  getAiSearchNamespaceName,
  getWorkflowAiSearchNamespaceName,
} from "../../packages/infra/src/aiSearch"

describe("AI Search namespace names", () => {
  it.each([
    ["dev", "s0-dev", "s0-user-workflow-dev"],
    ["test", "s0-test", "s0-user-workflow-test"],
    ["pre", "s0-pre", "s0-user-workflow-pre"],
    ["prod", "s0-prod", "s0-user-workflow-prod"],
    ["pre-pr-123", "s0-pre-pr-123", "s0-user-workflow-pre-pr-123"],
  ])("qualifies the %s namespaces by stage", (stageName, globalName, workflowName) => {
    const options = { appName: "s0", stageName }

    expect(getAiSearchNamespaceName(options)).toBe(globalName)
    expect(getWorkflowAiSearchNamespaceName(options)).toBe(workflowName)
  })

  it("keeps long stage names deterministic and within Cloudflare limits", () => {
    const options = {
      appName: "s0",
      stageName: "pre-feature-with-a-very-long-environment-name",
    }
    const globalName = getAiSearchNamespaceName(options)
    const workflowName = getWorkflowAiSearchNamespaceName(options)

    expect(globalName).toHaveLength(28)
    expect(workflowName).toHaveLength(28)
    expect(globalName).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    expect(workflowName).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    expect(getAiSearchNamespaceName(options)).toBe(globalName)
    expect(getWorkflowAiSearchNamespaceName(options)).toBe(workflowName)
  })

  it("normalizes long runs of namespace separators", () => {
    const separators = "-".repeat(10_000)

    expect(
      getAiSearchNamespaceName({
        appName: `${separators}S0${separators}`,
        stageName: `${separators}PRE${separators}`,
      }),
    ).toBe("s0-pre")
  })
})
