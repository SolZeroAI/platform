/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- This is a redaction boundary from full child replay events to compact workflow disclosures; explicit guards make every allowed field visible. */
import {
  sanitizeSubagentCompactError,
  sanitizeSubagentCompactLabel,
  sanitizeSubagentCompactProgress,
  sanitizeSubagentTaskPreview,
  summarizeSubagentRuns,
  type SandboxEvent,
  type SubagentProgress,
  type SubagentRunSummary,
  type SubagentSessionEvent,
  type WorkflowCallbackContext,
} from "@solzero/shared"
import { decodeJsonRecord, parseJson } from "../../lib/json"
import { createWorkflowStoreFromD1, type WorkflowStorePromise } from "../db/workflows"
import { parseSubagentChunkActivity } from "../isolate/agent/delegation"
import type { Env } from "../types"
import type { SessionRepository } from "./repository"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

interface WorkflowMirrorDescriptor {
  eventType: string
  level: "info" | "warn" | "error"
  message: string
  data: Record<string, unknown>
}

function someDescriptor(value: WorkflowMirrorDescriptor): Option.Option<WorkflowMirrorDescriptor> {
  return Option.some(value)
}

function readWorkflowContext(value: string | null): Option.Option<WorkflowCallbackContext> {
  return Option.flatMap(decodeJsonRecord(value), (record) =>
    Option.liftPredicate(
      record,
      (candidate): candidate is Record<string, unknown> & WorkflowCallbackContext =>
        candidate.type === "workflow" &&
        typeof candidate.workflowId === "string" &&
        typeof candidate.runId === "string" &&
        typeof candidate.nodeId === "string",
    ),
  )
}

function compactRun(
  repository: SessionRepository,
  event: SubagentSessionEvent,
): Option.Option<SubagentRunSummary> {
  const events = repository.events
    .listEventsForMessage(event.messageId)
    .map((row) => parseJson(row.data))
    .filter(
      (value): value is SandboxEvent =>
        value !== null && typeof value === "object" && "type" in value,
    )
  return Option.fromNullishOr(
    summarizeSubagentRuns(events).find((run) => run.runId === event.runId),
  )
}

function terminalData(
  repository: SessionRepository,
  event: SubagentSessionEvent,
): Record<string, unknown> {
  return compactRun(repository, event).pipe(
    Option.match({
      onNone: () => ({}),
      onSome: (run) => ({
        status: run.status,
        task: run.task,
        model: run.model,
        durationMs: run.durationMs,
        toolCallCount: run.toolCallCount,
        toolNames: run.toolNames,
        summary: run.summary,
        error: run.error,
        progress: run.progress,
        milestones: run.milestones,
        reason: run.reason,
        childStillRunning: run.childStillRunning,
      }),
    }),
  )
}

function compactProgress(progress: SubagentProgress): SubagentProgress {
  return {
    ...progress,
    ...(progress.message ? { message: sanitizeSubagentCompactProgress(progress.message) } : {}),
    ...(progress.phase ? { phase: sanitizeSubagentCompactLabel(progress.phase) } : {}),
    ...(progress.milestone ? { milestone: sanitizeSubagentCompactLabel(progress.milestone) } : {}),
  }
}

function describeChunk(body: string): Option.Option<WorkflowMirrorDescriptor> {
  const activity = parseSubagentChunkActivity(body)
  if (!activity || (!activity.toolName && !activity.progress)) {
    return Option.none()
  }
  const progress = activity.progress && compactProgress(activity.progress)
  return someDescriptor(
    progress
      ? {
          eventType: "subagent_progress",
          level: "info",
          message: progress.message ?? "Sub-agent progress updated",
          data: { status: "running", progress },
        }
      : {
          eventType: "subagent_activity",
          level: "info",
          message: `Sub-agent called ${activity.toolName}`,
          data: {
            status: "running",
            toolName: activity.toolName,
            toolCallId: activity.toolCallId,
          },
        },
  )
}

