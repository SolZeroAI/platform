import { env } from "cloudflare:workers"
import { getAgentByName } from "agents"
import { describe, expect, it } from "vitest"
import type { IsolateFacetTestParent } from "./worker"

type TestEnv = typeof env & {
  readonly ISOLATE_FACET_TEST_PARENT: DurableObjectNamespace<IsolateFacetTestParent>
}

async function freshParent(): Promise<IsolateFacetTestParent> {
  return (await getAgentByName(
    (env as TestEnv).ISOLATE_FACET_TEST_PARENT,
    `isolate-facets-${crypto.randomUUID()}`,
  )) as unknown as IsolateFacetTestParent
}

async function waitForChild(parent: IsolateFacetTestParent, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await parent.hasChild(runId)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Facet child ${runId} did not start`)
}

describe("native Isolate sub-agent facets", () => {
  it("creates a real facet and awaits its summary", async () => {
    const parent = await freshParent()
    const runId = crypto.randomUUID()

    expect(await parent.facetRuntimeAvailable()).toBe(true)
    const result = await parent.runChild("inspect the deployment", runId)

    expect(result).toMatchObject({
      runId,
      agentType: "IsolateFacetTestChild",
      status: "completed",
      summary: "Facet child completed: inspect the deployment",
    })
    expect(await parent.hasChild(runId)).toBe(true)
    expect(await parent.listChildren()).toEqual([
      expect.objectContaining({
        className: "IsolateFacetTestChild",
        name: runId,
      }),
    ])
  })

  it("bounds four concurrent children and permits a second delegation wave", async () => {
    const parent = await freshParent()
    const result = await parent.exerciseConcurrentChildWaves()

    expect(result.firstWave).toHaveLength(4)
    expect(result.firstWave).toEqual(
      result.firstWaveRunIds.map((runId, index) =>
        expect.objectContaining({
          runId,
          agentType: "IsolateFacetTestChild",
          status: "completed",
          summary: `Facet child completed: parallel child ${index + 1}`,
        }),
      ),
    )
    expect(result.overflow).toEqual({
      runId: result.overflowRunId,
      agentType: "IsolateFacetTestChild",
      status: "error",
      error: "maxConcurrentAgentTools (4) exceeded",
    })
    expect(await parent.hasChild(result.overflowRunId)).toBe(false)
    expect(result.secondWave).toMatchObject({
      runId: result.secondWaveRunId,
      agentType: "IsolateFacetTestChild",
      status: "completed",
      summary: "Facet child completed: second-wave child",
    })
    expect(await parent.hasChild(result.secondWaveRunId)).toBe(true)
  })

  it("uses an initial child's evidence in a distinct follow-up delegation", async () => {
    const parent = await freshParent()
    const result = await parent.exerciseEvidenceDrivenFollowup()

    expect(result.initial).toMatchObject({
      status: "completed",
      summary: expect.stringContaining("o11y org_id=34"),
    })
    expect(result.followupTask).toContain("o11y org_id=34")
    expect(result.followup).toMatchObject({
      status: "completed",
      summary: expect.stringContaining(result.followupTask),
    })
    expect(result.followup.runId).not.toBe(result.initial.runId)
  })

  it("keeps parent and sibling facet SQLite storage isolated", async () => {
    const parentName = `isolate-facets-${crypto.randomUUID()}`
    const parent = (await getAgentByName(
      (env as TestEnv).ISOLATE_FACET_TEST_PARENT,
      parentName,
    )) as unknown as IsolateFacetTestParent

    await parent.writeParentValue("shared-key", "parent")
    await parent.writeChildValue("child-a", "shared-key", "alpha")
    await parent.writeChildValue("child-b", "shared-key", "beta")

    expect(await parent.readParentValue("shared-key")).toBe("parent")
    expect(await parent.readChildValue("child-a", "shared-key")).toBe("alpha")
    expect(await parent.readChildValue("child-b", "shared-key")).toBe("beta")
    expect(await parent.childIdentity("child-a")).toEqual({
      name: "child-a",
      parentClass: "IsolateFacetTestParent",
      parentName,
    })

    await parent.writeParentValueFromChild("child-a", "child-visible-key", "shared")
    expect(await parent.readParentValue("child-visible-key")).toBe("shared")
    expect(await parent.readChildValue("child-a", "child-visible-key")).toBeNull()
  })

  it("routes the built-in child write tool into the parent workspace", async () => {
    const parent = await freshParent()

    await parent.writeParentWorkspaceFromBuiltInChildTool(
      "workspace-child",
      "/repo/shared-result.txt",
      "written through the child workspace tool",
    )

    expect(await parent.fixtureWorkspaceReadFile("/repo/shared-result.txt")).toBe(
      "written through the child workspace tool",
    )
  })

  it("propagates parent cancellation to an awaited child run", async () => {
    const parent = await freshParent()
    const runId = crypto.randomUUID()
    const pending = parent.runChild("wait for cancellation", runId, 5_000)

    await waitForChild(parent, runId)
    await parent.cancelChild(runId)

    await expect(pending).resolves.toMatchObject({
      runId,
      agentType: "IsolateFacetTestChild",
      status: "aborted",
    })
  })

  it("clears retained run records and child facets during parent cleanup", async () => {
    const parent = await freshParent()
    const runId = crypto.randomUUID()

    await parent.runChild("retain then delete", runId)
    expect(await parent.hasChild(runId)).toBe(true)

    await parent.clearChildren()

    expect(await parent.hasChild(runId)).toBe(false)
    expect(await parent.listChildren()).toEqual([])
  })
})
