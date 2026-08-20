import { tracing as workerTracing } from "cloudflare:workers"
import {
  Think,
  type ChatRecoveryContext,
  type ChatRecoveryOptions,
  type PrepareStepContext,
  type StepConfig,
  type ToolCallContext,
  type ToolCallDecision,
  type TurnConfig,
  type TurnContext,
  type WorkspaceLike,
} from "@cloudflare/think"
import { type UIMessage } from "ai"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { type OpenCodeMcpServers, type SessionToolSpec } from "@solzero/shared"
import type { AiSearchMcpRuntimeContext } from "../../mcp/ai-search-runtime"
import { createApiRequestObserver } from "../../effect/services/observability"
import {
  buildIsolateSystemPrompt,
  buildIsolateSystemPromptFacts,
  type IsolateMcpcfMcpPromptServer,
} from "../session/isolate/system"
import type { Env } from "../types"
import { compileIsolateModelContext, type IsolateModelContext } from "./model"
import { prepareIsolateMcpTurn } from "./mcpcf-turn"
import { buildResolvedIsolateSkillSources } from "./skills"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { makeBackgroundTracingLayer } from "../observability/tracing"
import { buildIsolateTools, type IsolateWorkspaceRuntime } from "./tools"
import { IsolateSessionAgent } from "./agent"
import type { IsolateSubagentTrustedConfig } from "./agent/subagent-trusted-config"
import {
  boundIsolateSubagentToolInput,
  ISOLATE_SUBAGENT_MAX_STEPS,
  isIsolateSubagentFinalizationStep,
  resolveIsolateSubagentTurnStepLimit,
  withIsolateSubagentFinalizationPrompt,
} from "./subagent-turn-policy"
import { ISOLATE_SUBAGENT_PERSISTENCE_PROMPT } from "./subagent-prompts"

export interface IsolateSubagentDelegation {
  task: string
  context?: string
  expectedOutput?: string
}

/**
 * Trusted run configuration injected by the parent outside model-controlled tool input.
 * `formatAgentToolInput` deliberately projects only `delegation` into child history.
 */
export interface IsolateSubagentRunInput {
  delegation: IsolateSubagentDelegation
  parentSessionId: string
  userId: string
  repoOwner: string
  repoName: string
  model: string
  reasoningEffort?: string
  stepLimit: number
  selectedTools: SessionToolSpec[]
  customMcpServers: OpenCodeMcpServers
}

interface IsolateSubagentTurn {
  runId: string
  input: IsolateSubagentTrustedConfig
  model: IsolateModelContext
  customMcpServerNames: readonly string[]
  mcpcfMcpServers: readonly IsolateMcpcfMcpPromptServer[]
}

const SUBAGENT_PREPARATION_ERROR = "Unable to prepare the Isolate sub-agent runtime."

function assertRunInput(input: unknown): asserts input is IsolateSubagentRunInput {
  const candidate = input as Partial<IsolateSubagentRunInput> | null
  const isInvalid =
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.parentSessionId !== "string" ||
    typeof candidate.userId !== "string" ||
    typeof candidate.repoOwner !== "string" ||
    typeof candidate.repoName !== "string" ||
    typeof candidate.model !== "string" ||
    typeof candidate.stepLimit !== "number" ||
    !Array.isArray(candidate.selectedTools) ||
    !candidate.customMcpServers ||
    typeof candidate.customMcpServers !== "object" ||
    !candidate.delegation ||
    typeof candidate.delegation.task !== "string"
  Match.value(isInvalid).pipe(
    Match.when(true, () => {
      throw new Error("Invalid trusted Isolate sub-agent run configuration")
    }),
    Match.orElse(() => undefined),
  )
}

function formatDelegation(input: IsolateSubagentDelegation): string {
  const context = Option.fromNullishOr(input.context).pipe(
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
    Option.map((value) => ["Context from the orchestrator:", value]),
    Option.getOrElse((): string[] => []),
  )
  const expectedOutput = Option.fromNullishOr(input.expectedOutput).pipe(
    Option.map((value) => value.trim()),
    Option.filter((value) => value.length > 0),
    Option.map((value) => ["Expected output:", value]),
    Option.getOrElse((): string[] => []),
  )
  return ["Delegated task:", input.task.trim(), ...context, ...expectedOutput].join("\n\n")
}

