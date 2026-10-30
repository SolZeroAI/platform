import { jsonSchema, type Tool } from "ai"
import type {
  AgentToolEventMessage,
  AgentToolFailure,
  AgentToolProgressSnapshot,
  RunAgentToolResult,
} from "agents"
import { sanitizeSubagentTaskPreview } from "@solzero/shared"
import type { IsolateSubagentDelegation } from "../subagent"
import { parseJsonOrUndefined } from "../../../lib/json"

interface IsolateDelegationFields {
  task: string
  context?: string
  expectedOutput?: string
}

const TASK_INPUT_LIMIT = 16_000
const CONTEXT_INPUT_LIMIT = 32_000
const EXPECTED_OUTPUT_INPUT_LIMIT = 8_000

type ValidationResult<T> = { success: true; value: T } | { success: false; error: Error }

function optionalString(
  value: unknown,
  name: string,
  limit: number,
): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { success: true, value: undefined }
  }

  if (typeof value !== "string") {
    return { success: false, error: new Error(`${name} must be a string`) }
  }

  if (value.length > limit) {
    return { success: false, error: new Error(`${name} must not exceed ${limit} characters`) }
  }

  return { success: true, value }
}

function validateDelegation(value: unknown): ValidationResult<IsolateSubagentDelegation> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: new Error("delegation input must be an object") }
  }

  // SAFETY: validateDelegation only reads task, context, and expectedOutput after rejecting non-objects.
  const input = value as Record<string, unknown>

  if (typeof input.task !== "string" || input.task.trim().length === 0) {
    return { success: false, error: new Error("task is required") }
  }

  if (input.task.length > TASK_INPUT_LIMIT) {
    return {
      success: false,
      error: new Error(`task must not exceed ${TASK_INPUT_LIMIT} characters`),
    }
  }

  const context = optionalString(input.context, "context", CONTEXT_INPUT_LIMIT)

  if (!context.success) {
    return context
  }

  const expectedOutput = optionalString(
    input.expectedOutput,
    "expectedOutput",
    EXPECTED_OUTPUT_INPUT_LIMIT,
  )

  if (!expectedOutput.success) {
    return expectedOutput
  }

  const delegation: IsolateDelegationFields = { task: input.task }

  if (context.value !== undefined) delegation.context = context.value

  if (expectedOutput.value !== undefined) delegation.expectedOutput = expectedOutput.value

  return {
    success: true,
    value: delegation,
  }
}

export const delegateToSubagentInputSchema = jsonSchema<IsolateSubagentDelegation>(
  {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        minLength: 1,
        maxLength: TASK_INPUT_LIMIT,
        description: "A self-contained task for one delegated worker.",
      },
      context: {
        type: "string",
        maxLength: CONTEXT_INPUT_LIMIT,
        description: "Relevant non-secret context the worker needs to complete the task.",
      },
      expectedOutput: {
        type: "string",
        maxLength: EXPECTED_OUTPUT_INPUT_LIMIT,
        description: "The evidence, artifact, or answer format the worker should return.",
      },
    },
  },
  { validate: validateDelegation },
)

export type DelegateToSubagentTool = Tool<IsolateSubagentDelegation, string | AgentToolFailure>

export { sanitizeSubagentTaskPreview }

/** Preserve ordinary tool inputs, but persist only a redacted task preview for delegation. */
export function sanitizeParentToolCallArgs(toolName: string, args: unknown) {
  if (toolName !== "delegate_to_subagent") {
    return args
  }

  const task = isRecord(args) && typeof args.task === "string" ? args.task : ""

  return { task: sanitizeSubagentTaskPreview(task) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isValidChunkBody(value: unknown): value is string {
  return typeof value === "string" && isOfficialUiMessageChunk(parseJsonOrUndefined(value))
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string"
}

type ChunkRecord = Record<string, unknown>

function hasCheck<Checks extends object>(
  checks: Checks,
  key: string,
): key is Extract<keyof Checks, string> {
  return Object.hasOwn(checks, key)
}

const hasId = (chunk: ChunkRecord) => hasString(chunk, "id")
const hasIdAndDelta = (chunk: ChunkRecord) => hasString(chunk, "id") && hasString(chunk, "delta")
const always = () => true

// Required fields for each official AI SDK UI message chunk type.
const uiMessageChunkChecks = {
  "text-start": hasId,
  "text-end": hasId,
  "reasoning-start": hasId,
  "reasoning-end": hasId,
  "text-delta": hasIdAndDelta,
  "reasoning-delta": hasIdAndDelta,
  error: (chunk) => hasString(chunk, "errorText"),
  "tool-input-start": (chunk) => hasString(chunk, "toolCallId") && hasString(chunk, "toolName"),
  "tool-input-delta": (chunk) =>
    hasString(chunk, "toolCallId") && hasString(chunk, "inputTextDelta"),
  "tool-input-available": (chunk) =>
    hasString(chunk, "toolCallId") && hasString(chunk, "toolName") && Object.hasOwn(chunk, "input"),
  "tool-input-error": (chunk) =>
    hasString(chunk, "toolCallId") &&
    hasString(chunk, "toolName") &&
    Object.hasOwn(chunk, "input") &&
    hasString(chunk, "errorText"),
  "tool-approval-request": (chunk) =>
    hasString(chunk, "approvalId") && hasString(chunk, "toolCallId"),
  "tool-output-available": (chunk) =>
    hasString(chunk, "toolCallId") && Object.hasOwn(chunk, "output"),
  "tool-output-error": (chunk) => hasString(chunk, "toolCallId") && hasString(chunk, "errorText"),
  "tool-output-denied": (chunk) => hasString(chunk, "toolCallId"),
  "source-url": (chunk) => hasString(chunk, "sourceId") && hasString(chunk, "url"),
  "source-document": (chunk) =>
    hasString(chunk, "sourceId") && hasString(chunk, "mediaType") && hasString(chunk, "title"),
  file: (chunk) => hasString(chunk, "url") && hasString(chunk, "mediaType"),
  "start-step": always,
  "finish-step": always,
  start: always,
  finish: always,
  abort: always,
  "message-metadata": (chunk) => Object.hasOwn(chunk, "messageMetadata"),
} satisfies Record<string, (chunk: ChunkRecord) => boolean>

function isOfficialUiMessageChunk(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false
  }

  if (value.type.startsWith("data-")) {
    return Object.hasOwn(value, "data")
  }

  return hasCheck(uiMessageChunkChecks, value.type) && uiMessageChunkChecks[value.type](value)
}

const INTERRUPTED_REASONS = new Set([
  "no-progress",
  "window-exceeded",
  "not-tailable",
  "inspect-timeout",
  "inspect-failed",
  "recovery-deadline",
  "budget-exceeded",
])

function isInterruptedReason(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && INTERRUPTED_REASONS.has(value))
}

