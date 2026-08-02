import { tracing as workerTracing } from "cloudflare:workers"
import type { StreamCallback } from "@cloudflare/think"
import { tool, type ToolSet } from "ai"
import type {
  AgentToolFailure,
  AgentToolEventMessage,
  AgentToolLifecycleResult,
  AgentToolRunInspection,
  AgentToolRunInfo,
  ChatCapableAgentClass,
  RunAgentToolOptions,
  RunAgentToolResult,
} from "agents"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  DEFAULT_SUBAGENT_MODE,
  EMPTY_SUBAGENT_SUMMARY_ERROR,
  normalizeSubagentMode,
  summarizeSubagentRuns,
  type SubagentRunSummary,
  type SubagentSessionEvent,
} from "@c0-agent/shared"
import { describeError } from "../../../lib/effect-errors"
import type { ApiRequestObserver } from "../../../effect/services/observability"
import { BackgroundTracing, makeBackgroundTracingLayer } from "../../observability/tracing"
import {
  delegateToSubagentInputSchema,
  parseAgentToolEventMessage,
  sanitizeSubagentTaskPreview,
  toAgentToolFailure,
  type DelegateToSubagentTool,
} from "./delegation"
import type { ActiveTurn, IsolateSessionAgentState } from "./types"
import {
  IsolateSubAgent,
  type IsolateSubagentDelegation,
  type IsolateSubagentRunInput,
} from "../subagent"
import { resolveIsolateSubagentToolStepLimit } from "../subagent-turn-policy"
import { SUBAGENT_ORCHESTRATOR_PROMPT } from "../subagent-prompts"
import {
  cancelInterruptedSubagentStillRunning,
  OrderedSubagentEventRelay,
} from "./subagent-event-relay"
import {
  hydrateCompletedAgentToolEventMessage,
  inspectedAgentToolCompletedAtMs,
  projectSubagentSessionEvent,
  readAgentToolInputPreview,
  resolveAgentToolCompletedAtMs,
  startedAgentToolEventMessage,
  terminalAgentToolEventMessage,
} from "./subagent-event-projection"
import { resolveSubagentMessageId } from "./subagent-dispatch-state"
import {
  claimHostSubagentRun,
  completeHostSubagentTurn,
  persistHostSubagentEvent,
  type SubagentStateHost,
} from "./subagent-host"
import {
  trustedConfigFromRunInput,
  type IsolateSubagentTrustedConfig,
} from "./subagent-trusted-config"

export function createInitialIsolateSessionAgentState(): IsolateSessionAgentState {
  return {
    sessionId: "",
    userId: "",
    repoOwner: "",
    repoName: "",
    model: "",
    isolateStepLimit: DEFAULT_ISOLATE_STEP_LIMIT,
    subagents: DEFAULT_SUBAGENT_MODE,
    tools: [],
    customMcpServers: {},
    secretEnv: {},
    runtimeStatus: "pending",
    lastError: null,
  }
}

export interface IsolateSubagentHost extends SubagentStateHost {
  readonly maxSteps: number
  readonly activeTurn: ActiveTurn | null
  createInternalRequestObserver(path: string, routeBranch: string): ApiRequestObserver
  runAgentTool<Input = unknown, Output = unknown>(
    cls: ChatCapableAgentClass,
    options: RunAgentToolOptions<Input>,
  ): Promise<RunAgentToolResult<Output>>
  cancelAgentTool(runId: string, reason?: unknown): Promise<void>
  clearAgentToolRuns(): Promise<void>
  inspectAgentToolRun(runId: string): Promise<AgentToolRunInspection<unknown> | null>
  listSubAgents(cls: typeof IsolateSubAgent): Array<{ name: string }>
  deleteSubAgent(cls: typeof IsolateSubAgent, name: string): Promise<void>
  registerSubagentTrustedConfig(runId: string, config: IsolateSubagentTrustedConfig): Promise<void>
  releaseSubagentTrustedConfig(runId: string): Promise<void>
  clearSubagentTrustedConfigs(): Promise<void>
  waitUntilSubagentLifecycle(promise: Promise<unknown>): void
}

