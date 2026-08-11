/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-switch-statement, s0-lint/no-ternary -- This module is a strict validation/redaction boundary for untrusted model and SDK wire values; direct discriminant guards keep rejected shapes adjacent to the contract. */
import { jsonSchema, type Tool } from "ai"
import type {
  AgentToolEventMessage,
  AgentToolFailure,
  AgentToolProgressSnapshot,
  RunAgentToolResult,
} from "agents"
import { sanitizeSubagentTaskPreview } from "@solzero/shared"
import type { IsolateSubagentDelegation } from "../subagent"

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
  return {
    success: true,
    value: {
      task: input.task,
      ...(context.value === undefined ? {} : { context: context.value }),
      ...(expectedOutput.value === undefined ? {} : { expectedOutput: expectedOutput.value }),
    },
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
export function sanitizeParentToolCallArgs(toolName: string, args: unknown): unknown {
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
  if (typeof value !== "string") {
    return false
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return isOfficialUiMessageChunk(parsed)
  } catch {
    return false
  }
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string"
}

function isOfficialUiMessageChunk(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false
  }
  if (value.type.startsWith("data-")) {
    return Object.hasOwn(value, "data")
  }
  switch (value.type) {
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
      return hasString(value, "id")
    case "text-delta":
    case "reasoning-delta":
      return hasString(value, "id") && hasString(value, "delta")
    case "error":
      return hasString(value, "errorText")
    case "tool-input-start":
      return hasString(value, "toolCallId") && hasString(value, "toolName")
    case "tool-input-delta":
      return hasString(value, "toolCallId") && hasString(value, "inputTextDelta")
    case "tool-input-available":
      return (
        hasString(value, "toolCallId") &&
        hasString(value, "toolName") &&
        Object.hasOwn(value, "input")
      )
    case "tool-input-error":
      return (
        hasString(value, "toolCallId") &&
        hasString(value, "toolName") &&
        Object.hasOwn(value, "input") &&
        hasString(value, "errorText")
      )
    case "tool-approval-request":
      return hasString(value, "approvalId") && hasString(value, "toolCallId")
    case "tool-output-available":
      return hasString(value, "toolCallId") && Object.hasOwn(value, "output")
    case "tool-output-error":
      return hasString(value, "toolCallId") && hasString(value, "errorText")
    case "tool-output-denied":
      return hasString(value, "toolCallId")
    case "source-url":
      return hasString(value, "sourceId") && hasString(value, "url")
    case "source-document":
      return (
        hasString(value, "sourceId") && hasString(value, "mediaType") && hasString(value, "title")
      )
    case "file":
      return hasString(value, "url") && hasString(value, "mediaType")
    case "start-step":
    case "finish-step":
    case "start":
    case "finish":
    case "abort":
      return true
    case "message-metadata":
      return Object.hasOwn(value, "messageMetadata")
    default:
      return false
  }
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
  return {
    at: numberField(progress.at) ?? Date.now(),
    ...(fraction === undefined ? {} : { fraction }),
    ...(message === undefined ? {} : { message }),
    ...(phase === undefined ? {} : { phase }),
    ...(milestone === undefined ? {} : { milestone }),
  }
}

export function parseSubagentChunkActivity(body: string): SubagentChunkActivity | null {
  try {
    const chunk: unknown = JSON.parse(body)
    if (!isRecord(chunk) || typeof chunk.type !== "string") {
      return null
    }
    const toolType =
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-call"
    const progress = progressFromChunk(chunk)
    return {
      ...(toolType && typeof chunk.toolName === "string" ? { toolName: chunk.toolName } : {}),
      ...(toolType && typeof chunk.toolCallId === "string" ? { toolCallId: chunk.toolCallId } : {}),
      ...(progress === undefined ? {} : { progress }),
    }
  } catch {
    return null
  }
}

function isAgentToolEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.runId !== "string") {
    return false
  }
  switch (value.kind) {
    case "started":
      return typeof value.agentType === "string" && typeof value.order === "number"
    case "chunk":
      return isValidChunkBody(value.body)
    case "finished":
      return typeof value.summary === "string"
    case "error":
      return typeof value.error === "string"
    case "aborted":
      return value.reason === undefined || typeof value.reason === "string"
    case "interrupted":
      return (
        typeof value.error === "string" &&
        isInterruptedReason(value.reason) &&
        (value.childStillRunning === undefined || typeof value.childStillRunning === "boolean")
      )
    default:
      return false
  }
}

export function parseAgentToolEventMessage(
  message: string | ArrayBuffer | ArrayBufferView,
): AgentToolEventMessage | null {
  if (typeof message !== "string") {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(message)
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
    return parsed as AgentToolEventMessage
  } catch {
    return null
  }
}

export function toAgentToolFailure(result: RunAgentToolResult): AgentToolFailure {
  if (result.status === "completed") {
    throw new Error("Completed sub-agent results cannot be converted to failures")
  }
  return {
    ok: false,
    status: result.status,
    error: result.error ?? `Sub-agent run ended with status '${result.status}'`,
    retryable: result.status === "interrupted",
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.childStillRunning === undefined
      ? {}
      : { childStillRunning: result.childStillRunning }),
  }
}
