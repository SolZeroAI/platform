import type { LanguageModel, UIMessage } from "ai"
import { Think, type WorkspaceLike } from "@cloudflare/think"
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace"
import { Workspace, type FileInfo } from "@cloudflare/shell"
import { Agent } from "agents"
import type { RunAgentToolResult } from "agents"

interface FacetTestEnv {
  readonly ISOLATE_FACET_TEST_PARENT: DurableObjectNamespace<IsolateFacetTestParent>
  readonly ISOLATE_FACET_TEST_CHILD: DurableObjectNamespace<IsolateFacetTestChild>
}

interface ChildInput {
  readonly task: string
  readonly delayMs?: number
}

const finishReason = {
  unified: "stop" as const,
  raw: undefined,
}

const usage = {
  inputTokens: {
    total: 4,
    noCache: 4,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 4,
    text: 4,
    reasoning: 0,
  },
}

function waitForDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function createDeterministicModel(response: string, delayMs: number): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "s0-test",
    modelId: "isolate-facet-test-model",
    supportedUrls: {},
    doGenerate() {
      throw new Error("The facet integration fixture only exercises streaming inference")
    },
    doStream(options: unknown) {
      const signal = (options as { abortSignal?: AbortSignal }).abortSignal
      const delayController = new AbortController()
      signal?.addEventListener("abort", () => delayController.abort(signal.reason), { once: true })
      const textId = crypto.randomUUID()
      let cancelled = false
      const stream = new ReadableStream({
        async start(controller) {
          try {
            await waitForDelay(delayMs, delayController.signal)
            if (cancelled || signal?.aborted) return
            controller.enqueue({ type: "text-start", id: textId })
            controller.enqueue({ type: "text-delta", id: textId, delta: response })
            controller.enqueue({ type: "text-end", id: textId })
            controller.enqueue({ type: "finish", finishReason, usage })
            controller.close()
          } catch (error) {
            if (!cancelled) controller.error(error)
          }
        },
        cancel() {
          cancelled = true
          delayController.abort()
        },
      })
      return Promise.resolve({ stream })
    },
  } as LanguageModel
}

function parseChildInput(input: unknown): ChildInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Expected a child task input")
  }
  const task = Reflect.get(input, "task")
  const delayMs = Reflect.get(input, "delayMs")
  if (typeof task !== "string" || task.length === 0) {
    throw new Error("Expected a non-empty child task")
  }
  if (delayMs !== undefined && (typeof delayMs !== "number" || delayMs < 0)) {
    throw new Error("Expected a non-negative child delay")
  }
  return { task, delayMs }
}

export class IsolateFacetTestChild extends Think<FacetTestEnv> {
  private response = "Facet child completed"
  private delayMs = 0
  workspace: WorkspaceLike = {
    readFile: async (path) => (await this.parent()).fixtureWorkspaceReadFile(path),
    readFileBytes: async (path) => (await this.parent()).fixtureWorkspaceReadFileBytes(path),
    writeFile: async (path, content) =>
      (await this.parent()).fixtureWorkspaceWriteFile(path, content),
    readDir: async (path, options) =>
      (await this.parent()).fixtureWorkspaceReadDir(path ?? "/", options),
    rm: async (path, options) => (await this.parent()).fixtureWorkspaceRemove(path, options),
    glob: async (pattern) => (await this.parent()).fixtureWorkspaceGlob(pattern),
    mkdir: async (path, options) => (await this.parent()).fixtureWorkspaceMkdir(path, options),
    stat: async (path) => (await this.parent()).fixtureWorkspaceStat(path),
  }

  override getModel(): LanguageModel {
    return createDeterministicModel(this.response, this.delayMs)
  }