export interface SubagentChunkActivity {
  toolName?: string
  toolCallId?: string
  progress?: AgentToolProgressSnapshot
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function progressFromChunk(chunk: Record<string, unknown>): AgentToolProgressSnapshot | undefined {
  if (chunk.type !== "data-agent-progress" || !isRecord(chunk.data)) {
    return undefined
  }

  const progress = chunk.data
  const fraction = numberField(progress.fraction)
  const message = stringField(progress.message)
  const phase = stringField(progress.phase)
  const milestone = stringField(progress.milestone)

  const snapshot: AgentToolProgressSnapshot = { at: numberField(progress.at) ?? Date.now() }

  if (fraction !== undefined) snapshot.fraction = fraction

  if (message !== undefined) snapshot.message = message

  if (phase !== undefined) snapshot.phase = phase

  if (milestone !== undefined) snapshot.milestone = milestone

  return snapshot
}

export function parseSubagentChunkActivity(body: string): SubagentChunkActivity | null {
  const chunk = parseJsonOrUndefined(body)

  if (!isRecord(chunk) || typeof chunk.type !== "string") {
    return null
  }

  const toolType =
    chunk.type === "tool-input-start" ||
    chunk.type === "tool-input-available" ||
    chunk.type === "tool-call"

  const progress = progressFromChunk(chunk)

  const activity: SubagentChunkActivity = {}

  if (toolType && typeof chunk.toolName === "string") activity.toolName = chunk.toolName

  if (toolType && typeof chunk.toolCallId === "string") activity.toolCallId = chunk.toolCallId

  if (progress !== undefined) activity.progress = progress

  return activity
}

// Required fields for each agent tool event kind.
const agentToolEventChecks = {
  started: (event) => typeof event.agentType === "string" && typeof event.order === "number",
  chunk: (event) => isValidChunkBody(event.body),
  finished: (event) => typeof event.summary === "string",
  error: (event) => typeof event.error === "string",
  aborted: (event) => event.reason === undefined || typeof event.reason === "string",
  interrupted: (event) =>
    typeof event.error === "string" &&
    isInterruptedReason(event.reason) &&
    (event.childStillRunning === undefined || typeof event.childStillRunning === "boolean"),
} satisfies Record<string, (event: ChunkRecord) => boolean>

function isAgentToolEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.runId !== "string") {
    return false
  }

  return hasCheck(agentToolEventChecks, value.kind) && agentToolEventChecks[value.kind](value)
}

export function parseAgentToolEventMessage(
  message: string | ArrayBuffer | ArrayBufferView,
): AgentToolEventMessage | null {
  if (typeof message !== "string") {
    return null
  }

  const parsed = parseJsonOrUndefined(message)

  if (
    !isRecord(parsed) ||
    parsed.type !== "agent-tool-event" ||
    !Number.isSafeInteger(parsed.sequence) ||
    Number(parsed.sequence) < 0 ||
    (parsed.parentToolCallId !== undefined && typeof parsed.parentToolCallId !== "string") ||
    (parsed.replay !== undefined && parsed.replay !== true) ||
    !isAgentToolEvent(parsed.event)
  ) {
    return null
  }

  // SAFETY: The checks above established the agent-tool-event fields required by AgentToolEventMessage.
  return parsed as AgentToolEventMessage
}

export function toAgentToolFailure(result: RunAgentToolResult): AgentToolFailure {
  if (result.status === "completed") {
    throw new Error("Completed sub-agent results cannot be converted to failures")
  }

  const failure: AgentToolFailure = {
    ok: false,
    status: result.status,
    error: result.error ?? `Sub-agent run ended with status '${result.status}'`,
    retryable: result.status === "interrupted",
  }

  if (result.reason !== undefined) failure.reason = result.reason

  if (result.childStillRunning !== undefined) failure.childStillRunning = result.childStillRunning

  return failure
}