function describeEvent(
  repository: SessionRepository,
  event: SubagentSessionEvent,
): Option.Option<WorkflowMirrorDescriptor> {
  return Match.value(event).pipe(
    Match.when({ kind: "started" }, (started) =>
      someDescriptor({
        eventType: "subagent_started",
        level: "info" as const,
        message: "Sub-agent started",
        data: {
          status: "running",
          task: started.task && sanitizeSubagentTaskPreview(started.task),
          model: started.model,
          agentType: started.agentType,
          displayName: started.displayName,
          order: started.order,
        },
      }),
    ),
    Match.when({ kind: "chunk" }, (chunk) => describeChunk(chunk.body)),
    Match.when({ kind: "finished" }, (finished) =>
      someDescriptor({
        eventType: "subagent_completed",
        level: "info" as const,
        message: "Sub-agent completed",
        data: terminalData(repository, finished),
      }),
    ),
    Match.when({ kind: "error" }, (failed) =>
      someDescriptor({
        eventType: "subagent_failed",
        level: "error" as const,
        message: "Sub-agent failed",
        data: {
          ...terminalData(repository, failed),
          error: sanitizeSubagentCompactError(failed.error),
        },
      }),
    ),
    Match.when({ kind: "aborted" }, (aborted) =>
      someDescriptor({
        eventType: "subagent_aborted",
        level: "warn" as const,
        message: "Sub-agent was aborted",
        data: {
          ...terminalData(repository, aborted),
          error: aborted.reason && sanitizeSubagentCompactError(aborted.reason),
        },
      }),
    ),
    Match.when({ kind: "interrupted" }, (interrupted) =>
      someDescriptor({
        eventType: "subagent_interrupted",
        level: "warn" as const,
        message: "Sub-agent was interrupted",
        data: {
          ...terminalData(repository, interrupted),
          error: sanitizeSubagentCompactError(interrupted.error),
          reason: interrupted.reason,
          childStillRunning: interrupted.childStillRunning,
        },
      }),
    ),
    Match.exhaustive,
  )
}

async function authorizedWorkflowContext(input: {
  repository: SessionRepository
  workflowStore: WorkflowStorePromise
  messageId: string
}): Promise<Option.Option<WorkflowCallbackContext>> {
  const candidate = input.repository.getMessageById(input.messageId).pipe(
    Option.flatMap((message) =>
      Option.all({
        context: readWorkflowContext(message.callback_context),
        participant: input.repository.getParticipantById(message.author_id),
      }),
    ),
  )
  return await Option.match(candidate, {
    onNone: () => Promise.resolve(Option.none<WorkflowCallbackContext>()),
    onSome: ({ context, participant }) =>
      authorizeStoredWorkflowRun(input.workflowStore, context, participant.user_id),
  })
}

async function authorizeStoredWorkflowRun(
  workflowStore: WorkflowStorePromise,
  context: WorkflowCallbackContext,
  participantUserId: string,
): Promise<Option.Option<WorkflowCallbackContext>> {
  const run = Option.fromNullishOr(await workflowStore.getRun(context.workflowId, context.runId))
  return Option.match(run, {
    onNone: () => Option.none<WorkflowCallbackContext>(),
    onSome: (storedRun) =>
      storedRun.user_id === participantUserId ? Option.some(context) : Option.none(),
  })
}

/** Mirror only compact, redacted child lifecycle into the workflow event stream. */
export async function mirrorSubagentWorkflowEvent(input: {
  env: Env
  repository: SessionRepository
  sessionId: string
  event: SubagentSessionEvent
}): Promise<void> {
  const workflowStore = createWorkflowStoreFromD1(input.env.DB)
  const workflow = await authorizedWorkflowContext({
    repository: input.repository,
    workflowStore,
    messageId: input.event.messageId,
  })
  const descriptor = describeEvent(input.repository, input.event)
  await Option.all({ workflow, descriptor }).pipe(
    Option.match({
      onNone: () => Promise.resolve(),
      onSome: ({ workflow: context, descriptor: lifecycle }) =>
        workflowStore.addRunEvent({
          id: `wfe_sa_${context.runId}_${context.nodeId}_${input.event.runId}_${input.event.sequence}`,
          workflowId: context.workflowId,
          runId: context.runId,
          nodeId: context.nodeId,
          eventType: lifecycle.eventType,
          level: lifecycle.level,
          message: lifecycle.message,
          data: {
            ...lifecycle.data,
            sessionId: input.sessionId,
            childRunId: input.event.runId,
            parentToolCallId: input.event.parentToolCallId,
            sequence: input.event.sequence,
            kind: input.event.kind,
          },
          createdAt: Math.round(input.event.timestamp * 1000),
        }),
    }),
  )
}
