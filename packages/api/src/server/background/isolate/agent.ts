import { tracing as workerTracing } from "cloudflare:workers"
import {
  Think,
  type ChatRecoveryContext,
  type ChatRecoveryOptions,
  type ChatResponseResult,
  type Session,
  type StreamCallback,
  type TurnConfig,
  type TurnContext,
} from "@cloudflare/think"
import { createCompactFunction } from "agents/experimental/memory/utils"
import type { AgentToolLifecycleResult, AgentToolRunInfo } from "agents"
import { Workspace, type FileInfo } from "@cloudflare/shell"
import { generateText, type ToolSet } from "ai"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  normalizeSubagentMode,
  type PullRequest,
  type SessionToolSpec,
} from "@solzero/shared"
import { describeError } from "../../lib/effect-errors"
import {
  createApiRequestObserver,
  type ApiRequestObserver,
} from "../../effect/services/observability"
import {
  BackgroundTracing,
  aiTelemetrySettings,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- isolate agent.ts is a composition root. It builds the tracing layer at the Effect.runPromise edge.
  makeBackgroundTracingLayer,
} from "../observability/tracing"
import { compileIsolateModelContext, type IsolateModelContext } from "./model"
import { getLatestAssistantText } from "./message-chunks"
import { prepareIsolateMcpTurn } from "./mcpcf-turn"
import { runChatWithStepLimitRecovery } from "./step-limit-recovery"
import type { IsolateWorkspaceRuntime } from "./tools"
import { ensureRepositoryWorkspace } from "./agent/repository-workspace"
import {
  createInitialIsolateSessionAgentState,
  IsolateSubagentController,
  type IsolateSubagentHost,
} from "./agent/subagent-controller"
import {
  buildIsolateTurnSkills,
  buildIsolateTurnSystemPrompt,
  buildIsolateTurnTools,
} from "./agent/turn-surface"
import { IsolateAgentWorkspace } from "./agent/workspace-facade"
import { IsolateParentTurnRecovery } from "./agent/parent-turn-recovery"
import {
  clearSubagentTrustedConfigs,
  readSubagentTrustedConfig,
  registerSubagentTrustedConfig,
  releaseSubagentTrustedConfig,
  type IsolateSubagentTrustedConfig,
} from "./agent/subagent-trusted-config"
import { logIsolateStreamLifecycle } from "./agent/turn-observability"
import type { Env } from "../types"
import {
  buildCapabilities,
  type ActiveTurn,
  type IsolateCloneAuth,
  type IsolatePromptRequest,
  type IsolatePromptResult,
  type IsolateRuntimeStatus,
  type IsolateSessionAgentState,
  type IsolateSessionCapabilities,
  type IsolateSessionConfig,
  type IsolateWarmResult,
} from "./agent/types"
export type {
  IsolateCloneAuth,
  IsolatePromptRequest,
  IsolatePromptResult,
  IsolateRuntimeStatus,
  IsolateSessionCapabilities,
  IsolateSessionConfig,
  IsolateWarmResult,
} from "./agent/types"
export class IsolateSessionAgent
  extends Think<Env, IsolateSessionAgentState>
  implements IsolateSubagentHost
{
  initialState = createInitialIsolateSessionAgentState()
  maxSteps = DEFAULT_ISOLATE_STEP_LIMIT
  maxConcurrentAgentTools = 4
  sendReasoning = false
  waitForMcpConnections = { timeout: 15_000 }
  activeTurn: ActiveTurn | null = null
  private stopRequested = false
  private readonly subagents = new IsolateSubagentController(this)
  private readonly turnRecovery = new IsolateParentTurnRecovery(this, this.ctx.storage.sql)

  workspace = new Workspace({
    sql: this.ctx.storage.sql,
    name: () => this.getRuntimeId(),
  })

  private readonly repoWorkspace = new IsolateAgentWorkspace(this)

  override chatRecovery = {
    onExhausted: () => this.turnRecovery.clearEnvelope(),
  }

  getEnv(): Env {
    return this.env
  }

  protected override async onChatRecovery(
    context: ChatRecoveryContext,
  ): Promise<ChatRecoveryOptions | void> {
    await this.turnRecovery.recoverParentTurn()
    return super.onChatRecovery(context)
  }

  override onChatResponse(result: ChatResponseResult): void | Promise<void> {
    this.turnRecovery.completeRecoveredTurn()
    return super.onChatResponse(result)
  }

  // Trusted-config storage must stay reachable on the agent class so awaited
  // sub-agents can call it through `this.parent()` Durable Object RPC stubs.
  registerSubagentTrustedConfig(
    runId: string,
    config: IsolateSubagentTrustedConfig,
  ): Promise<void> {
    registerSubagentTrustedConfig(this.ctx.storage.sql, runId, config)
    return Promise.resolve()
  }

  getSubagentTrustedConfig(runId: string): Promise<IsolateSubagentTrustedConfig | null> {
    return Promise.resolve(readSubagentTrustedConfig(this.ctx.storage.sql, runId))
  }

  releaseSubagentTrustedConfig(runId: string): Promise<void> {
    releaseSubagentTrustedConfig(this.ctx.storage.sql, runId)
    return Promise.resolve()
  }

  clearSubagentTrustedConfigs(): Promise<void> {
    clearSubagentTrustedConfigs(this.ctx.storage.sql)
    return Promise.resolve()
  }

  configureSession(session: Session): Session {
    return session
      .withContext("memory", {
        description:
          "Durable facts, decisions, and preferences learned during this isolate conversation.",
        maxTokens: 2000,
      })
      .withContext("conversation_history", {
        description: "Full-text search over prior messages in this isolate conversation.",
        provider: {
          get: async () =>
            "Prior messages are stored in Durable Object SQLite and can be searched with search_context.",
          search: async (query: string) => this.searchConversationHistory(query),
        },
      })
      .onCompaction(
        createCompactFunction({
          summarize: async (prompt) => this.summarizeCompaction(prompt),
        }),
      )
      .compactAfter(100_000)
  }

  getModel() {
    return Option.fromNullishOr(this.activeTurn).pipe(
      Option.map((turn) => turn.model.model),
      Option.getOrThrowWith(() => new Error("No isolate model is prepared for this Think turn")),
    )
  }

  getSystemPrompt(): string {
    const basePrompt = buildIsolateTurnSystemPrompt({
      state: this.state,
      activeTurn: this.activeTurn,
    })
    return [basePrompt, ...this.subagents.promptSections()].join("\n\n")
  }
  createInternalRequestObserver(path: string, routeBranch: string): ApiRequestObserver {
    const observer = createApiRequestObserver(
      new Request(`http://internal/isolate/${path}`, { method: "POST" }),
      this.env,
      {
        waitUntil: this.ctx.waitUntil.bind(this.ctx),
        passThroughOnException() {},
        props: {},
        tracing: workerTracing,
      },
    )
    observer.setRouteBranch(routeBranch)
    observer.setUserId(this.state.userId)
    return observer
  }

  waitUntilSubagentLifecycle(promise: Promise<unknown>): void {
    this.ctx.waitUntil(promise)
  }

  getTools(): ToolSet {
    const baseTools = buildIsolateTurnTools({
      env: this.env,
      runtime: this.buildDirectRuntime(),
      sessionId: this.getRuntimeId(),
      userId: this.state.userId,
      selectedTools: this.state.tools ?? [],
      createObserver: this.createInternalRequestObserver.bind(this),
    })
    return { ...baseTools, ...this.subagents.tools() }
  }
  async getSkills() {
    return buildIsolateTurnSkills({ env: this.env, state: this.state })
  }

  // The agents SDK delivers sub-agent AgentToolEventMessage frames to the
  // parent only through the WebSocket broadcast path; there is no dedicated
  // lifecycle hook for per-frame events. Intercepting broadcast() is therefore
  // the tap point for the controller's event capture and durable relay. Non
  // sub-agent broadcasts fail the frame parse cheaply and pass through.
  broadcast(message: string | ArrayBuffer | ArrayBufferView, without?: string[]): void {
    super.broadcast(message, without)
    this.subagents.handleBroadcast(message)
  }

  async onAgentToolStart(run: AgentToolRunInfo): Promise<void> {
    await super.onAgentToolStart(run)
    await this.subagents.onStart(run)
  }

  async onAgentToolFinish(run: AgentToolRunInfo, result: AgentToolLifecycleResult): Promise<void> {
    await super.onAgentToolFinish(run, result)
    await this.subagents.onFinish(run, result)
  }

  beforeTurn(ctx: TurnContext): TurnConfig {
    const baseSystem = this.getSystemPrompt()
    const contextSystem = ctx.system.trim()
    const fallbackSystem = baseSystem.trim()
    const finalizing = this.activeTurn?.finalizingAfterStepLimit === true

    const optionalSections = Arr.getSomes([
      Option.liftPredicate(contextSystem, (value) => value.length > 0 && value !== fallbackSystem),
      Option.fromNullishOr(this.activeTurn?.repoWarning).pipe(
        Option.filter((warning) => warning.length > 0),
        Option.map((warning) => ["Repository warning:", warning].join("\n")),
      ),
      Option.liftPredicate(finalizing, (resolved) => resolved).pipe(
        Option.map(() =>
          [
            "Step limit recovery:",
            "The prior attempt reached the per-response tool-call step limit.",
            "Do not call tools in this recovery response. Use the existing conversation and tool results to answer the user.",
          ].join("\n"),
        ),
      ),
    ])
    const systemSections = [baseSystem, ...optionalSections]

    Option.match(
      Option.liftPredicate(
        (this.state.tools ?? []).some((tool) => tool.kind === "workflow_builder"),
        (enabled) => enabled,
      ),
      {
        onNone: () => undefined,
        onSome: () =>
          this.createInternalRequestObserver(
            "workflow_builder_turn",
            "isolate-workflow-builder",
          ).log.info("Workflow builder isolate turn configured", {
            sessionId: this.getRuntimeId(),
            userId: this.state.userId,
            availableTools: Object.keys(ctx.tools).filter(
              (toolName) =>
                toolName.startsWith("get_workflow_") ||
                toolName.startsWith("validate_workflow_") ||
                toolName.startsWith("submit_workflow_"),
            ),
          }),
      },
    )

    const turnConfig: TurnConfig = {
      system: systemSections.join("\n\n"),
      providerOptions: this.activeTurn?.model.providerOptions,
      telemetry: aiTelemetrySettings("isolate.think.turn", {
        "session.id": this.getRuntimeId(),
        "user.id": this.state.userId,
        "repo.owner": this.state.repoOwner ?? "",
        "repo.name": this.state.repoName ?? "",
        "ai.provider": this.activeTurn?.model.providerId ?? "",
        "ai.model": this.activeTurn?.model.modelId ?? "",
        "ai.runtime_model": this.activeTurn?.model.runtimeModelId ?? "",
        "tool.count": Object.keys(ctx.tools).length,
        "mcp.custom_server_count": this.activeTurn?.customMcpServerNames?.length ?? 0,
        "mcp.mcpcf_server_count": this.activeTurn?.mcpcfMcpServers?.length ?? 0,
        "isolate.finalizing_after_step_limit": finalizing,
      }),
      maxSteps: Match.value(finalizing).pipe(
        Match.when(true, () => 1),
        Match.orElse(() => normalizeIsolateStepLimit(this.state.isolateStepLimit, this.maxSteps)),
      ),
    }

    return Match.value(finalizing).pipe(
      Match.when(
        true,
        (): TurnConfig =>
          ({
            ...turnConfig,
            activeTools: [],
            toolChoice: "none",
          }) as TurnConfig,
      ),
      Match.orElse(() => turnConfig),
    )
  }

  async initializeSession(config: IsolateSessionConfig): Promise<{ runtimeId: string }> {
    const nextState: IsolateSessionAgentState = {
      sessionId: config.sessionId,
      userId: config.userId,
      repoOwner: config.repoOwner,
      repoName: config.repoName,
      repoDefaultBranch: config.repoDefaultBranch ?? null,
      branchName: config.branchName ?? null,
      model: config.model,
      isolateStepLimit: normalizeIsolateStepLimit(
        config.isolateStepLimit,
        DEFAULT_ISOLATE_STEP_LIMIT,
      ),
      subagents: normalizeSubagentMode(config.subagents),
      githubName: config.githubName ?? null,
      githubEmail: config.githubEmail ?? null,
      tools: normalizeSessionTools(config.tools),
      customMcpServers: normalizeOpenCodeMcpServers(config.customMcpServers),
      secretEnv: config.secretEnv ?? {},
      runtimeStatus: "pending",
      lastError: null,
    }
    this.setState(nextState)
    await this.persistSessionMetadata(nextState)
    return { runtimeId: this.getRuntimeId() }
  }

  async updateSessionConfig(
    config: Omit<IsolateSessionConfig, "userId">,
  ): Promise<{ runtimeId: string }> {
    const nextState: IsolateSessionAgentState = {
      ...this.state,
      sessionId: config.sessionId,
      repoOwner: config.repoOwner,
      repoName: config.repoName,
      repoDefaultBranch: config.repoDefaultBranch ?? null,
      branchName: config.branchName ?? null,
      model: config.model,
      isolateStepLimit: normalizeIsolateStepLimit(
        config.isolateStepLimit,
        this.state.isolateStepLimit ?? DEFAULT_ISOLATE_STEP_LIMIT,
      ),
      subagents: normalizeSubagentMode(
        config.subagents,
        normalizeSubagentMode(this.state.subagents),
      ),
      githubName: config.githubName ?? null,
      githubEmail: config.githubEmail ?? null,
      tools: normalizeSessionTools(config.tools),
      customMcpServers: normalizeOpenCodeMcpServers(config.customMcpServers),
      secretEnv: config.secretEnv ?? this.state.secretEnv ?? {},
      lastError: null,
    }
    this.setState(nextState)
    await this.persistSessionMetadata(nextState)
    return { runtimeId: this.getRuntimeId() }
  }

  async warm(auth?: IsolateCloneAuth): Promise<IsolateWarmResult> {
    this.setState({
      ...this.state,
      runtimeStatus: "warming",
      lastError: null,
    })

    // oxlint-disable-next-line effect/effect-run-in-body -- RpcTarget entrypoint boundary; runs the repository-preparation span Effect at the Durable Object RPC edge.
    const repoPreparation = await Effect.runPromise(
      ensureRepositoryWorkspace({ workspace: this.workspace, state: this.state, auth }),
    )
    const nextStatus: IsolateRuntimeStatus = Match.value(Boolean(repoPreparation.error)).pipe(
      Match.when(true, () => "failed" as IsolateRuntimeStatus),
      Match.orElse(() => "ready" as IsolateRuntimeStatus),
    )
    this.setState({
      ...this.state,
      runtimeStatus: nextStatus,
      lastError: repoPreparation.error ?? null,
    })
    await this.persistSessionMetadata({
      ...this.state,
      runtimeStatus: nextStatus,
      lastError: repoPreparation.error ?? null,
    })

    return {
      runtimeId: this.getRuntimeId(),
      status: nextStatus,
      lastError: repoPreparation.error ?? null,
    }
  }

  async runPrompt(
    request: IsolatePromptRequest,
    callback?: StreamCallback,
  ): Promise<IsolatePromptResult> {
    const promptEffect = Effect.gen({ self: this }, function* () {
      const backgroundTracing = yield* BackgroundTracing
      return yield* backgroundTracing.withSpan(
        "isolate.agent.run_prompt",
        {
          "session.id": this.getRuntimeId(),
          "user.id": this.state.userId,
          "repo.owner": this.state.repoOwner ?? "",
          "repo.name": this.state.repoName ?? "",
          "message.content_length": request.content.length,
          "ai.model": request.model,
          "reasoning.effort": request.reasoningEffort ?? "",
          "tool.count": this.state.tools?.length ?? 0,
        },
        this.runPromptEffect(request, callback),
        { parentContext: request.observabilityTrace },
      )
    }).pipe(Effect.provide(makeBackgroundTracingLayer({ tracing: workerTracing })))
    // oxlint-disable-next-line effect/effect-run-in-body -- RpcTarget entrypoint boundary; runs the run_prompt span Effect at the Durable Object RPC edge.
    return Effect.runPromise(promptEffect)
  }

  private runPromptEffect(request: IsolatePromptRequest, callback?: StreamCallback) {
    return Effect.gen({ self: this }, function* () {
      this.stopRequested = false
      this.subagents.beginTurn()
      this.setState({
        ...this.state,
        runtimeStatus: "running",
        lastError: null,
      })

      const backgroundTracing = yield* BackgroundTracing
      const repoPreparation = yield* backgroundTracing.withSpan(
        "isolate.repository.prepare",
        {
          "session.id": this.getRuntimeId(),
          "repo.owner": this.state.repoOwner ?? "",
          "repo.name": this.state.repoName ?? "",
          "repo.branch": this.state.branchName ?? "",
          "repo.default_branch": this.state.repoDefaultBranch ?? "",
        },
        ensureRepositoryWorkspace({ workspace: this.workspace, state: this.state, auth: request }),
      )
      const selectedTools = this.state.tools ?? []
      const createMcpcfObserver = this.createInternalRequestObserver.bind(this)
      const mcpcfRuntime = {
        sessionId: this.getRuntimeId(),
        userId: this.state.userId,
        repoOwner: this.state.repoOwner,
        repoName: this.state.repoName,
      }
      const mcpTurn = yield* backgroundTracing.withSpan(
        "isolate.mcp.prepare_turn",
        {
          "session.id": this.getRuntimeId(),
          "user.id": this.state.userId,
          "tool.count": selectedTools.length,
          "mcp.custom_server_count": Object.keys(this.state.customMcpServers ?? {}).length,
        },
        prepareIsolateMcpTurn({
          env: this.env,
          manager: this.mcp,
          customMcpServers: this.state.customMcpServers,
          selectedTools,
          createObserver: createMcpcfObserver,
          runtime: mcpcfRuntime,
          request,
          callback,
        }),
      )
      const model = yield* backgroundTracing.withSpan(
        "isolate.model.compile",
        {
          "session.id": this.getRuntimeId(),
          "user.id": this.state.userId,
          "ai.model.requested": request.model,
          "reasoning.effort": request.reasoningEffort ?? "",
        },
        compileIsolateModelContext({
          env: this.env,
          observability: {
            tracing: workerTracing,
          },
          userId: this.state.userId,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
        }),
      )

      this.activeTurn = {
        model,
        requestedModel: request.model,
        reasoningEffort: request.reasoningEffort,
        auth: request,
        repoWarning: repoPreparation.error ?? null,
        customMcpServerNames: mcpTurn.connectedServerNames,
        mcpcfMcpServers: mcpTurn.mcpcfMcpServers,
        messageId: request.messageId,
        callback,
      }
      this.turnRecovery.registerEnvelope(request, repoPreparation.error ?? null)

      return yield* this.executeTurn(request, callback, model, selectedTools, repoPreparation)
    })
  }

  private executeTurn(
    request: IsolatePromptRequest,
    callback: StreamCallback | undefined,
    model: IsolateModelContext,
    selectedTools: readonly SessionToolSpec[],
    repoPreparation: { error?: string },
  ) {
    return Effect.gen({ self: this }, function* () {
      const backgroundTracing = yield* BackgroundTracing
      let chatRequestId = Option.none<string>()
      const output = yield* backgroundTracing.withSpan(
        "isolate.think.chat",
        {
          "session.id": this.getRuntimeId(),
          "user.id": this.state.userId,
          "ai.provider": model.providerId,
          "ai.model": model.modelId,
          "ai.runtime_model": model.runtimeModelId,
          "message.content_length": request.content.length,
          "tool.count": selectedTools.length,
          "step.limit": normalizeIsolateStepLimit(this.state.isolateStepLimit, this.maxSteps),
        },
        runChatWithStepLimitRecovery({
          content: request.content,
          stepLimit: normalizeIsolateStepLimit(this.state.isolateStepLimit, this.maxSteps),
          callback,
          onStreamStart: (event) => {
            chatRequestId = Option.some(event.requestId)
            logIsolateStreamLifecycle(this, "started", {
              request,
              model,
              requestId: event.requestId,
            })
          },
          onStreamInterrupted: () =>
            logIsolateStreamLifecycle(this, "interrupted", {
              request,
              model,
              requestId: chatRequestId,
            }),
          chat: (content, relay) => this.chat(content, relay),
          enableFinalizationMode: () => this.enableFinalizationMode(),
          getFallbackAssistantText: () => getLatestAssistantText(this.messages),
        }),
      )
      const subagentResult = yield* Effect.tryPromise({
        try: () => this.subagents.finishTurn(request.messageId),
        catch: (cause) => cause,
      })

      const nextState: IsolateSessionAgentState = {
        ...this.state,
        runtimeStatus: "ready",
        lastError: repoPreparation.error ?? null,
      }
      this.setState(nextState)
      yield* Effect.tryPromise({
        try: () => this.persistSessionMetadata(nextState),
        catch: (cause) => cause,
      })

      return {
        runtimeId: this.getRuntimeId(),
        output: output.trim(),
        status: nextState.runtimeStatus,
        lastError: nextState.lastError,
        capabilities: buildCapabilities(nextState),
        ...subagentResult,
      }
    }).pipe(
      Effect.tapError((cause) => this.recordTurnFailure(cause)),
      Effect.ensuring(this.resetActiveTurn()),
    )
  }

  private resetActiveTurn() {
    return Effect.sync(() => {
      this.turnRecovery.clearEnvelope()
      this.activeTurn = null
      this.stopRequested = false
    })
  }

  private recordTurnFailure(cause: unknown) {
    return Effect.gen({ self: this }, function* () {
      const message = describeError(cause)
      const nextState: IsolateSessionAgentState = Match.value(this.stopRequested).pipe(
        Match.when(true, () => ({
          ...this.state,
          runtimeStatus: "ready" as IsolateRuntimeStatus,
          lastError: null,
        })),
        Match.orElse(() => ({
          ...this.state,
          runtimeStatus: "failed" as IsolateRuntimeStatus,
          lastError: message,
        })),
      )
      this.setState(nextState)
      yield* Effect.tryPromise({
        try: () => this.persistSessionMetadata(nextState),
        catch: (failure) => failure,
      })
    })
  }

  private enableFinalizationMode(): void {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.activeTurn),
      () => new Error("No isolate model is prepared for step-limit recovery"),
    )
    this.activeTurn = {
      ...turn,
      finalizingAfterStepLimit: true,
    }
    this.turnRecovery.setFinalizationMode(true)
  }

  async stopPrompt(): Promise<{
    runtimeId: string
    status: IsolateRuntimeStatus
  }> {
    this.stopRequested = true
    this.turnRecovery.clearEnvelope()
    this.abortAllRequests()
    await this.subagents.cancelActive("Parent Isolate prompt was stopped")
    const stoppedStatus: IsolateRuntimeStatus = Match.value(this.state.runtimeStatus).pipe(
      Match.when("running", () => "ready" as IsolateRuntimeStatus),
      Match.orElse((status) => status),
    )
    const nextState: IsolateSessionAgentState = {
      ...this.state,
      runtimeStatus: stoppedStatus,
      lastError: null,
    }
    this.setState(nextState)
    await this.persistSessionMetadata(nextState)
    return { runtimeId: this.getRuntimeId(), status: nextState.runtimeStatus }
  }

  async clearSubagentRuns(): Promise<void> {
    await this.subagents.clear()
  }

  async getRuntimeState(): Promise<{
    runtimeId: string
    status: IsolateRuntimeStatus
    lastError: string | null
    capabilities: IsolateSessionCapabilities
  }> {
    return {
      runtimeId: this.getRuntimeId(),
      status: this.state.runtimeStatus,
      lastError: this.state.lastError,
      capabilities: buildCapabilities(this.state),
    }
  }

  // Workspace/git RPC surface. These must remain methods on the agent class so
  // Durable Object RPC stubs and awaited sub-agents (via `this.parent()`) can
  // reach them; the implementation lives in IsolateAgentWorkspace.
  readWorkspaceFile(path: string): Promise<{ path: string; content: string }> {
    return this.repoWorkspace.readFile(path)
  }

  writeWorkspaceFile(path: string, content: string): Promise<{ path: string; bytes: number }> {
    return this.repoWorkspace.writeFile(path, content)
  }

  subagentWorkspaceReadFile(path: string): Promise<string | null> {
    return this.repoWorkspace.subagentReadFile(path)
  }

  subagentWorkspaceReadFileBytes(path: string): Promise<Uint8Array | null> {
    return this.repoWorkspace.subagentReadFileBytes(path)
  }

  subagentWorkspaceWriteFile(path: string, content: string): Promise<void> {
    return this.repoWorkspace.subagentWriteFile(path, content)
  }

  subagentWorkspaceReadDir(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<FileInfo[]> {
    return this.repoWorkspace.subagentReadDir(path, options)
  }

  subagentWorkspaceRemove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    return this.repoWorkspace.subagentRemove(path, options)
  }

  subagentWorkspaceGlob(pattern: string): Promise<FileInfo[]> {
    return this.repoWorkspace.subagentGlob(pattern)
  }

  subagentWorkspaceMkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.repoWorkspace.subagentMkdir(path, options)
  }

  subagentWorkspaceStat(path: string): Promise<FileInfo | null> {
    return this.repoWorkspace.subagentStat(path)
  }

  globWorkspace(pattern?: string, limit?: number): Promise<string[]> {
    return this.repoWorkspace.glob(pattern, limit)
  }

  searchWorkspace(
    query: string,
    pattern?: string,
    limit?: number,
  ): Promise<Array<{ path: string; excerpt: string }>> {
    return this.repoWorkspace.search(query, pattern, limit)
  }

  gitStatus(): Promise<Array<{ filepath: string; status: string }>> {
    return this.repoWorkspace.gitStatus()
  }

  gitDiff(): Promise<Array<{ filepath: string; status: string }>> {
    return this.repoWorkspace.gitDiff()
  }

  gitLog(depth?: number): Promise<Array<{ oid: string; message: string }>> {
    return this.repoWorkspace.gitLog(depth)
  }

  gitCreatePullRequest(input: {
    title: string
    body?: string
    commitMessage?: string
  }): Promise<PullRequest> {
    return this.repoWorkspace.gitCreatePullRequest(input)
  }

  getRuntimeId(): string {
    return this.state.sessionId || this.name
  }

  buildDirectRuntime(): IsolateWorkspaceRuntime {
    return {
      readWorkspaceFile: async (_sessionId, path) => this.readWorkspaceFile(path),
      writeWorkspaceFile: async (_sessionId, path, content) =>
        this.writeWorkspaceFile(path, content),
      globWorkspace: async (_sessionId, pattern, limit) => this.globWorkspace(pattern, limit),
      searchWorkspace: async (_sessionId, query, pattern, limit) =>
        this.searchWorkspace(query, pattern, limit),
      gitStatus: async () => this.gitStatus(),
      gitDiff: async () => this.gitDiff(),
      gitLog: async (_sessionId, depth) => this.gitLog(depth),
      gitCreatePullRequest: async (_sessionId, input) => this.gitCreatePullRequest(input),
    }
  }

  private resolveCompactionModel() {
    return Option.match(Option.fromNullishOr(this.activeTurn?.model), {
      onNone: () =>
        compileIsolateModelContext({
          env: this.env,
          userId: this.state.userId || "unknown",
          model: this.state.model,
        }),
      onSome: (model) => Effect.succeed(model),
    })
  }

  private async summarizeCompaction(prompt: string): Promise<string> {
    // oxlint-disable-next-line effect/effect-run-in-body -- agents memory compaction callback boundary requires a Promise; runs the model-resolution span Effect at that edge.
    const model = await Effect.runPromise(this.resolveCompactionModel())
    const telemetry = aiTelemetrySettings("isolate.compaction.summary", {
      "session.id": this.getRuntimeId(),
      "user.id": this.state.userId,
      "ai.provider": model.providerId,
      "ai.model": model.modelId,
      "ai.runtime_model": model.runtimeModelId,
    })
    const result = await generateText({
      model: model.model,
      prompt,
      telemetry,
      runtimeContext: telemetry.metadata,
      providerOptions: model.providerOptions,
    })
    return result.text.trim()
  }

  private async searchConversationHistory(query: string): Promise<string | null> {
    const results = await this.session.search(query, { limit: 10 })
    return Option.match(
      Option.liftPredicate(results, (entries) => entries.length > 0),
      {
        onNone: () => null,
        onSome: (entries) =>
          entries
            .map((result) => [`[${result.role}] ${result.id}`, result.content].join("\n"))
            .join("\n\n"),
      },
    )
  }

  private persistSessionMetadata(state: IsolateSessionAgentState): Promise<void> {
    return this.repoWorkspace.persistSessionMetadata(state)
  }
}
