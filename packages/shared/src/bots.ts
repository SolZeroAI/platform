import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const BOT_STATUSES = ["active", "paused"] as const

export type BotStatus = (typeof BOT_STATUSES)[number]

const BOT_ROUTINE_KINDS = ["standing", "temporary"] as const

export type BotRoutineKind = (typeof BOT_ROUTINE_KINDS)[number]

const BOT_ROUTINE_CADENCE_KINDS = ["cron", "interval"] as const

export type BotRoutineCadenceKind = (typeof BOT_ROUTINE_CADENCE_KINDS)[number]

const BOT_ROUTINE_WATCH_KINDS = ["none", "github_pull_request"] as const

export type BotRoutineWatchKind = (typeof BOT_ROUTINE_WATCH_KINDS)[number]

const BOT_ROUTINE_WATCH_COMPLETE_WHEN = ["merged_or_closed", "checks_concluded"] as const

export type BotRoutineWatchCompleteWhen = (typeof BOT_ROUTINE_WATCH_COMPLETE_WHEN)[number]

const BOT_ROUTINE_STATUSES = ["active"] as const

type BotRoutineStatus = (typeof BOT_ROUTINE_STATUSES)[number]

export const BotStatusSchema = Schema.Literals(BOT_STATUSES)

export const BotRoutineKindSchema = Schema.Literals(BOT_ROUTINE_KINDS)
const isBotRoutineKind = Schema.is(BotRoutineKindSchema)

const BotRoutineCadenceKindSchema = Schema.Literals(BOT_ROUTINE_CADENCE_KINDS)
const isBotRoutineCadenceKind = Schema.is(BotRoutineCadenceKindSchema)

const BotRoutineWatchCompleteWhenSchema = Schema.Literals(BOT_ROUTINE_WATCH_COMPLETE_WHEN)
const isBotRoutineWatchCompleteWhen = Schema.is(BotRoutineWatchCompleteWhenSchema)

const UntilTimestampSchema = Schema.Union([Schema.Number, Schema.String])

const StoredBotRoutineWatchSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  owner: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  pullNumber: Schema.optional(Schema.Number),
  completeWhen: Schema.optional(Schema.String),
})

const StoredBotRoutineCadenceSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  cron: Schema.optional(Schema.String),
  intervalSeconds: Schema.optional(Schema.Number),
})

const decodeStoredBotRoutineWatch = Schema.decodeUnknownOption(
  Schema.fromJsonString(StoredBotRoutineWatchSchema),
)

const decodeStoredBotRoutineCadence = Schema.decodeUnknownOption(
  Schema.fromJsonString(StoredBotRoutineCadenceSchema),
)

type StoredBotRoutineWatch = typeof StoredBotRoutineWatchSchema.Type

type StoredBotRoutineCadence = typeof StoredBotRoutineCadenceSchema.Type

const BOT_ROUTINE_ALARM_PREFIX = "routine:"
export const BOT_ROUTINE_ALARM_NODE_ID = "tick"
const MIN_BOT_ROUTINE_INTERVAL_SECONDS = 60
const MAX_BOT_ROUTINE_INTERVAL_SECONDS = 7 * 24 * 60 * 60

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

interface NormalizedCreateBotInput {
  readonly name: string
  readonly instructions: string
}

interface NormalizedCreateBotRoutineInput {
  readonly name: string
  readonly kind: BotRoutineKind
  readonly cadence: BotRoutineCadence
  readonly prompt: string
  readonly until: number | null
  readonly watch: BotRoutineWatch
}