  protected override formatAgentToolInput(input: unknown): UIMessage {
    const { task } = parseChildInput(input)
    return {
      id: `facet-test-input-${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: task }],
    }
  }

  override async startAgentToolRun(
    input: unknown,
    options: { readonly runId: string },
  ): ReturnType<Think<FacetTestEnv>["startAgentToolRun"]> {
    const { task, delayMs = 0 } = parseChildInput(input)
    this.response = `Facet child completed: ${task}`
    this.delayMs = delayMs
    // Each agent-tool run owns a dedicated facet, so these values remain scoped
    // to this child while the SDK continues the turn after this RPC returns.
    return super.startAgentToolRun(input, options)
  }

  writeFixtureValue(key: string, value: string): void {
    void this.sql`CREATE TABLE IF NOT EXISTS facet_fixture_values (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
    void this
      .sql`INSERT OR REPLACE INTO facet_fixture_values (key, value) VALUES (${key}, ${value})`
  }

  readFixtureValue(key: string): string | null {
    void this.sql`CREATE TABLE IF NOT EXISTS facet_fixture_values (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
    return (
      this.sql<{ value: string }>`
      SELECT value FROM facet_fixture_values WHERE key = ${key}
    `[0]?.value ?? null
    )
  }

  identity(): { readonly name: string; readonly parentClass: string; readonly parentName: string } {
    const parent = this.parentPath.at(-1)
    return {
      name: this.name,
      parentClass: parent?.className ?? "",
      parentName: parent?.name ?? "",
    }
  }

  async writeParentValue(key: string, value: string): Promise<void> {
    const parent = await this.parent()
    await parent.writeParentValue(key, value)
  }

  async writeParentWorkspaceWithBuiltInTool(path: string, content: string): Promise<void> {
    const execute = createWorkspaceTools(this.workspace, { bash: false }).write.execute
    if (!execute) throw new Error("Built-in workspace write tool is unavailable")
    await execute(
      { path, content },
      { toolCallId: `facet-write-${crypto.randomUUID()}`, messages: [], abortSignal: undefined },
    )
  }

  private parent() {
    return this.parentAgent(IsolateFacetTestParent)
  }
}

export class IsolateFacetTestParent extends Agent<FacetTestEnv> {
  maxConcurrentAgentTools = 4
  private readonly fixtureWorkspace = new Workspace({
    sql: this.ctx.storage.sql,
    name: () => this.name,
  })

  runChild(task: string, runId: string, delayMs = 0): Promise<RunAgentToolResult> {
    return this.runAgentTool(IsolateFacetTestChild, {
      runId,
      parentToolCallId: `facet-test-tool-${runId}`,
      input: { task, delayMs },
      inputPreview: task,
    })
  }

  async exerciseEvidenceDrivenFollowup(): Promise<{
    readonly initial: RunAgentToolResult
    readonly followup: RunAgentToolResult
    readonly followupTask: string
  }> {
    const initial = await this.runChild(
      "Grafana discovery found o11y org_id=34; Prometheus query remains unattempted",
      crypto.randomUUID(),
    )
    const finding = initial.summary ?? initial.output
    if (typeof finding !== "string" || finding.length === 0) {
      throw new Error("Initial investigation child returned no finding")
    }
    const followupTask = `Continue Grafana investigation using prior finding: ${finding}`
    const followup = await this.runChild(followupTask, crypto.randomUUID())
    return { initial, followup, followupTask }
  }

  async exerciseConcurrentChildWaves(delayMs = 100): Promise<{
    readonly firstWaveRunIds: string[]
    readonly firstWave: RunAgentToolResult[]
    readonly overflowRunId: string
    readonly overflow: RunAgentToolResult
    readonly secondWaveRunId: string
    readonly secondWave: RunAgentToolResult
  }> {
    const firstWaveRunIds = Array.from({ length: 4 }, () => crypto.randomUUID())
    const firstWavePending = firstWaveRunIds.map((runId, index) =>
      this.runChild(`parallel child ${index + 1}`, runId, delayMs),
    )
    const overflowRunId = crypto.randomUUID()
    const overflow = await this.runChild("overflow child", overflowRunId)
    const firstWave = await Promise.all(firstWavePending)
    const secondWaveRunId = crypto.randomUUID()
    const secondWave = await this.runChild("second-wave child", secondWaveRunId)

    return {
      firstWaveRunIds,
      firstWave,
      overflowRunId,
      overflow,
      secondWaveRunId,
      secondWave,
    }
  }

  cancelChild(runId: string): Promise<void> {
    return this.cancelAgentTool(runId, "facet integration test cancellation")
  }

  async clearChildren(): Promise<void> {
    const children = this.listSubAgents(IsolateFacetTestChild)
    await this.clearAgentToolRuns()
    await Promise.all(children.map(({ name }) => this.deleteSubAgent(IsolateFacetTestChild, name)))
  }

  facetRuntimeAvailable(): boolean {
    return typeof this.ctx.facets?.get === "function"
  }

  hasChild(runId: string): boolean {
    return this.hasSubAgent(IsolateFacetTestChild, runId)
  }

  listChildren(): ReturnType<Agent<FacetTestEnv>["listSubAgents"]> {
    return this.listSubAgents(IsolateFacetTestChild)
  }

  writeParentValue(key: string, value: string): void {
    void this.sql`CREATE TABLE IF NOT EXISTS facet_fixture_values (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
    void this
      .sql`INSERT OR REPLACE INTO facet_fixture_values (key, value) VALUES (${key}, ${value})`
  }

  readParentValue(key: string): string | null {
    void this.sql`CREATE TABLE IF NOT EXISTS facet_fixture_values (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
    return (
      this.sql<{ value: string }>`
      SELECT value FROM facet_fixture_values WHERE key = ${key}
    `[0]?.value ?? null
    )
  }

  async writeChildValue(runId: string, key: string, value: string): Promise<void> {
    const child = await this.subAgent(IsolateFacetTestChild, runId)
    await child.writeFixtureValue(key, value)
  }

  async readChildValue(runId: string, key: string): Promise<string | null> {
    const child = await this.subAgent(IsolateFacetTestChild, runId)
    return child.readFixtureValue(key)
  }

  async childIdentity(
    runId: string,
  ): Promise<{ readonly name: string; readonly parentClass: string; readonly parentName: string }> {
    const child = await this.subAgent(IsolateFacetTestChild, runId)
    return child.identity()
  }

  async writeParentValueFromChild(runId: string, key: string, value: string): Promise<void> {
    const child = await this.subAgent(IsolateFacetTestChild, runId)
    await child.writeParentValue(key, value)
  }

  async writeParentWorkspaceFromBuiltInChildTool(
    runId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const child = await this.subAgent(IsolateFacetTestChild, runId)
    await child.writeParentWorkspaceWithBuiltInTool(path, content)
  }

  fixtureWorkspaceReadFile(path: string): Promise<string | null> {
    return this.fixtureWorkspace.readFile(path)
  }

  fixtureWorkspaceReadFileBytes(path: string): Promise<Uint8Array | null> {
    return this.fixtureWorkspace.readFileBytes(path)
  }

  fixtureWorkspaceWriteFile(path: string, content: string): Promise<void> {
    return this.fixtureWorkspace.writeFile(path, content)
  }

  fixtureWorkspaceReadDir(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<FileInfo[]> {
    return this.fixtureWorkspace.readDir(path, options)
  }

  fixtureWorkspaceRemove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    return this.fixtureWorkspace.rm(path, options)
  }

  fixtureWorkspaceGlob(pattern: string): Promise<FileInfo[]> {
    return this.fixtureWorkspace.glob(pattern)
  }

  async fixtureWorkspaceMkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.fixtureWorkspace.mkdir(path, options)
  }

  async fixtureWorkspaceStat(path: string): Promise<FileInfo | null> {
    return this.fixtureWorkspace.stat(path)
  }
}

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 })
  },
}
