import { isOktaReconnectMcpDiscoveryError } from "@solzero/shared"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { SandboxEvent, ServerMessage } from "../types"
import { generateId } from "../auth/crypto"
import { parseJsonOrText, stringifyJson } from "../../lib/json"
import type { SessionRepository } from "./repository"
import type { EventRow, MessageRow, SessionRow } from "./types"

export const OKTA_RECONNECT_RESUME_REASON = "okta_reconnect"
export type ResumeReason = typeof OKTA_RECONNECT_RESUME_REASON

const MAX_EVENT_TEXT_LENGTH = 8_000
const MAX_TOOL_RESULT_LENGTH = 6_000

export interface ResumeStartedEvent {
  type: "resume_started"
  messageId: string
  resumedFromMessageId: string
  reason: ResumeReason
  summary: string
  sandboxId: string
  timestamp: number
}

export interface ResumeTarget {
  message: MessageRow
  terminalEvent: Extract<SandboxEvent, { type: "mcp_discovery_error" }>
  events: SandboxEvent[]
}

interface ResumePromptRequestInput {
  request: Request
  repository: SessionRepository
  getSession(): SessionRow | null
  getSessionId(): string
  broadcast(message: ServerMessage): void
  runQueue(): void
}

export function isResumeReason(value: unknown): value is ResumeReason {
  return value === OKTA_RECONNECT_RESUME_REASON
}

export function isResumeStartedEvent(value: unknown): value is ResumeStartedEvent {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "resume_started" &&
    typeof (value as { messageId?: unknown }).messageId === "string" &&
    typeof (value as { resumedFromMessageId?: unknown }).resumedFromMessageId === "string" &&
    (value as { reason?: unknown }).reason === OKTA_RECONNECT_RESUME_REASON
  )
}

export function parseSandboxEventRow(
  row: EventRow,
): Option.Option<SandboxEvent | ResumeStartedEvent> {
  return Option.liftPredicate(
    parseJsonOrText(row.data),
    (value): value is SandboxEvent | ResumeStartedEvent =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  )
}