export class BotRoutineValidationError extends Schema.TaggedError<BotRoutineValidationError>()(
  "BotRoutineValidationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

const invalid = (field: string, message: string) =>
  new BotRoutineValidationError({ field, message })

const ensure = (valid: boolean, field: string, message: string) =>
  Result.liftPredicate(
    valid,
    (passed) => passed,
    () => invalid(field, message),
  )

function requireNonEmpty(value: string | undefined, field: string) {
  return Result.liftPredicate(
    value?.trim() ?? "",
    (trimmed) => trimmed.length > 0,
    () => invalid(field, `${field} is required`),
  )
}

function isCronExpression(value: string): boolean {
  return value.trim().split(/\s+/).length === 5
}

const requirePositiveUnixTimestamp = (value: number) =>
  Result.liftPredicate(
    value,
    (until) => Number.isFinite(until) && until > 0,
    () => invalid("until", "until must be a future unix timestamp"),
  ).pipe(Result.map(Math.trunc))

const requireIsoTimestamp = (value: string) =>
  Result.liftPredicate(Date.parse(value), Number.isFinite, () =>
    invalid("until", "until must be an ISO-8601 timestamp"),
  )

const parseDecodedUntil = (until: string | number) =>
  Match.value(until).pipe(
    Match.when(Match.number, requirePositiveUnixTimestamp),
    Match.orElse(requireIsoTimestamp),
    Result.map(Option.some),
  )

const parsePresentUntil = (until: string | number) =>
  Option.match(Schema.decodeUnknownOption(UntilTimestampSchema)(until), {
    onNone: () => Result.fail(invalid("until", "until must be a future unix timestamp")),
    onSome: parseDecodedUntil,
  })

/** A blank or missing `until` is no deadline. */
function parseUntilTimestamp(value: string | number | null | undefined) {
  return Option.match(
    Option.filter(Option.fromNullishOr(value), (until) => until !== ""),
    {
      onNone: () => Result.succeedNone,
      onSome: parsePresentUntil,
    },
  )
}

const normalizePullRequestWatch = (watch: StoredBotRoutineWatch) =>
  Result.gen(function* () {
    yield* ensure(
      watch.kind === "github_pull_request",
      "watch.kind",
      "watch.kind must be none or github_pull_request",
    )

    const owner = yield* requireNonEmpty(watch.owner, "watch.owner")
    const repo = yield* requireNonEmpty(watch.repo, "watch.repo")

    const pullNumber = yield* Result.liftPredicate(
      watch.pullNumber,
      (candidate): candidate is number => Number.isInteger(candidate) && (candidate ?? 0) > 0,
      () => invalid("watch.pullNumber", "watch.pullNumber must be a positive integer"),
    )

    const completeWhen = yield* Result.liftPredicate(
      watch.completeWhen ?? "checks_concluded",
      isBotRoutineWatchCompleteWhen,
      () =>
        invalid(
          "watch.completeWhen",
          "watch.completeWhen must be merged_or_closed or checks_concluded",
        ),
    )

    return {
      kind: "github_pull_request",
      owner,
      repo,
      pullNumber,
      completeWhen,
    } satisfies BotRoutineWatch
  })

function normalizeBotRoutineWatch(
  watch: StoredBotRoutineWatch | null | undefined,
): Result.Result<BotRoutineWatch, BotRoutineValidationError> {
  return Option.match(
    Option.filter(Option.fromNullishOr(watch), (stored) => (stored.kind ?? "none") !== "none"),
    {
      onNone: () => Result.succeed({ kind: "none" }),
      onSome: normalizePullRequestWatch,
    },
  )
}

const normalizeCronCadence = (cadence: StoredBotRoutineCadence) =>
  requireNonEmpty(cadence.cron, "cadence.cron").pipe(
    Result.filterOrFail(isCronExpression, () =>
      invalid("cadence.cron", "cadence.cron must be a five-field UTC cron"),
    ),
    Result.map((cron): BotRoutineCadence => ({ kind: "cron", cron })),
  )

const normalizeIntervalCadence = (cadence: StoredBotRoutineCadence) =>
  Result.gen(function* () {
    yield* ensure(
      isBotRoutineCadenceKind(cadence.kind) && cadence.kind === "interval",
      "cadence.kind",
      "cadence.kind must be cron or interval",
    )

    const intervalSeconds = yield* Result.liftPredicate(
      cadence.intervalSeconds,
      (candidate): candidate is number =>
        Number.isInteger(candidate) &&
        candidate !== undefined &&
        candidate >= MIN_BOT_ROUTINE_INTERVAL_SECONDS &&
        candidate <= MAX_BOT_ROUTINE_INTERVAL_SECONDS,
      () =>
        invalid(
          "cadence.intervalSeconds",
          `cadence.intervalSeconds must be an integer from ${MIN_BOT_ROUTINE_INTERVAL_SECONDS} to ${MAX_BOT_ROUTINE_INTERVAL_SECONDS}`,
        ),
    )

    return { kind: "interval", intervalSeconds } satisfies BotRoutineCadence
  })

function normalizeBotRoutineCadence(
  cadence: StoredBotRoutineCadence,
): Result.Result<BotRoutineCadence, BotRoutineValidationError> {
  return Match.value(cadence.kind).pipe(
    Match.when("cron", () => normalizeCronCadence(cadence)),
    Match.orElse(() => normalizeIntervalCadence(cadence)),
  )
}

export function normalizeCreateBotInput(input: CreateBotInput): NormalizedCreateBotInput {
  return {
    name: Result.getOrThrow(requireNonEmpty(input.name, "name")),
    instructions: input.instructions?.trim() ?? "",
  }
}

const validateCreateBotRoutineInput = (input: CreateBotRoutineInput) =>
  Result.gen(function* () {
    const kind = yield* Result.liftPredicate(input.kind, isBotRoutineKind, () =>
      invalid("kind", "kind must be standing or temporary"),
    )

    const until = Option.getOrNull(yield* parseUntilTimestamp(input.until))
    const watch = yield* normalizeBotRoutineWatch(input.watch)

    yield* ensure(until === null || until > Date.now(), "until", "until must be in the future")

    yield* ensure(
      kind !== "standing" || until === null,
      "until",
      "standing routines cannot set until",
    )

    yield* ensure(
      kind !== "temporary" || until !== null || watch.kind !== "none",
      "until",
      "temporary routines need an until deadline or a finite watch",
    )

    return {
      name: yield* requireNonEmpty(input.name, "name"),
      kind,
      cadence: yield* normalizeBotRoutineCadence(input.cadence),
      prompt: yield* requireNonEmpty(input.prompt, "prompt"),
      until,
      watch,
    }
  })

export function normalizeCreateBotRoutineInput(
  input: CreateBotRoutineInput,
): NormalizedCreateBotRoutineInput {
  return Result.getOrThrow(validateCreateBotRoutineInput(input))
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
  return Match.value(input.cadence.kind).pipe(
    Match.when("cron", () =>
      input.nextCronDate(input.cadence.cron ?? "", new Date(input.now)).toISOString(),
    ),
    Match.orElse(() =>
      new Date(
        input.now + (input.cadence.intervalSeconds ?? MIN_BOT_ROUTINE_INTERVAL_SECONDS) * 1000,
      ).toISOString(),
    ),
  )
}

export function routineAlarmWorkflowId(routineId: string): string {
  return `${BOT_ROUTINE_ALARM_PREFIX}${routineId}`
}

/** The routine id in a routine alarm workflow id, or none for other workflow ids. */
export function parseRoutineAlarmWorkflowId(workflowId: string): Option.Option<string> {
  return Option.liftPredicate(workflowId, (id) => id.startsWith(BOT_ROUTINE_ALARM_PREFIX)).pipe(
    Option.map((id) => id.slice(BOT_ROUTINE_ALARM_PREFIX.length)),
    Option.filter((routineId) => routineId.length > 0),
  )
}

export function parseStoredBotRoutineWatch(value: string | null | undefined): BotRoutineWatch {
  return Option.match(decodeStoredBotRoutineWatch(value ?? '{"kind":"none"}'), {
    onNone: () => ({ kind: "none" }),
    onSome: (parsed) => Result.getOrThrow(normalizeBotRoutineWatch(parsed)),
  })
}

export function parseStoredBotRoutineCadence(value: string): BotRoutineCadence {
  return Option.match(decodeStoredBotRoutineCadence(value), {
    onNone: () => Result.fail(invalid("cadence", "cadence must be a JSON object")),
    onSome: (parsed) => normalizeBotRoutineCadence({ ...parsed, kind: parsed.kind ?? "interval" }),
  }).pipe(Result.getOrThrow)
}

function describeBotRoutineWatch(watch: BotRoutineWatch): string {
  return Match.value(watch.kind).pipe(
    Match.when(
      "github_pull_request",
      () =>
        `github_pull_request ${watch.owner}/${watch.repo}#${watch.pullNumber} completeWhen=${watch.completeWhen}`,
    ),
    Match.orElse(() => "none"),
  )
}

export function buildRoutineTickPrompt(
  routine: Pick<BotRoutineSummary, "id" | "name" | "kind" | "prompt" | "until" | "watch">,
): string {
  const deadline = Option.match(Option.fromNullishOr(routine.until), {
    onNone: () => "none",
    onSome: (until) => new Date(until).toISOString(),
  })

  return [
    `Routine "${routine.name}" fired.`,
    `Routine id: ${routine.id}`,
    `Kind: ${routine.kind}`,
    `Watch: ${describeBotRoutineWatch(routine.watch)}`,
    `Deadline: ${deadline}`,
    "",
    routine.prompt,
    "",
    "Check the watched work now. Act on pass or fail. When the work is done, call complete_bot_routine so this temporary routine is deleted. Standing routines stay until you delete them. A temporary routine is also deleted when its deadline passes.",
  ].join("\n")
}

type RoutineTickDecision =
  | { action: "expire" }
  | { action: "stop" }
  | { action: "run"; nextRunAt: string }

export function evaluateRoutineTick(input: {
  kind: BotRoutineKind
  until: number | null
  status: BotRoutineStatus
  cadence: BotRoutineCadence
  now: number
  nextCronDate: (expression: string, after: Date) => Date
}): RoutineTickDecision {
  return Match.value(input).pipe(
    Match.withReturnType<RoutineTickDecision>(),
    Match.when({ status: (status) => status !== "active" }, () => ({ action: "stop" })),
    Match.when(isTemporaryRoutineExpired, () => ({ action: "expire" })),
    Match.orElse(() => ({ action: "run", nextRunAt: nextRoutineRunAt(input) })),
  )
}