/**
 * A co-located child facet used exclusively through the parent agent-tool lifecycle.
 * It owns an isolated conversation/MCP manager while repository operations proxy to
 * the parent Isolate session's durable workspace.
 */
export class IsolateSubAgent extends Think<Env> {
  maxSteps = ISOLATE_SUBAGENT_MAX_STEPS
  sendReasoning = false
  waitForMcpConnections = { timeout: 15_000 }
  workspaceBash = true
  workspace: WorkspaceLike = {
    readFile: async (path) => (await this.parent()).subagentWorkspaceReadFile(path),
    readFileBytes: async (path) => (await this.parent()).subagentWorkspaceReadFileBytes(path),
    writeFile: async (path, content) =>
      (await this.parent()).subagentWorkspaceWriteFile(path, content),
    readDir: async (path, options) =>
      (await this.parent()).subagentWorkspaceReadDir(path ?? "/", options),
    rm: async (path, options) => (await this.parent()).subagentWorkspaceRemove(path, options),
    glob: async (pattern) => (await this.parent()).subagentWorkspaceGlob(pattern),
    mkdir: async (path, options) => (await this.parent()).subagentWorkspaceMkdir(path, options),
    stat: async (path) => (await this.parent()).subagentWorkspaceStat(path),
  }
  private activeTurn: IsolateSubagentTurn | null = null
  private preparingInput: IsolateSubagentTrustedConfig | null = null

  getModel() {
    return Option.fromNullishOr(this.activeTurn).pipe(
      Option.map((turn) => turn.model.model),
      Option.getOrThrowWith(() => new Error("No model is prepared for this Isolate sub-agent run")),
    )
  }

