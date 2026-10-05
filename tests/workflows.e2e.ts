import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"

const manifest = {
  version: 4,
  name: "E2E artifact workflow",
  nodes: [
    {
      id: "manual",
      type: "manual-trigger",
      label: "Manual",
      position: { x: 0, y: 0 },
      options: {},
    },
    {
      id: "javascript",
      type: "javascript",
      label: "Prepare output",
      position: { x: 300, y: 0 },
      options: { code: "return { marker: inputs.payload.marker }" },
    },
    {
      id: "save",
      type: "r2-put-object",
      label: "Save to R2",
      position: { x: 600, y: 0 },
      options: {
        bucket: "WORKFLOW_BUCKET",
        key: "e2e/{{workflowId}}/{{runId}}.json",
        contentType: "application/json",
      },
    },
  ],
  edges: [
    {
      id: "input",
      source: "manual",
      target: "javascript",
      sourceHandle: "payload",
      targetHandle: "payload",
    },
    {
      id: "output",
      source: "javascript",
      target: "save",
      sourceHandle: "result",
      targetHandle: "content",
    },
  ],
}

test(
  "workflow authoring, rename, export, disable and archive persist",
  { session: "admin" },
  async ({ app, agent, screen, browser }) => {
    const name = uniqueName("e2e-workflow")
    const { workflow } = await api<{ workflow: { id: string } }>(browser, "/workflows", "POST", {
      name,
      manifest: { ...manifest, name },
    })
    const path = `/workflows/${workflow.id}`
    try {
      await app.open(path)
      await expect(screen.getByLabel("Workflow name")).toHaveValue(name)
      const renamed = `${name}-renamed`
      await screen.getByLabel("Workflow name").fill(renamed)
      await agent.act("Save the changed workflow name")
      await browser.reload()
      await expect(screen.getByLabel("Workflow name")).toHaveValue(renamed)
      const exported = await fetch(`http://localhost:3100${path}/export`, {
        headers: {
          Cookie: (await browser.cookies()).map(({ name: n, value }) => `${n}=${value}`).join("; "),
        },
      })
      expect(exported.status).toBe(200)
      expect(await exported.text()).toContain(renamed)
      await api(browser, `${path}/disable`, "POST")
      const disabled = await api<{ workflow: { status: string } }>(browser, path)
      expect(disabled.workflow.status).toBe("disabled")
      await api(browser, `${path}/enable`, "POST")
      const enabled = await api<{ workflow: { status: string } }>(browser, path)
      expect(enabled.workflow.status).toBe("active")
      await app.open("/workflows")
      await screen.getByLabel("Search workflows").fill(renamed)
      await expect(screen.getByText(renamed, { exact: true })).toBeVisible()
    } finally {
      await api(browser, path, "DELETE")
    }
  },
)

test(
  "manual workflow executes JavaScript and stores a real R2 artifact",
  { session: "admin", tags: ["workflow-runtime"] },
  async ({ app, browser, screen }) => {
    const name = uniqueName("e2e-run")
    const marker = uniqueName("artifact")
    const { workflow } = await api<{ workflow: { id: string } }>(browser, "/workflows", "POST", {
      name,
      manifest: { ...manifest, name },
    })
    const path = `/workflows/${workflow.id}`
    try {
      const { run } = await api<{ run: { id: string } }>(browser, `${path}/runs`, "POST", {
        trigger: { kind: "manual", payload: { marker } },
      })
      await expect
        .poll(
          async () => {
            const detail = await api<{ run: { status: string } }>(browser, `${path}/runs/${run.id}`)
            return detail.run.status
          },
          { timeout: 120_000 },
        )
        .toBe("completed")
      const artifact = await api<{ artifact: { text: string } }>(
        browser,
        `${path}/runs/${run.id}/artifacts/save`,
      )
      expect(artifact.artifact.text).toContain(marker)
      const events = await api<{ events: object[] }>(browser, `${path}/runs/${run.id}/events`)
      expect(events.events.length).toBeGreaterThan(0)
      await app.open(path)
      await expect(screen.getByLabel("Workflow name")).toHaveValue(name)
      await api(browser, `${path}/runs/${run.id}`, "DELETE")
      const removed = await api<{ runs: object[] }>(browser, `${path}/runs`)
      expect(removed.runs).toEqual([])
    } finally {
      await api(browser, path, "DELETE")
    }
  },
)

test(
  "invalid workflow definitions are rejected before storage",
  { session: "admin" },
  async ({ browser }) => {
    const cookies = (await browser.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ")
    const response = await fetch("http://localhost:3100/workflows", {
      method: "POST",
      headers: { Cookie: cookies, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: uniqueName("invalid"),
        manifest: { version: 999, nodes: [], edges: [] },
      }),
    })
    expect(response.status).toBe(400)
  },
)
