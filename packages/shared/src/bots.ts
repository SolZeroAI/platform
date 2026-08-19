import { parseJson, parseJsonRecord } from "./json"

export const BOT_STATUSES = ["active", "paused"] as const
export type BotStatus = (typeof BOT_STATUSES)[number]

export const BOT_ROUTINE_KINDS = ["standing", "temporary"] as const
export type BotRoutineKind = (typeof BOT_ROUTINE_KINDS)[number]

export const BOT_ROUTINE_CADENCE_KINDS = ["cron", "interval"] as const
export type BotRoutineCadenceKind = (typeof BOT_ROUTINE_CADENCE_KINDS)[number]

export const BOT_ROUTINE_WATCH_KINDS = ["none", "github_pull_request"] as const
export type BotRoutineWatchKind = (typeof BOT_ROUTINE_WATCH_KINDS)[number]

export const BOT_ROUTINE_WATCH_COMPLETE_WHEN = ["merged_or_closed", "checks_concluded"] as const
export type BotRoutineWatchCompleteWhen = (typeof BOT_ROUTINE_WATCH_COMPLETE_WHEN)[number]

export const BOT_ROUTINE_STATUSES = ["active"] as const
export type BotRoutineStatus = (typeof BOT_ROUTINE_STATUSES)[number]

export const BOT_ROUTINE_ALARM_PREFIX = "routine:"
export const BOT_ROUTINE_ALARM_NODE_ID = "tick"
export const MIN_BOT_ROUTINE_INTERVAL_SECONDS = 60
export const MAX_BOT_ROUTINE_INTERVAL_SECONDS = 7 * 24 * 60 * 60

export interface BotRoutineCadence {
  kind: BotRoutineCadenceKind
  cron?: string
  intervalSeconds?: number
}

export interface BotRoutineWatch {
  kind: BotRoutineWatchKind
  owner?: string
  repo?: string
  pullNumber?: number
  completeWhen?: BotRoutineWatchCompleteWhen
}

export interface BotSummary {
  id: string
  userId: string
  name: string
  instructions: string
  sessionId: string | null
  status: BotStatus
  createdAt: number
  updatedAt: number
}

export interface BotRoutineSummary {
  id: string
  botId: string
  userId: string
  name: string
  kind: BotRoutineKind
  cadence: BotRoutineCadence
  prompt: string
  until: number | null
  watch: BotRoutineWatch
  status: BotRoutineStatus
  lastRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateBotInput {
  name: string
  instructions?: string
}

export interface CreateBotRoutineInput {
  name: string
  kind: BotRoutineKind
  cadence: BotRoutineCadence
  prompt: string
  until?: string | number | null
  watch?: BotRoutineWatch | null
}

export class BotRoutineValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = "BotRoutineValidationError"
    this.field = field
  }
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    throw new BotRoutineValidationError(field, `${field} is required`)
  }
  return trimmed
}

function isCronExpression(value: string): boolean {
  return value.trim().split(/\s+/).length === 5
}

export function parseUntilTimestamp(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BotRoutineValidationError("until", "until must be a future unix timestamp")
    }
    return Math.trunc(value)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new BotRoutineValidationError("until", "until must be an ISO-8601 timestamp")
  }
  return parsed
}

export function normalizeBotRoutineWatch(
  watch: BotRoutineWatch | null | undefined,
): BotRoutineWatch {
  if (!watch || watch.kind === "none") {
    return { kind: "none" }
  }
  if (watch.kind !== "github_pull_request") {
    throw new BotRoutineValidationError(
      "watch.kind",
      "watch.kind must be none or github_pull_request",
    )
  }
  const owner = requireNonEmpty(watch.owner, "watch.owner")
  const repo = requireNonEmpty(watch.repo, "watch.repo")
  const pullNumber = watch.pullNumber
  if (!Number.isInteger(pullNumber) || (pullNumber ?? 0) <= 0) {
    throw new BotRoutineValidationError(
      "watch.pullNumber",
      "watch.pullNumber must be a positive integer",
    )
  }
  const completeWhen = watch.completeWhen ?? "checks_concluded"
  if (!BOT_ROUTINE_WATCH_COMPLETE_WHEN.includes(completeWhen)) {
    throw new BotRoutineValidationError(
      "watch.completeWhen",
      "watch.completeWhen must be merged_or_closed or checks_concluded",
    )
  }
  return {
    kind: "github_pull_request",
    owner,
    repo,
    pullNumber,
    completeWhen,
  }
}

export function normalizeBotRoutineCadence(cadence: BotRoutineCadence): BotRoutineCadence {
  if (cadence.kind === "cron") {
    const cron = requireNonEmpty(cadence.cron, "cadence.cron")
    if (!isCronExpression(cron)) {
      throw new BotRoutineValidationError(
        "cadence.cron",
        "cadence.cron must be a five-field UTC cron",
      )
    }
    return { kind: "cron", cron }
  }
  if (cadence.kind !== "interval") {
    throw new BotRoutineValidationError("cadence.kind", "cadence.kind must be cron or interval")
  }
  const intervalSeconds = cadence.intervalSeconds
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds === undefined ||
    intervalSeconds < MIN_BOT_ROUTINE_INTERVAL_SECONDS ||
    intervalSeconds > MAX_BOT_ROUTINE_INTERVAL_SECONDS
  ) {
    throw new BotRoutineValidationError(
      "cadence.intervalSeconds",
      `cadence.intervalSeconds must be an integer from ${MIN_BOT_ROUTINE_INTERVAL_SECONDS} to ${MAX_BOT_ROUTINE_INTERVAL_SECONDS}`,
    )
  }
  return { kind: "interval", intervalSeconds }
}