export class IsolateSubagentController {
  private readonly activeRunIds = new Set<string>()
  /**
   * Every frame observed this turn, projected to the canonical
   * SubagentSessionEvent shape and keyed by `runId:sequence`. End-of-turn
   * summaries are derived from this log with the shared summarizeSubagentRuns
   * reducer instead of a hand-maintained parallel ledger.
   */
  private readonly capturedEvents = new Map<string, SubagentSessionEvent>()
  private readonly nextSequenceByRun = new Map<string, number>()
  private readonly terminalFrameByRun = new Map<string, AgentToolEventMessage>()
  private readonly completedAtByRun = new Map<string, number>()
  private readonly eventRelay: OrderedSubagentEventRelay

  constructor(private readonly host: IsolateSubagentHost) {
    this.eventRelay = new OrderedSubagentEventRelay({
      getCallback: (message) => this.callbackForMessage(message),
      resolveMessageId: (message) => this.messageIdForRun(message.event.runId),
      persist: (messageId, message, lifecycleTimestampMs) =>
        persistHostSubagentEvent(this.host, messageId, message, lifecycleTimestampMs),
      onCallbackFailure: (cause, message) =>
        this.logRelayFailure(
          "Sub-agent prompt callback rejected; using durable fallback",
          cause,
          message,
        ),
      onRelayFailure: (cause, message) =>
        this.logRelayFailure("Sub-agent event relay failed", cause, message),
    })
  }

  /** Prompt sections contributed by delegation; empty when sub-agents are disabled. */
  promptSections(): string[] {
    return Match.value(normalizeSubagentMode(this.host.state.subagents)).pipe(
      Match.when("disabled", () => []),
      Match.orElse(() => [SUBAGENT_ORCHESTRATOR_PROMPT]),
    )
  }

  /** Tools contributed by delegation; empty when sub-agents are disabled. */
  tools(): ToolSet {
    return Match.value(normalizeSubagentMode(this.host.state.subagents)).pipe(
      Match.when("disabled", (): ToolSet => ({})),
      Match.orElse((): ToolSet => ({ delegate_to_subagent: this.buildTool() })),
    )
  }

  beginTurn(): void {
    this.capturedEvents.clear()
    this.nextSequenceByRun.clear()
    this.terminalFrameByRun.clear()
    this.completedAtByRun.clear()
    this.eventRelay.reset()
  }

  handleBroadcast(message: string | ArrayBuffer | ArrayBufferView): void {
    Option.match(Option.fromNullishOr(parseAgentToolEventMessage(message)), {
      onNone: () => undefined,
      onSome: (eventMessage) => {
        this.recordEvent(eventMessage, Date.now())
        this.relayBroadcastFrame(eventMessage)
      },
    })
  }

  async onStart(run: AgentToolRunInfo): Promise<void> {
    const preview = readAgentToolInputPreview(run.inputPreview)
    const startedFrame = startedAgentToolEventMessage(run)
    this.recordLifecycleEvent(startedFrame, run.startedAt)
    await this.eventRelay
      .persistLifecycle(startedFrame, run.startedAt)
      .catch((cause) =>
        this.logRelayFailure(
          "Sub-agent started lifecycle persistence failed; awaiting broadcast fallback",
          cause,
          startedFrame,
        ),
      )
    this.host
      .createInternalRequestObserver("subagent_start", "isolate-subagent-lifecycle")
      .log.info("Isolate sub-agent started", {
        sessionId: this.host.getRuntimeId(),
        runId: run.runId,
        parentToolCallId: run.parentToolCallId ?? "",
        agentType: run.agentType,
        model: preview.model ?? "",
        displayOrder: run.displayOrder,
      })
  }

