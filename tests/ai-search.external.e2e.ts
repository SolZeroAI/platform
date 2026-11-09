import { test } from "@e2e-dev/web"
import { expect, unique } from "e2e"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Browser } from "@e2e-dev/web"
import { api as callApi, authRequest, uniqueName } from "./support/api"
import { testDeploymentConfig } from "../scripts/e2e/environment"

function api<T, Body extends object = object>(
  browser: Browser,
  path: string,
  method = "GET",
  body?: Body,
) {
  return callApi<T>(browser, path, method, body, 45_000)
}

interface Items {
  items: Array<{ id: string; key: string; status: string }>
  total: number
}

async function search(sourceId: string, query: string) {
  const client = new Client({ name: "solzero-ai-search-proof", version: "1.0.0" })

  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost:3100/mcp"), {
        requestInit: { headers: { "x-s0-ai-search-sources": sourceId } },
      }),
    )

    const result = await client.callTool({
      name: `search_${sourceId.replaceAll("-", "_")}`,
      arguments: { query },
    })

    expect(result.isError).not.toBe(true)

    return JSON.stringify(result.content)
  } finally {
    await client.close()
  }
}

test(
  "built-in documents index, retrieve, delete and ingest through a real workflow",
  {
    session: "admin",
    tags: ["external", "ai-search-live"],
    timeout: 600_000,
    retries: 0,
  },
  async ({ browser }) => {
    expect(testDeploymentConfig.deployment.appName.startsWith("s0-e2e-as-")).toBe(true)
    expect(testDeploymentConfig.deployment.aiSearchEnabledInDev).toBe(true)

    const sourceId = uniqueName("e2e-docs")
    const label = uniqueName("Built-in documents")
    const marker = uniqueName("violet-otter")
    const name = "round-trip.txt"
    const path = `/admin/ai-search/sources/${sourceId}`
    let workflowId: string | undefined

    try {
      await api(browser, "/admin/ai-search/export", "POST")
      console.info("AI Search proof: audited configuration export completed")
      await api(browser, "/admin/ai-search/sources", "POST", {
        id: sourceId,
        label,
        description: "Disposable integration proof",
        enabled: true,
        maxResults: 5,
        dataSource: { type: "built-in" },
      })

      console.info("AI Search proof: source creation completed")

      const sources = await api<{ sources: Array<{ id: string; dataSource: { type: string } }> }>(
        browser,
        "/admin/ai-search",
      )

      expect(sources.sources.find((source) => source.id === sourceId)?.dataSource.type).toBe(
        "built-in",
      )

      const payload = {
        name,
        contentType: "text/plain",
        contentBase64: Buffer.from(
          `The archival retrieval marker is ${marker}. Its color is violet and its animal is an otter.`,
        ).toString("base64"),
      }

      const denied = await fetch(`http://localhost:3100${path}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify(payload),
      })

      expect(denied.status).toBe(401)

      const malformed = await authRequest(browser, `${path}/items`, "POST", {
        ...payload,
        contentBase64: "%%%",
      })

      expect(malformed.status).toBe(400)
      await api(browser, `${path}/items`, "POST", payload)
      console.info("AI Search proof: upload accepted")

      await expect
        .poll(
          async () => {
            const items = await api<Items>(browser, `${path}/items`)

            return items.items.find((item) => item.key === name)?.status
          },
          { timeout: 240_000, interval: 2000 },
        )
        .toBe("completed")
      await expect
        .poll(() => search(sourceId, "What is the archival retrieval marker?"), {
          timeout: 120_000,
        })
        .toContain(marker)

      const listed = await api<Items>(browser, `${path}/items`)
      const itemId = listed.items.find((item) => item.key === name)!.id
      await api(browser, `${path}/items/${itemId}`, "DELETE")
      await expect.poll(async () => (await api<Items>(browser, `${path}/items`)).total).toBe(0)
      await expect
        .poll(() => search(sourceId, "What is the archival retrieval marker?"), {
          timeout: 120_000,
        })
        .not.toContain(marker)

      const workflowName = uniqueName("AI Search ingestion")
      const workflowMarker = uniqueName("copper-orchid")

      const created = await api<{ workflow: { id: string } }>(browser, "/workflows", "POST", {
        name: workflowName,
        manifest: {
          version: 4,
          name: workflowName,
          nodes: [
            {
              id: "start",
              type: "manual-trigger",
              label: "Start",
              position: { x: 0, y: 0 },
              options: {},
            },
            {
              id: "upload",
              type: "ai-search-upload",
              label: "Upload",
              position: { x: 300, y: 0 },
              options: { aiSearchSourceId: sourceId, name: "workflow.txt" },
            },
          ],
          edges: [
            {
              id: "content",
              source: "start",
              target: "upload",
              sourceHandle: "payload",
              targetHandle: "content",
            },
          ],
        },
      })

      workflowId = created.workflow.id
      const workflowPath = `/workflows/${workflowId}`

      const { run } = await api<{ run: { id: string } }>(browser, `${workflowPath}/runs`, "POST", {
        trigger: { kind: "manual", payload: { marker: workflowMarker } },
      })

      await expect
        .poll(
          async () =>
            (await api<{ run: { status: string } }>(browser, `${workflowPath}/runs/${run.id}`)).run
              .status,
          { timeout: 120_000, interval: 2000 },
        )
        .toBe("completed")

      const events = await api<{ events: Array<{ eventType: string }> }>(
        browser,
        `${workflowPath}/runs/${run.id}/events`,
      )

      expect(events.events.some((event) => event.eventType === "ai_search_upload")).toBe(true)
      await expect
        .poll(
          async () =>
            (await api<Items>(browser, `${path}/items`)).items.find(
              (item) => item.key === "workflow.txt",
            )?.status,
          { timeout: 240_000, interval: 2000 },
        )
        .toBe("completed")
      await expect
        .poll(() => search(sourceId, "What marker was uploaded by the workflow?"), {
          timeout: 120_000,
        })
        .toContain(workflowMarker)
    } finally {
      if (workflowId) await api(browser, `/workflows/${workflowId}`, "DELETE")

      const sources = await api<{ sources: Array<{ id: string }> }>(browser, "/admin/ai-search")

      if (sources.sources.some((source) => source.id === sourceId))
        await api(browser, path, "DELETE")
    }
  },
)

test(
  "administrators create built-in sources and open their documents",
  {
    session: "admin",
    tags: ["external", "ai-search-live"],
    retries: 0,
    agentContext:
      "This test has approval to create a disposable built-in AI Search source in its unique isolated Cloudflare namespace. Creating this source is allowed and does not link an external account. Use only the supplied test ID and label.",
  },
  async ({ app, browser, agent, screen }) => {
    const id = uniqueName("e2e-ui-docs")
    const label = uniqueName("Documents UI")

    try {
      await app.open("/admin/ai-search")
      await expect(screen.getByRole("button", "New Source", { exact: true })).toBeVisible()
      await agent.act("Click New Source to open the Create Source dialog.")
      await expect(screen.getByRole("dialog", "Create Source", { exact: true })).toBeVisible()
      await screen.getByLabel("ID", { exact: true }).fill(id)
      await screen.getByLabel("Label", { exact: true }).fill(label)
      await agent.act(
        "Submit the source with ID {id} and label {label} by clicking Create Source once. Stop when the button shows Loading Create Source or the dialog closes.",
        { params: { id: unique(id), label: unique(label) } },
      )
      await expect(screen.getByRole("dialog", "Create Source", { exact: true })).not.toBeVisible({
        timeout: 60_000,
      })
      await expect(screen.getByText(label, { exact: true })).toBeVisible()

      const sources = await api<{ sources: Array<{ id: string; dataSource: { type: string } }> }>(
        browser,
        "/admin/ai-search",
      )

      expect(sources.sources.find((source) => source.id === id)?.dataSource.type).toBe("built-in")
      await expect(
        screen.getByRole("dialog", "AI Search source created.", { exact: true }),
      ).not.toBeVisible({ timeout: 30_000 })
      await agent.act(
        "Open Documents for source {id} in the row labelled {label}. Finish when Close documents is visible.",
        { params: { id: unique(id), label: unique(label) } },
      )
      await expect(screen.getByRole("button", "Close documents")).toBeVisible()
      await expect(screen.getByLabel("Upload document")).toBeVisible()
      await app.screenshot("built-in-ai-search-documents")
    } finally {
      const sources = await api<{ sources: Array<{ id: string }> }>(browser, "/admin/ai-search")

      if (sources.sources.some((source) => source.id === id))
        await api(browser, `/admin/ai-search/sources/${id}`, "DELETE")
    }
  },
)