export function normalizeCreateBotInput(input: CreateBotInput): {
  name: string
  instructions: string
} {
  return {
    name: requireNonEmpty(input.name, "name"),
    instructions: input.instructions?.trim() ?? "",
  }
}

export function normalizeCreateBotRoutineInput(input: CreateBotRoutineInput): {
  name: string
  kind: BotRoutineKind
  cadence: BotRoutineCadence
  prompt: string
  until: number | null
  watch: BotRoutineWatch
} {
  if (!BOT_ROUTINE_KINDS.includes(input.kind)) {
    throw new BotRoutineValidationError("kind", "kind must be standing or temporary")
  }
  const until = parseUntilTimestamp(input.until)
  const watch = normalizeBotRoutineWatch(input.watch)
  if (until !== null && until <= Date.now()) {
    throw new BotRoutineValidationError("until", "until must be in the future")
  }
  if (input.kind === "standing" && until !== null) {
    throw new BotRoutineValidationError("until", "standing routines cannot set until")
  }
  if (input.kind === "temporary" && until === null && watch.kind === "none") {
    throw new BotRoutineValidationError(
      "until",
      "temporary routines need an until deadline or a finite watch",
    )
  }
  return {
    name: requireNonEmpty(input.name, "name"),
    kind: input.kind,
    cadence: normalizeBotRoutineCadence(input.cadence),
    prompt: requireNonEmpty(input.prompt, "prompt"),
    until,
    watch,
  }
}

export function isTemporaryRoutineExpired(input: {
  kind: BotRoutineKind
  until: number | null
  now: number
}): boolean {
  return input.kind === "temporary" && input.until !== null && input.now >= input.until
}

export function nextRoutineRunAt(input: {
  cadence: BotRoutineCadence
  now: number
  nextCronDate: (expression: string, after: Date) => Date
}): string {
  if (input.cadence.kind === "cron") {
    return input.nextCronDate(input.cadence.cron ?? "", new Date(input.now)).toISOString()
  }
  return new Date(
    input.now + (input.cadence.intervalSeconds ?? MIN_BOT_ROUTINE_INTERVAL_SECONDS) * 1000,
  ).toISOString()
}

export function routineAlarmWorkflowId(routineId: string): string {
  return `${BOT_ROUTINE_ALARM_PREFIX}${routineId}`
}

export function parseRoutineAlarmWorkflowId(workflowId: string): string | null {
  if (!workflowId.startsWith(BOT_ROUTINE_ALARM_PREFIX)) {
    return null
  }
  const routineId = workflowId.slice(BOT_ROUTINE_ALARM_PREFIX.length)
  return routineId.length > 0 ? routineId : null
}

export function parseStoredBotRoutineWatch(value: string | null | undefined): BotRoutineWatch {
  const parsed = parseJsonRecord(value)
  return normalizeBotRoutineWatch({
    kind: typeof parsed.kind === "string" ? (parsed.kind as BotRoutineWatchKind) : "none",
    owner: typeof parsed.owner === "string" ? parsed.owner : undefined,
    repo: typeof parsed.repo === "string" ? parsed.repo : undefined,
    pullNumber: typeof parsed.pullNumber === "number" ? parsed.pullNumber : undefined,
    completeWhen:
      typeof parsed.completeWhen === "string"
        ? (parsed.completeWhen as BotRoutineWatchCompleteWhen)
        : undefined,
  })
}

export function parseStoredBotRoutineCadence(value: string): BotRoutineCadence {
  const parsed = parseJson(value) as Record<string, unknown>
  return normalizeBotRoutineCadence({
    kind: parsed.kind === "cron" ? "cron" : "interval",
    cron: typeof parsed.cron === "string" ? parsed.cron : undefined,
    intervalSeconds:
      typeof parsed.intervalSeconds === "number" ? parsed.intervalSeconds : undefined,
  })
}

export function describeBotRoutineWatch(watch: BotRoutineWatch): string {
  if (watch.kind !== "github_pull_request") {
    return "none"
  }
  return `github_pull_request ${watch.owner}/${watch.repo}#${watch.pullNumber} completeWhen=${watch.completeWhen}`
}

export function buildRoutineTickPrompt(
  routine: Pick<BotRoutineSummary, "id" | "name" | "kind" | "prompt" | "until" | "watch">,
): string {
  const untilLine =
    routine.until === null ? "Deadline: none" : `Deadline: ${new Date(routine.until).toISOString()}`
  return [
    `Routine "${routine.name}" fired.`,
    `Routine id: ${routine.id}`,
    `Kind: ${routine.kind}`,
    `Watch: ${describeBotRoutineWatch(routine.watch)}`,
    untilLine,
    "",
    routine.prompt,
    "",
    "Check the watched work now. Act on pass or fail. When the work is done, call complete_bot_routine so this temporary routine is deleted. Standing routines stay until you delete them. A temporary routine is also deleted when its deadline passes.",
  ].join("\n")
}

export function evaluateRoutineTick(input: {
  kind: BotRoutineKind
  until: number | null
  status: BotRoutineStatus
  cadence: BotRoutineCadence
  now: number
  nextCronDate: (expression: string, after: Date) => Date
}): { action: "expire" } | { action: "stop" } | { action: "run"; nextRunAt: string } {
  if (input.status !== "active") {
    return { action: "stop" }
  }
  if (isTemporaryRoutineExpired(input)) {
    return { action: "expire" }
  }
  return {
    action: "run",
    nextRunAt: nextRoutineRunAt({
      cadence: input.cadence,
      now: input.now,
      nextCronDate: input.nextCronDate,
    }),
  }
}