  async onFinish(run: AgentToolRunInfo, result: AgentToolLifecycleResult): Promise<void> {
    // Re-record the started frame so runs that began before this parent
    // instance existed (recovery) still carry SDK-authoritative timestamps.
    this.recordLifecycleEvent(startedAgentToolEventMessage(run), run.startedAt)
    const completedAtMs = this.completedAtForRun(run)
    await this.relayReconciledTerminal(run, result, completedAtMs)
    const summary = Option.fromNullishOr(
      this.summarizeCapturedRuns().find((candidate) => candidate.runId === run.runId),
    )
    const observer = this.host.createInternalRequestObserver(
      "subagent_finish",
      "isolate-subagent-lifecycle",
    )
    const model = Option.getOrElse(
      Option.flatMap(summary, (resolved) => Option.fromNullishOr(resolved.model)),
      () => "",
    )
    const toolCallCount = Option.match(summary, {
      onNone: () => 0,
      onSome: (resolved) => resolved.toolCallCount,
    })
    const toolNames = Option.match(summary, {
      onNone: () => [] as string[],
      onSome: (resolved) => resolved.toolNames,
    })
    const fields = {
      sessionId: this.host.getRuntimeId(),
      runId: run.runId,
      parentToolCallId: run.parentToolCallId ?? "",
      agentType: run.agentType,
      model,
      status: result.status,
      durationMs: Math.max(0, completedAtMs - run.startedAt),
      toolCallCount,
      toolNames,
    }
    Match.value(result.status).pipe(
      Match.when("completed", () => observer.log.info("Isolate sub-agent finished", fields)),
      Match.orElse(() => observer.log.warn("Isolate sub-agent did not complete", fields)),
    )
  }

  async finishTurn(messageId: string): Promise<{ subagentRuns?: SubagentRunSummary[] }> {
    await this.eventRelay.flush()
    const runs = this.summarizeCapturedRuns()
    completeHostSubagentTurn(this.host, messageId)
    return Match.value(runs.length).pipe(
      Match.when(0, () => ({})),
      Match.orElse(() => ({ subagentRuns: runs })),
    )
  }

  async cancelActive(reason: string): Promise<void> {
    const runIds = new Set([
      ...this.activeRunIds,
      ...(this.host.state.subagentDispatch?.runIds ?? []),
    ])
    await Promise.all([...runIds].map((runId) => this.host.cancelAgentTool(runId, reason)))
  }

  async clear(): Promise<void> {
    const retainedChildren = this.host.listSubAgents(IsolateSubAgent)
    await this.cancelActive("Parent Isolate session was deleted")
    await this.host.clearSubagentTrustedConfigs()
    await this.host.clearAgentToolRuns()
    await Promise.all(
      retainedChildren.map(({ name }) => this.host.deleteSubAgent(IsolateSubAgent, name)),
    )
    this.activeRunIds.clear()
    this.capturedEvents.clear()
    this.nextSequenceByRun.clear()
  }

  private buildTool(): DelegateToSubagentTool {
    return tool({
      description:
        "Delegate one self-contained task to an awaited Isolate sub-agent. Use multiple calls for independent work; each worker can use this session's configured tools, MCP servers, skills, and shared repository workspace.",
      inputSchema: delegateToSubagentInputSchema,
      execute: (delegation, options) =>
        this.runDelegation(delegation, options.toolCallId, options.abortSignal),
    })
  }