function sessionRejectionForSession(session: SessionRow): Option.Option<string> {
  return Match.value(session).pipe(
    Match.when({ status: "archived" }, () =>
      Option.some("Session is archived. Unarchive it to continue."),
    ),
    Match.when(
      (resolved) => resolved.session_kind !== "isolate",
      () => Option.some("Resume after Okta reconnect is only supported for isolate sessions."),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

export function getResumeSessionRejection(session: SessionRow | null): Option.Option<string> {
  return Option.match(Option.fromNullishOr(session), {
    onNone: () => Option.some("Session not found"),
    onSome: (resolved) => sessionRejectionForSession(resolved),
  })
}

export function findTerminalOktaReconnectDiscoveryEvent(
  events: readonly SandboxEvent[],
): Option.Option<Extract<SandboxEvent, { type: "mcp_discovery_error" }>> {
  const discoveryEvents = events.filter(
    (event): event is Extract<SandboxEvent, { type: "mcp_discovery_error" }> =>
      event.type === "mcp_discovery_error",
  )

  return Option.fromNullishOr(
    discoveryEvents
      .reverse()
      .find((event) => event.terminal === true && isOktaReconnectMcpDiscoveryError(event)),
  )
}

export function getResumableOktaReconnectTarget(
  message: MessageRow,
  events: readonly SandboxEvent[],
): Option.Option<ResumeTarget> {
  return Match.value(message.status === "failed").pipe(
    Match.when(false, () => Option.none<ResumeTarget>()),
    Match.orElse(() =>
      Option.map(findTerminalOktaReconnectDiscoveryEvent(events), (terminalEvent) => ({
        message,
        terminalEvent,
        events: [...events],
      })),
    ),
  )
}

function truncateText(value: string, maxLength: number): string {
  return Match.value(value.length <= maxLength).pipe(
    Match.when(true, () => value),
    Match.orElse(
      () => `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} characters]`,
    ),
  )
}

function stringifyToolArgs(value: unknown): string {
  // oxlint-disable-next-line effect/avoid-direct-json -- 2-space pretty rendering of already-decoded sandbox tool args for the LLM resume prompt; values come from parsed events (cycle-free) and compact Schema JSON would degrade prompt legibility.
  return JSON.stringify(value, null, 2)
}

function latestAssistantText(events: readonly SandboxEvent[]): Option.Option<string> {
  const latestToken = events
    .filter((event): event is Extract<SandboxEvent, { type: "token" }> => event.type === "token")
    .sort((left, right) => left.timestamp - right.timestamp)
    .at(-1)
  return Option.fromNullishOr(latestToken?.content?.trim()).pipe(Option.filter(Boolean))
}

function resolvedToolResultLines(result: Extract<SandboxEvent, { type: "tool_result" }>): string[] {
  return Match.value(Boolean(result.error)).pipe(
    Match.when(true, () => [
      "status: failed",
      `error:\n${truncateText(result.error ?? "", MAX_TOOL_RESULT_LENGTH)}`,
    ]),
    Match.orElse(() => [
      "status: completed",
      `result:\n${truncateText(result.result, MAX_TOOL_RESULT_LENGTH)}`,
    ]),
  )
}

function toolResultStatusLines(
  result: Extract<SandboxEvent, { type: "tool_result" }> | undefined,
): string[] {
  return Match.value(result).pipe(
    Match.when(Match.undefined, () => ["status: incomplete, no durable tool result was recorded"]),
    Match.orElse((resolved) => resolvedToolResultLines(resolved)),
  )
}

function formatToolCall(
  call: Extract<SandboxEvent, { type: "tool_call" }>,
  index: number,
  toolResults: Map<string, Extract<SandboxEvent, { type: "tool_result" }>>,
): string {
  const args = stringifyToolArgs(call.args)
  const header = [
    `Tool call ${index + 1}: ${call.tool}`,
    `callId: ${call.callId}`,
    `args:\n${truncateText(args, MAX_EVENT_TEXT_LENGTH)}`,
  ]
  return [...header, ...toolResultStatusLines(toolResults.get(call.callId))].join("\n")
}

function formatToolEvidence(events: readonly SandboxEvent[]): string {
  const toolCalls = events.filter(
    (event): event is Extract<SandboxEvent, { type: "tool_call" }> => event.type === "tool_call",
  )
  const toolResults = new Map(
    events
      .filter(
        (event): event is Extract<SandboxEvent, { type: "tool_result" }> =>
          event.type === "tool_result",
      )
      .map((event) => [event.callId, event]),
  )

  return Match.value(toolCalls.length === 0).pipe(
    Match.when(true, () => "No durable tool calls were recorded before the failure."),
    Match.orElse(() =>
      toolCalls.map((call, index) => formatToolCall(call, index, toolResults)).join("\n\n"),
    ),
  )
}

export function buildOktaReconnectResumePrompt(target: ResumeTarget): string {
  const assistantTextLine = Option.match(latestAssistantText(target.events), {
    onNone: () => "No assistant text was emitted before the failure.",
    onSome: (text) => truncateText(text, MAX_EVENT_TEXT_LENGTH),
  })
  const toolEvidence = formatToolEvidence(target.events)

  return [
    "You are resuming a previous isolate response after the user reauthenticated with Okta.",
    "Continue the original request from the durable checkpoint below.",
    "Use completed tool results as existing evidence. Do not repeat completed tool calls unless their result is insufficient or stale.",
    "If a tool call is marked incomplete, you may call tools again now that Okta auth has been refreshed.",
    "Do not mention internal resume mechanics unless they affect the answer.",
    "",
    "Original user request:",
    "```text",
    target.message.content,
    "```",
    "",
    "Terminal auth error from the previous attempt:",
    "```text",
    target.terminalEvent.error,
    "```",
    "",
    "Assistant text emitted before the failure:",
    "```text",
    assistantTextLine,
    "```",
    "",
    "Durable tool evidence from the previous attempt:",
    "```text",
    toolEvidence,
    "```",
    "",
    "Now continue the response to the user.",
  ].join("\n")
}

function getSandboxEventsForMessage(
  repository: SessionRepository,
  messageId: string,
): SandboxEvent[] {
  return Arr.getSomes(
    repository.events.listEventsForMessage(messageId).map(parseSandboxEventRow),
  ) as SandboxEvent[]
}

function firstResumableFailedTarget(repository: SessionRepository): Option.Option<ResumeTarget> {
  return Arr.head(
    Arr.getSomes(
      repository
        .listMessagesByStatus("failed", 50)
        .map((message) =>
          getResumableOktaReconnectTarget(
            message,
            getSandboxEventsForMessage(repository, message.id),
          ),
        ),
    ),
  )
}

function getResumableMessageTarget(
  repository: SessionRepository,
  messageId?: string | null,
): Option.Option<ResumeTarget> {
  return Option.match(Option.fromNullishOr(messageId), {
    onNone: () => firstResumableFailedTarget(repository),
    onSome: (id) =>
      Option.flatMap(repository.getMessageById(id), (message) =>
        getResumableOktaReconnectTarget(
          message,
          getSandboxEventsForMessage(repository, message.id),
        ),
      ),
  })
}

function findExistingResumeForMessage(
  repository: SessionRepository,
  resumedFromMessageId: string,
): Option.Option<{ messageId: string; status: string }> {
  const candidates = Arr.getSomes(
    repository.events.listEventsByType("resume_started", 100).map(parseSandboxEventRow),
  ).filter(
    (event): event is ResumeStartedEvent =>
      isResumeStartedEvent(event) && event.resumedFromMessageId === resumedFromMessageId,
  )
  const message = Arr.head(
    Arr.getSomes(
      candidates.map((event) =>
        repository
          .getMessageById(event.messageId)
          .pipe(Option.filter((candidate) => candidate.status !== "failed")),
      ),
    ),
  )
  return Option.map(message, (resolved) => ({ messageId: resolved.id, status: resolved.status }))
}

function rejectionStatus(rejection: string): number {
  return Match.value(rejection === "Session not found").pipe(
    Match.when(true, () => 404),
    Match.orElse(() => 409),
  )
}

function startResume(input: ResumePromptRequestInput, target: ResumeTarget): Response {
  const now = Date.now()
  const messageId = generateId()
  const content = buildOktaReconnectResumePrompt(target)
  input.repository.createMessage({
    id: messageId,
    authorId: target.message.author_id,
    content,
    source: target.message.source,
    model: target.message.model,
    reasoningEffort: target.message.reasoning_effort,
    executionMode: target.message.execution_mode,
    attachments: target.message.attachments,
    callbackContext: target.message.callback_context,
    status: "pending",
    createdAt: now,
  })

  const resumeEvent: SandboxEvent = {
    type: "resume_started",
    messageId,
    resumedFromMessageId: target.message.id,
    reason: OKTA_RECONNECT_RESUME_REASON,
    summary: "Resuming after Okta authentication",
    sandboxId: Option.getOrNull(input.repository.getSandbox())?.sandbox_id ?? input.getSessionId(),
    timestamp: now / 1000,
  }
  input.repository.events.createEvent({
    id: generateId(),
    type: "resume_started",
    data: stringifyJson(resumeEvent),
    messageId,
    createdAt: now,
  })
  input.broadcast({ type: "sandbox_event", event: resumeEvent })
  input.broadcast({
    type: "prompt_queued",
    messageId,
    position: input.repository.getPendingOrProcessingCount(),
  })

  input.runQueue()

  return Response.json({
    messageId,
    resumedFromMessageId: target.message.id,
    status: "queued",
    alreadyResuming: false,
  })
}

function startResumeOrReject(input: ResumePromptRequestInput, target: ResumeTarget): Response {
  return Match.value(input.repository.getPendingOrProcessingCount() > 0).pipe(
    Match.when(true, () =>
      Response.json(
        { error: "Cannot resume while another prompt is pending or processing." },
        { status: 409 },
      ),
    ),
    Match.orElse(() => startResume(input, target)),
  )
}

function resolveExistingOrStartResume(
  input: ResumePromptRequestInput,
  target: ResumeTarget,
): Response {
  return Option.match(findExistingResumeForMessage(input.repository, target.message.id), {
    onSome: (existing) =>
      Response.json({
        messageId: existing.messageId,
        resumedFromMessageId: target.message.id,
        status: existing.status,
        alreadyResuming: true,
      }),
    onNone: () => startResumeOrReject(input, target),
  })
}

function resolveResumableTargetResponse(
  input: ResumePromptRequestInput,
  messageId?: string,
): Response {
  return Option.match(getResumableMessageTarget(input.repository, messageId), {
    onNone: () =>
      Response.json(
        { error: "Okta reconnected, but no resumable failed request was found." },
        { status: 409 },
      ),
    onSome: (target) => resolveExistingOrStartResume(input, target),
  })
}

function resolveResumeResponse(input: ResumePromptRequestInput, messageId?: string): Response {
  return Option.match(getResumeSessionRejection(input.getSession()), {
    onSome: (rejection) =>
      Response.json({ error: rejection }, { status: rejectionStatus(rejection) }),
    onNone: () => resolveResumableTargetResponse(input, messageId),
  })
}

export async function handleResumePromptRequest(
  input: ResumePromptRequestInput,
): Promise<Response> {
  const body = (await input.request.json()) as {
    messageId?: string
    reason?: unknown
  }
  return Match.value(isResumeReason(body.reason)).pipe(
    Match.when(false, () => Response.json({ error: "Unsupported resume reason" }, { status: 400 })),
    Match.orElse(() => resolveResumeResponse(input, body.messageId)),
  )
}