  getSystemPrompt(): string {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn),
      () => new Error("No context is prepared for this Isolate sub-agent run"),
    )
    const facts = buildIsolateSystemPromptFacts({
      tools: turn.input.selectedTools,
      customMcpServers: turn.input.customMcpServers,
    })
    return [
      buildIsolateSystemPrompt({
        runtimeModelId: turn.model.runtimeModelId,
        providerId: turn.model.providerId,
        modelId: turn.model.modelId,
        hasRepoWorkspace: facts.hasRepoWorkspace,
        hasDocs: facts.hasDocs,
        hasWorkflowBuilder: facts.hasWorkflowBuilder,
        customMcpServerNames: turn.customMcpServerNames,
        mcpcfMcpServers: turn.mcpcfMcpServers,
      }),
      [
        "You are a delegated sub-agent working for a parent orchestrator.",
        "Complete only the delegated task and return concise, evidence-backed findings.",
        "You share the parent's writable repository workspace. Mutate only files within your assigned scope and report every mutation.",
        "Do not delegate further. If evidence is unavailable, say exactly what is missing instead of guessing.",
        "Keep list and search results bounded. Prefer count and exact-get tools before broad lists, and request at most 25 records per list call unless the task explicitly requires more.",
        ISOLATE_SUBAGENT_PERSISTENCE_PROMPT,
      ].join("\n"),
    ].join("\n\n")
  }

  getTools() {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn),
      () => new Error("No tools are prepared for this Isolate sub-agent run"),
    )
    return buildIsolateTools({
      env: this.env,
      db: makeD1Drizzle(this.env.DB),
      runtime: this.buildParentWorkspaceRuntime(),
      sessionId: turn.input.parentSessionId,
      userId: turn.input.userId,
      selectedTools: turn.input.selectedTools,
      docsRuntimeContext: this.createDocsRuntimeContext(turn.input),
      tracingLayer: makeBackgroundTracingLayer({ tracing: workerTracing }),
    })
  }

  async getSkills() {
    const input =
      this.activeTurn?.input ?? this.preparingInput ?? (await this.loadTrustedConfig(this.name))
    return buildResolvedIsolateSkillSources({
      db: this.env.DB,
      tools: input.selectedTools,
      skillsBucket: this.env.AGENT_SKILLS,
      userId: input.userId,
    })
  }

  beforeTurn(ctx: TurnContext): TurnConfig {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn),
      () => new Error("No turn is prepared for this Isolate sub-agent run"),
    )
    const baseSystem = this.getSystemPrompt()
    const contextSystem = ctx.system.trim()
    return {
      system: Match.value(contextSystem.length > 0 && contextSystem !== baseSystem.trim()).pipe(
        Match.when(true, () => [baseSystem, contextSystem].join("\n\n")),
        Match.orElse(() => baseSystem),
      ),
      providerOptions: turn.model.providerOptions,
      maxSteps: resolveIsolateSubagentTurnStepLimit(turn.input.stepLimit),
    }
  }

  beforeStep(ctx: PrepareStepContext): StepConfig | void {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn),
      () => new Error("No turn is prepared for this Isolate sub-agent run"),
    )
    return Match.value(
      isIsolateSubagentFinalizationStep(ctx.stepNumber, turn.input.stepLimit),
    ).pipe(
      Match.when(
        true,
        (): StepConfig =>
          // oxlint-disable-next-line effect/avoid-any -- Think and the app resolve distinct AI SDK type identities, while the runtime StepConfig accepts these fields.
          ({
            activeTools: [],
            toolChoice: "none",
            messages: withIsolateSubagentFinalizationPrompt(ctx.messages),
          }) as unknown as StepConfig,
      ),
      Match.orElse(() => undefined),
    )
  }

  beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
    return Option.match(boundIsolateSubagentToolInput(ctx.toolName, ctx.input), {
      onNone: () => undefined,
      onSome: (input) => ({ action: "allow", input }),
    })
  }

  protected formatAgentToolInput(input: unknown): UIMessage {
    assertRunInput(input)
    return {
      id: `subagent-${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: formatDelegation(input.delegation) }],
    }
  }

  async startAgentToolRun(
    input: unknown,
    options: { runId: string },
  ): Promise<Awaited<ReturnType<Think<Env>["startAgentToolRun"]>>> {
    const startedAt = Date.now()
    // oxlint-disable-next-line effect/avoid-try-catch -- The SDK adapter must turn every preparation failure into a terminal inspection instead of rejecting and stranding the parent run.
    try {
      assertRunInput(input)
      const trustedConfig = await this.loadTrustedConfig(options.runId)
      await this.prepareRuntime(options.runId, trustedConfig, input.delegation.task)
      return await super.startAgentToolRun(input, options)
    } catch {
      this.activeTurn = null
      this.preparingInput = null
      return {
        runId: options.runId,
        status: "error",
        error: SUBAGENT_PREPARATION_ERROR,
        startedAt,
        completedAt: Date.now(),
      }
    }
  }

  async inspectAgentToolRun(
    runId: string,
  ): Promise<Awaited<ReturnType<Think<Env>["inspectAgentToolRun"]>>> {
    const inspection = await super.inspectAgentToolRun(runId)
    Match.value(inspection?.status).pipe(
      Match.whenOr("completed", "error", "aborted", () => this.clearActiveRuntime()),
      Match.orElse(() => undefined),
    )
    return inspection
  }

  protected async onChatRecovery(
    context: ChatRecoveryContext,
  ): Promise<ChatRecoveryOptions | void> {
    // oxlint-disable-next-line effect/avoid-try-catch -- Recovery errors cross an SDK callback boundary and must be replaced with a fixed, non-secret message.
    try {
      const trustedConfig = await this.loadTrustedConfig(this.name)
      await this.prepareRuntime(this.name, trustedConfig, "Recovered delegated sub-agent turn")
    } catch {
      throw new Error(SUBAGENT_PREPARATION_ERROR)
    }
    return super.onChatRecovery(context)
  }

  private async prepareRuntime(
    runId: string,
    input: IsolateSubagentTrustedConfig,
    requestContent: string,
  ): Promise<void> {
    return Match.value(this.activeTurn?.runId === runId).pipe(
      Match.when(true, () => Promise.resolve()),
      Match.orElse(() => this.prepareFreshRuntime(runId, input, requestContent)),
    )
  }

  private async prepareFreshRuntime(
    runId: string,
    input: IsolateSubagentTrustedConfig,
    requestContent: string,
  ): Promise<void> {
    this.preparingInput = input
    // oxlint-disable-next-line effect/avoid-try-catch -- The transient preparation context must be cleared after both successful and failed Promise-based SDK setup.
    try {
      const [model, mcpTurn] = await Promise.all([
        // oxlint-disable-next-line effect/effect-run-in-body -- Think lifecycle hooks are Promise APIs; this is the Effect-to-SDK boundary.
        Effect.runPromise(
          compileIsolateModelContext({
            env: this.env,
            observability: { tracing: workerTracing },
            userId: input.userId,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
          }),
        ),
        // oxlint-disable-next-line effect/effect-run-in-body -- Think lifecycle hooks are Promise APIs; this is the Effect-to-SDK boundary.
        Effect.runPromise(
          prepareIsolateMcpTurn({
            env: this.env,
            manager: this.mcp,
            customMcpServers: input.customMcpServers,
            selectedTools: input.selectedTools,
            createObserver: this.createInternalRequestObserver.bind(this),
            runtime: {
              sessionId: input.parentSessionId,
              userId: input.userId,
              repoOwner: input.repoOwner,
              repoName: input.repoName,
            },
            request: {
              content: requestContent,
              model: input.model,
              reasoningEffort: input.reasoningEffort,
            },
          }),
        ),
      ])
      this.activeTurn = {
        runId,
        input,
        model,
        customMcpServerNames: mcpTurn.connectedServerNames,
        mcpcfMcpServers: mcpTurn.mcpcfMcpServers,
      }
    } finally {
      this.preparingInput = null
    }
  }

  private async loadTrustedConfig(runId: string): Promise<IsolateSubagentTrustedConfig> {
    const config = await (await this.parent()).getSubagentTrustedConfig(runId)
    return Option.getOrThrowWith(
      Option.fromNullishOr(config),
      () => new Error(SUBAGENT_PREPARATION_ERROR),
    )
  }

  private clearActiveRuntime(): void {
    this.activeTurn = null
    this.preparingInput = null
  }

  private createInternalRequestObserver(path: string, routeBranch: string) {
    const input = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn?.input ?? this.preparingInput),
      () => new Error("No request context is prepared for this Isolate sub-agent run"),
    )
    const observer = createApiRequestObserver(
      new Request(`http://internal/isolate/subagent/${path}`, { method: "POST" }),
      this.env,
      {
        waitUntil: this.ctx.waitUntil.bind(this.ctx),
        passThroughOnException() {},
        props: {},
        tracing: workerTracing,
      },
    )
    observer.setRouteBranch(routeBranch)
    observer.setUserId(input.userId)
    return observer
  }

  private createDocsRuntimeContext(input: IsolateSubagentTrustedConfig): AiSearchMcpRuntimeContext {
    return {
      log: {
        error: (error, context) => {
          this.createInternalRequestObserver(
            "docs_search",
            "isolate-subagent-docs-search",
          ).log.error(error, {
            ...context,
            sessionId: input.parentSessionId,
          })
        },
      },
    }
  }

  private buildParentWorkspaceRuntime(): IsolateWorkspaceRuntime {
    return {
      readWorkspaceFile: async (_sessionId, path) => (await this.parent()).readWorkspaceFile(path),
      writeWorkspaceFile: async (_sessionId, path, content) =>
        (await this.parent()).writeWorkspaceFile(path, content),
      globWorkspace: async (_sessionId, pattern, limit) =>
        (await this.parent()).globWorkspace(pattern, limit),
      searchWorkspace: async (_sessionId, query, pattern, limit) =>
        (await this.parent()).searchWorkspace(query, pattern, limit),
      gitStatus: async () => (await this.parent()).gitStatus(),
      gitDiff: async () => (await this.parent()).gitDiff(),
      gitLog: async (_sessionId, depth) => (await this.parent()).gitLog(depth),
      gitCreatePullRequest: async (_sessionId, pullRequest) =>
        (await this.parent()).gitCreatePullRequest(pullRequest),
    }
  }

  private parent() {
    return this.parentAgent(IsolateSessionAgent)
  }
}