  private async runDelegation(
    delegation: IsolateSubagentDelegation,
    toolCallId: string,
    signal?: AbortSignal,
  ) {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.host.activeTurn),
      () => new Error("Sub-agent delegation is only available during an active Isolate turn"),
    )
    const runId = `${turn.messageId}:${toolCallId}`
    return Option.match(claimHostSubagentRun(this.host, turn.messageId, runId), {
      onNone: (): Promise<AgentToolFailure> =>
        Promise.resolve({
          ok: false,
          status: "error",
          error: "This response reached the limit of eight delegated sub-agent runs.",
          retryable: false,
        }),
      onSome: (displayOrder) =>
        this.runClaimedDelegation(delegation, toolCallId, runId, displayOrder, signal),
    })
  }

  private async runClaimedDelegation(
    delegation: IsolateSubagentDelegation,
    toolCallId: string,
    runId: string,
    displayOrder: number,
    signal?: AbortSignal,
  ) {
    const turn = Option.getOrThrowWith(
      Option.fromNullishOr(this.host.activeTurn),
      () => new Error("Sub-agent delegation is only available during an active Isolate turn"),
    )
    const state = this.host.state
    const input: IsolateSubagentRunInput = {
      delegation,
      parentSessionId: this.host.getRuntimeId(),
      userId: state.userId,
      repoOwner: state.repoOwner,
      repoName: state.repoName,
      model: turn.requestedModel,
      reasoningEffort: turn.reasoningEffort,
      stepLimit: resolveIsolateSubagentToolStepLimit(state.isolateStepLimit, this.host.maxSteps),
      selectedTools: state.tools ?? [],
      customMcpServers: state.customMcpServers ?? {},
    }
    this.activeRunIds.add(runId)

    const runEffect = Effect.gen({ self: this }, function* () {
      const backgroundTracing = yield* BackgroundTracing
      return yield* backgroundTracing.withSpan(
        "isolate.subagent.run",
        {
          "session.id": this.host.getRuntimeId(),
          "message.id": turn.messageId,
          "subagent.run_id": runId,
          "subagent.order": displayOrder,
          "ai.model": turn.model.modelId,
          "ai.runtime_model": turn.model.runtimeModelId,
          "tool.count": input.selectedTools.length,
          "step.limit": input.stepLimit,
        },
        Effect.tryPromise({
          try: () =>
            this.host.runAgentTool<IsolateSubagentRunInput, string>(IsolateSubAgent, {
              input,
              runId,
              parentToolCallId: toolCallId,
              displayOrder,
              signal,
              inputPreview: {
                task: sanitizeSubagentTaskPreview(delegation.task),
                model: turn.model.runtimeModelId,
              },
              display: {
                name: "Sub-agent",
                model: turn.model.runtimeModelId,
              },
            }),
          catch: (cause) => cause,
        }),
      )
    }).pipe(Effect.provide(makeBackgroundTracingLayer({ tracing: workerTracing })))

    const result = await this.host
      .registerSubagentTrustedConfig(runId, trustedConfigFromRunInput(input))
      .then(() =>
        // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute is the Promise boundary for the awaited child span.
        Effect.runPromise(runEffect),
      )
      .then((resolved) =>
        cancelInterruptedSubagentStillRunning(runId, resolved, (id, reason) =>
          this.host.cancelAgentTool(id, reason),
        ),
      )
      .catch((cause) => this.rejectedRunResult(runId, cause))
      .finally(async () => {
        this.activeRunIds.delete(runId)
        await this.releaseTrustedConfig(runId)
      })
    return Match.value(result.status).pipe(
      Match.when("completed", () => resolveCompletedSubagentResult(result)),
      Match.orElse(() => toAgentToolFailure(result)),
    )
  }

  private rejectedRunResult(runId: string, cause: unknown): RunAgentToolResult<string> {
    this.host
      .createInternalRequestObserver("subagent_start", "isolate-subagent-lifecycle")
      .log.error(describeError(cause), {
        event: "Isolate sub-agent runtime rejected the delegated run",
        sessionId: this.host.getRuntimeId(),
        runId,
      })
    return {
      runId,
      agentType: "IsolateSubAgent",
      status: "error",
      error: "The sub-agent runtime could not start this delegated run.",
    }
  }

  private releaseTrustedConfig(runId: string): Promise<void> {
    return this.host.releaseSubagentTrustedConfig(runId).catch((cause) => {
      this.host
        .createInternalRequestObserver("subagent_cleanup", "isolate-subagent-lifecycle")
        .log.error(describeError(cause), {
          event: "Failed to release trusted Isolate sub-agent configuration",
          sessionId: this.host.getRuntimeId(),
          runId,
        })
    })
  }

  private relayBroadcastFrame(message: AgentToolEventMessage): void {
    Match.value(message.event.kind).pipe(
      Match.when("finished", () => this.relayBroadcastTerminal(message)),
      Match.when("error", () => this.relayBroadcastTerminal(message)),
      Match.when("aborted", () => this.relayBroadcastTerminal(message)),
      Match.when("interrupted", () => this.relayBroadcastTerminal(message)),
      Match.orElse(() => this.eventRelay.enqueue(message)),
    )
  }

  private relayBroadcastTerminal(message: AgentToolEventMessage): void {
    this.terminalFrameByRun.set(message.event.runId, message)
    this.host.waitUntilSubagentLifecycle(this.relayTerminalFromRegistry(message))
  }

  /**
   * A terminal broadcast frame is persisted only once the SDK run registry
   * confirms completion and supplies an authoritative completion timestamp.
   * When inspection fails or the registry has no timestamp yet, the frame is
   * left for the onFinish lifecycle hook to reconcile.
   */
  private async relayTerminalFromRegistry(message: AgentToolEventMessage): Promise<void> {
    const inspection = await this.host
      .inspectAgentToolRun(message.event.runId)
      .then(Option.fromNullishOr)
      .catch((cause) => this.failedTerminalInspection(cause, message))
    const hydratedMessage = Option.match(inspection, {
      onNone: () => message,
      onSome: (resolved) => hydrateCompletedAgentToolEventMessage(message, resolved.output),
    })
    this.terminalFrameByRun.set(message.event.runId, hydratedMessage)
    await Option.match(inspectedAgentToolCompletedAtMs(inspection), {
      onNone: () => Promise.resolve(),
      onSome: (completedAt) => this.persistConfirmedTerminal(hydratedMessage, completedAt),
    })
  }

  private persistConfirmedTerminal(
    message: AgentToolEventMessage,
    completedAt: number,
  ): Promise<void> {
    this.completedAtByRun.set(message.event.runId, completedAt)
    return this.persistAndRelayTerminal(message, completedAt)
  }

  private failedTerminalInspection(
    cause: unknown,
    message: AgentToolEventMessage,
  ): Option.Option<AgentToolRunInspection<unknown>> {
    this.logRelayFailure(
      "Sub-agent terminal registry inspection failed; awaiting lifecycle hook reconciliation",
      cause,
      message,
    )
    return Option.none()
  }

  private completedAtForRun(run: AgentToolRunInfo): number {
    const stableFallback = this.completedAtByRun.get(run.runId) ?? Date.now()
    const completedAt = resolveAgentToolCompletedAtMs(run, stableFallback)
    this.completedAtByRun.set(run.runId, completedAt)
    return completedAt
  }

  private async relayReconciledTerminal(
    run: AgentToolRunInfo,
    result: AgentToolLifecycleResult,
    completedAtMs: number,
  ): Promise<void> {
    const lifecycleMessage = terminalAgentToolEventMessage(
      run,
      result,
      this.nextSequenceByRun.get(run.runId) ?? 1,
    )
    const baseMessage = Option.getOrElse(
      Option.fromNullishOr(this.terminalFrameByRun.get(run.runId)),
      () => lifecycleMessage,
    )
    const lifecycleSummary = Match.value(lifecycleMessage.event).pipe(
      Match.when({ kind: "finished" }, (finished) => finished.summary),
      Match.orElse(() => undefined),
    )
    const lifecycleHydratedMessage = hydrateCompletedAgentToolEventMessage(
      baseMessage,
      lifecycleSummary,
    )
    const inspection = await this.host
      .inspectAgentToolRun(run.runId)
      .then(Option.fromNullishOr)
      .catch((cause) => this.failedTerminalInspection(cause, lifecycleHydratedMessage))
    const message = Option.match(inspection, {
      onNone: () => lifecycleHydratedMessage,
      onSome: (resolved) =>
        hydrateCompletedAgentToolEventMessage(lifecycleHydratedMessage, resolved.output),
    })
    this.terminalFrameByRun.set(run.runId, message)
    return this.persistAndRelayTerminal(message, completedAtMs)
  }

  private async persistAndRelayTerminal(
    message: AgentToolEventMessage,
    completedAt: number,
  ): Promise<void> {
    this.recordLifecycleEvent(message, completedAt)
    await this.eventRelay.flush()
    await this.eventRelay
      .persistLifecycle(message, completedAt)
      .catch((cause) =>
        this.logRelayFailure(
          "Sub-agent terminal lifecycle persistence failed; using relay fallback",
          cause,
          message,
        ),
      )
    this.eventRelay.enqueue(message)
    await this.eventRelay.flush()
  }

  private messageIdForRun(runId: string): Option.Option<string> {
    return resolveSubagentMessageId(
      runId,
      this.host.state.subagentDispatch,
      this.host.activeTurn?.messageId,
    )
  }

  private callbackForMessage(message: AgentToolEventMessage): Option.Option<StreamCallback> {
    return Option.all({
      messageId: resolveSubagentMessageId(
        message.event.runId,
        this.host.state.subagentDispatch,
        this.host.activeTurn?.messageId,
      ),
      turn: Option.fromNullishOr(this.host.activeTurn),
    }).pipe(
      Option.filter(({ messageId, turn }) => messageId === turn.messageId),
      Option.flatMap(({ turn }) => Option.fromNullishOr(turn.callback)),
    )
  }

  private logRelayFailure(event: string, cause: unknown, message: AgentToolEventMessage): void {
    this.host
      .createInternalRequestObserver("subagent_event_relay", "isolate-subagent-event-relay")
      .log.error(describeError(cause), {
        event,
        sessionId: this.host.getRuntimeId(),
        runId: message.event.runId,
        sequence: message.sequence,
        kind: message.event.kind,
      })
  }

  /** Record a broadcast frame at arrival time; the first frame per (run, sequence) wins. */
  private recordEvent(message: AgentToolEventMessage, timestampMs: number): void {
    this.trackSequence(message)
    const key = subagentEventKey(message)
    Option.match(
      Option.liftPredicate(key, (candidate) => !this.capturedEvents.has(candidate)),
      {
        onNone: () => undefined,
        onSome: (freshKey) => {
          this.capturedEvents.set(freshKey, this.projectForSummary(message, timestampMs))
        },
      },
    )
  }

  /** Lifecycle hooks carry SDK-authoritative timestamps; they overwrite arrival-time recordings. */
  private recordLifecycleEvent(message: AgentToolEventMessage, timestampMs: number): void {
    this.trackSequence(message)
    this.capturedEvents.set(subagentEventKey(message), this.projectForSummary(message, timestampMs))
  }

  private trackSequence(message: AgentToolEventMessage): void {
    this.nextSequenceByRun.set(
      message.event.runId,
      Math.max(this.nextSequenceByRun.get(message.event.runId) ?? 0, message.sequence + 1),
    )
  }

  private projectForSummary(
    message: AgentToolEventMessage,
    timestampMs: number,
  ): SubagentSessionEvent {
    return projectSubagentSessionEvent({
      message,
      messageId: Option.getOrElse(this.messageIdForRun(message.event.runId), () => ""),
      sandboxId: this.host.getRuntimeId(),
      timestamp: timestampMs / 1000,
    })
  }

  private summarizeCapturedRuns(): SubagentRunSummary[] {
    return summarizeSubagentRuns([...this.capturedEvents.values()])
  }
}

function nonEmptySubagentText(value: unknown): Option.Option<string> {
  return Option.liftPredicate(
    value,
    (candidate): candidate is string => typeof candidate === "string",
  ).pipe(
    Option.map((text) => text.trim()),
    Option.filter((text) => text.length > 0),
  )
}

function resolveCompletedSubagentResult(
  result: RunAgentToolResult<string>,
): string | AgentToolFailure {
  const text = Option.orElse(nonEmptySubagentText(result.output), () =>
    nonEmptySubagentText(result.summary),
  )
  return Option.match(text, {
    onSome: (resolved) => resolved,
    onNone: () => ({
      ok: false,
      status: "error",
      error: EMPTY_SUBAGENT_SUMMARY_ERROR,
      retryable: false,
    }),
  })
}

function subagentEventKey(message: AgentToolEventMessage): string {
  return `${message.event.runId}:${message.sequence}`
}
