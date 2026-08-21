import {
  BOT_ROUTINE_ALARM_NODE_ID,
  buildRoutineTickPrompt,
  evaluateRoutineTick,
  parseRoutineAlarmWorkflowId,
  routineAlarmWorkflowId,
  type BotRoutineSummary,
  type WorkflowNodeOptions,
} from "@solzero/shared"
import { createWorkflowStoreFromD1, type WorkflowRecord } from "../db/workflows"
import { BotStore } from "../db/bots"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import { stringifyJson } from "../../lib/json"
import { resolveOktaUserId } from "../../lib/better-auth"
import { toError } from "../../lib/effect-errors"
import type { Env } from "../types"
import { startWorkflowRun, type WorkflowTriggerPayload } from "./runner"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const StoredScheduleSchema = Schema.Struct({
  workflowId: Schema.String,
  nodeId: Schema.String,
  kind: Schema.optional(Schema.Literals(["datetime", "cron"])),
  scheduledAt: Schema.String,
  userId: Schema.String,
  cron: Schema.optional(Schema.NullOr(Schema.String)),
  target: Schema.optional(Schema.Literals(["workflow", "routine"])),
})
type StoredScheduleInput = typeof StoredScheduleSchema.Type

interface StoredSchedule {
  workflowId: string
  nodeId: string
  kind: "datetime" | "cron"
  scheduledAt: string
  userId: string
  cron?: string | null
  target?: "workflow" | "routine"
}

function storedScheduleFromDecoded(decoded: StoredScheduleInput): StoredSchedule {
  return {
    workflowId: decoded.workflowId,
    nodeId: decoded.nodeId,
    kind: Match.value(decoded.kind).pipe(
      Match.when("cron", () => "cron" as const),
      Match.orElse(() => "datetime" as const),
    ),
    scheduledAt: decoded.scheduledAt,
    userId: decoded.userId,
    cron: decoded.cron,
    target: Match.value(decoded.target).pipe(
      Match.when("routine", () => "routine" as const),
      Match.orElse(() => "workflow" as const),
    ),
  }
}

interface WorkflowAlarmStorage {
  delete(key: string): Promise<unknown>
  deleteAlarm(): Promise<unknown>
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<unknown>
  setAlarm(scheduledTime: number): Promise<unknown>
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function parseCronNumber(value: string, min: number, max: number, allowSevenAsSunday = false) {
  const parsed = Number(value)
  return Match.value(parsed).pipe(
    Match.when(
      (candidate) => !Number.isInteger(candidate),
      () => {
        throw new Error(`Cron value '${value}' must be an integer`)
      },
    ),
    Match.when(
      (candidate) => allowSevenAsSunday && candidate === 7,
      () => 0,
    ),
    Match.when(
      (candidate) => candidate < min || candidate > max,
      () => {
        throw new Error(`Cron value '${value}' must be between ${min} and ${max}`)
      },
    ),
    Match.orElse((candidate) => candidate),
  )
}

function addCronRange(
  start: number,
  end: number,
  step: number,
  values: Set<number>,
  label: string,
): void {
  Match.value(end < start).pipe(
    Match.when(true, () => {
      throw new Error(`Cron range '${label}' must be ascending`)
    }),
    Match.orElse(() => undefined),
  )
  const count = Math.floor((end - start) / step) + 1
  Arr.forEach(
    Arr.makeBy(count, (index) => start + index * step),
    (value) => {
      values.add(value)
    },
  )
}

function addCronPart(
  part: string,
  min: number,
  max: number,
  options: { allowSevenAsSunday?: boolean },
  values: Set<number>,
): void {
  const trimmed = part.trim()
  Match.value(trimmed.length === 0).pipe(
    Match.when(true, () => {
      throw new Error("Cron field contains an empty segment")
    }),
    Match.orElse(() => undefined),
  )
  const [rangePart, stepPart] = trimmed.split("/")
  const step = Match.value(stepPart).pipe(
    Match.when(Match.undefined, () => 1),
    Match.orElse((resolved) => parseCronNumber(resolved, 1, max)),
  )
  Match.value(rangePart).pipe(
    Match.when("*", () => addCronRange(min, max, step, values, trimmed)),
    Match.when(
      (candidate): candidate is string => typeof candidate === "string" && candidate.includes("-"),
      (candidate) => {
        const [startValue, endValue] = candidate.split("-")
        addCronRange(
          parseCronNumber(startValue ?? "", min, max, options.allowSevenAsSunday),
          parseCronNumber(endValue ?? "", min, max, options.allowSevenAsSunday),
          step,
          values,
          trimmed,
        )
      },
    ),
    Match.orElse(() => {
      values.add(parseCronNumber(rangePart ?? "", min, max, options.allowSevenAsSunday))
    }),
  )
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  options: { allowSevenAsSunday?: boolean } = {},
): Set<number> {
  const values = new Set<number>()
  Arr.forEach(field.split(","), (part) => addCronPart(part, min, max, options, values))
  Match.value(values.size === 0).pipe(
    Match.when(true, () => {
      throw new Error("Cron field did not produce any values")
    }),
    Match.orElse(() => undefined),
  )
  return values
}

function parseCronExpression(expression: string) {
  const parts = expression.trim().split(/\s+/)
  Match.value(parts.length !== 5).pipe(
    Match.when(true, () => {
      throw new Error("Cron expression must contain five fields")
    }),
    Match.orElse(() => undefined),
  )

  return {
    minutes: parseCronField(parts[0] ?? "", 0, 59),
    hours: parseCronField(parts[1] ?? "", 0, 23),
    days: parseCronField(parts[2] ?? "", 1, 31),
    months: parseCronField(parts[3] ?? "", 1, 12),
    weekdays: parseCronField(parts[4] ?? "", 0, 7, { allowSevenAsSunday: true }),
  }
}

type ParsedCron = ReturnType<typeof parseCronExpression>

function cronMatches(cron: ParsedCron, candidate: Date): boolean {
  return (
    cron.minutes.has(candidate.getUTCMinutes()) &&
    cron.hours.has(candidate.getUTCHours()) &&
    cron.days.has(candidate.getUTCDate()) &&
    cron.months.has(candidate.getUTCMonth() + 1) &&
    cron.weekdays.has(candidate.getUTCDay())
  )
}

export function nextCronDate(expression: string, after: Date): Date {
  const cron = parseCronExpression(expression)
  const candidate = new Date(after)
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)

  const maxAttempts = 366 * 24 * 60 * 5
  let found = Option.none<Date>()
  // oxlint-disable-next-line effect/imperative-loops -- Bounded minute-by-minute scan over up to ~2.6M candidates that returns at the first match. Recursion would overflow the stack on the worst case, and materializing the full candidate array would be a memory regression, so the imperative scan is retained.
  for (let attempt = 0; attempt < maxAttempts && Option.isNone(found); attempt += 1) {
    found = Match.value(cronMatches(cron, candidate)).pipe(
      Match.when(true, () => Option.some(new Date(candidate))),
      Match.orElse(() => Option.none<Date>()),
    )
    Match.value(Option.isNone(found)).pipe(
      Match.when(true, () => {
        candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
      }),
      Match.orElse(() => undefined),
    )
  }

  return Option.match(found, {
    onNone: () => {
      throw new Error("Cron expression did not produce a run time within five years")
    },
    onSome: (resolved) => resolved,
  })
}

const scheduleValidAlarm = Effect.fn("workflows.scheduleValidAlarm")(function* (input: {
  storage: WorkflowAlarmStorage
  body: StoredScheduleInput
}) {
  const timestamp = Date.parse(input.body.scheduledAt)
  return yield* Match.value(Number.isFinite(timestamp)).pipe(
    Match.when(false, () =>
      Effect.succeed(json({ error: "scheduledAt must be a valid date" }, 400)),
    ),
    Match.orElse(() =>
      persistAlarmSchedule({ storage: input.storage, body: input.body, timestamp }),
    ),
  )
})

const persistAlarmSchedule = Effect.fn("workflows.persistAlarmSchedule")(function* (input: {
  storage: WorkflowAlarmStorage
  body: StoredScheduleInput
  timestamp: number
}) {
  const schedule = storedScheduleFromDecoded({
    workflowId: input.body.workflowId,
    nodeId: input.body.nodeId,
    kind: input.body.kind,
    scheduledAt: new Date(input.timestamp).toISOString(),
    userId: input.body.userId,
    cron: Match.value(input.body.cron).pipe(
      Match.when(Match.string, (value) => value),
      Match.orElse(() => null),
    ),
    target: input.body.target,
  })
  yield* Effect.tryPromise({
    try: () => input.storage.put("schedule", schedule),
    catch: toError,
  })
  yield* Effect.tryPromise({
    try: () => input.storage.setAlarm(input.timestamp),
    catch: toError,
  })
  return json({ status: "scheduled", schedule })
})

const scheduleAlarmRequest = Effect.fn("workflows.scheduleAlarmRequest")(function* (input: {
  request: Request
  storage: WorkflowAlarmStorage
}) {
  const body = yield* Effect.tryPromise({
    try: () => input.request.json(),
    catch: toError,
  })
  return yield* Option.match(Schema.decodeUnknownOption(StoredScheduleSchema)(body), {
    onNone: () =>
      Effect.succeed(
        json({ error: "workflowId, nodeId, userId, and scheduledAt are required" }, 400),
      ),
    onSome: (decoded) =>
      scheduleValidAlarm({
        storage: input.storage,
        body: decoded,
      }),
  })
})

const cancelAlarmRequest = Effect.fn("workflows.cancelAlarmRequest")(function* (input: {
  storage: WorkflowAlarmStorage
}) {
  yield* Effect.tryPromise({
    try: () => input.storage.delete("schedule"),
    catch: toError,
  })
  yield* Effect.tryPromise({
    try: () => input.storage.deleteAlarm(),
    catch: toError,
  })
  return json({ status: "cancelled" })
})

const handleWorkflowAlarmFetchEffect = Effect.fn("workflows.handleAlarmFetch")(function* (input: {
  request: Request
  storage: WorkflowAlarmStorage
}) {
  const url = new URL(input.request.url)
  const route = `${input.request.method} ${url.pathname}`
  return yield* Match.value(route).pipe(
    Match.when("POST /schedule", () =>
      scheduleAlarmRequest({ request: input.request, storage: input.storage }),
    ),
    Match.when("DELETE /schedule", () => cancelAlarmRequest({ storage: input.storage })),
    Match.orElse(() => Effect.succeed(json({ error: "Not found" }, 404))),
  )
})

export function handleWorkflowAlarmFetch(input: {
  request: Request
  storage: WorkflowAlarmStorage
}): Promise<Response> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker/DO fetch boundary bridging the Effect alarm handler to the Promise-based Durable Object entrypoint.
  return Effect.runPromise(handleWorkflowAlarmFetchEffect(input))
}

async function rescheduleCronPromise(
  storage: WorkflowAlarmStorage,
  schedule: StoredSchedule,
  cron: string,
): Promise<void> {
  const next = nextCronDate(cron, new Date())
  await storage.put("schedule", { ...schedule, scheduledAt: next.toISOString() })
  await storage.setAlarm(next.getTime())
}

function rescheduleAlarmPromise(
  storage: WorkflowAlarmStorage,
  schedule: StoredSchedule,
): Promise<unknown> {
  const cron = schedule.cron
  return Match.value(schedule.kind === "cron" && typeof cron === "string" && cron.length > 0).pipe(
    Match.when(true, () => rescheduleCronPromise(storage, schedule, cron as string)),
    Match.orElse(() => storage.delete("schedule")),
  )
}

const runScheduledWorkflow = Effect.fn("workflows.runScheduledWorkflow")(function* (input: {
  env: Env
  storage: WorkflowAlarmStorage
  schedule: StoredSchedule
  workflow: WorkflowRecord
}) {
  const triggerKind = Match.value(input.schedule.kind).pipe(
    Match.when("cron", () => "cron" as const),
    Match.orElse(() => "datetime" as const),
  )
  const trigger: WorkflowTriggerPayload = {
    kind: triggerKind,
    nodeId: input.schedule.nodeId,
    cron: input.schedule.cron ?? null,
    scheduledAt: input.schedule.scheduledAt,
    firedAt: new Date().toISOString(),
    payload: {},
  }
  const userId = input.workflow.user_id
  const oktaUserId = yield* resolveOktaUserId(input.env, input.workflow.user_id).pipe(
    Effect.orElseSucceed(() => null),
  )

  yield* Effect.tryPromise({
    try: () =>
      startWorkflowRun({
        env: input.env,
        workflow: input.workflow,
        trigger,
        userId,
        oktaUserId,
      }).finally(() => rescheduleAlarmPromise(input.storage, input.schedule)),
    catch: toError,
  })
})

const handleWorkflowAlarmEffect = Effect.fn("workflows.handleAlarm")(function* (input: {
  env: Env
  storage: WorkflowAlarmStorage
}) {
  const stored = yield* Effect.tryPromise({
    try: () => input.storage.get("schedule"),
    catch: toError,
  })
  yield* Option.match(
    Option.flatMap(Option.fromNullishOr(stored), (value) =>
      Schema.decodeUnknownOption(StoredScheduleSchema)(value),
    ),
    {
      onNone: () => Effect.void,
      onSome: (decoded) =>
        handleScheduledAlarm({
          env: input.env,
          storage: input.storage,
          schedule: storedScheduleFromDecoded(decoded),
        }),
    },
  )
})

const handleScheduledAlarm = Effect.fn("workflows.handleScheduledAlarm")(function* (input: {
  env: Env
  storage: WorkflowAlarmStorage
  schedule: StoredSchedule
}) {
  const parsedRoutineId = Option.fromNullishOr(
    parseRoutineAlarmWorkflowId(input.schedule.workflowId),
  )
  const targetedRoutineId = Match.value(input.schedule.target).pipe(
    Match.when("routine", () =>
      Option.orElse(parsedRoutineId, () => Option.some(input.schedule.workflowId)),
    ),
    Match.orElse(() => parsedRoutineId),
  )
  yield* Option.match(targetedRoutineId, {
    onSome: (routineId) =>
      handleScheduledRoutineAlarm({
        env: input.env,
        storage: input.storage,
        schedule: input.schedule,
        routineId,
      }),
    onNone: () => handleScheduledWorkflowAlarm(input),
  })
})

const handleScheduledWorkflowAlarm = Effect.fn("workflows.handleScheduledWorkflowAlarm")(
  function* (input: { env: Env; storage: WorkflowAlarmStorage; schedule: StoredSchedule }) {
    const store = createWorkflowStoreFromD1(input.env.DB)
    const workflow = yield* Effect.tryPromise({
      try: () => store.getWorkflow(input.schedule.workflowId),
      catch: toError,
    })
    yield* Option.match(
      Option.filter(Option.fromNullishOr(workflow), (resolved) => resolved.status === "active"),
      {
        onNone: () =>
          Effect.tryPromise({
            try: () => input.storage.delete("schedule"),
            catch: toError,
          }),
        onSome: (resolved) =>
          runScheduledWorkflow({
            env: input.env,
            storage: input.storage,
            schedule: input.schedule,
            workflow: resolved,
          }),
      },
    )
  },
)

const promptBotSession = Effect.fn("workflows.promptBotSession")(function* (input: {
  env: Env
  sessionId: string
  userId: string
  content: string
}) {
  const sessionNamespace = input.env.SESSION as DurableObjectNamespace
  const stub = sessionNamespace.get(sessionNamespace.idFromName(input.sessionId))
  yield* Effect.tryPromise({
    try: () =>
      stub.fetch("http://internal/internal/prompt-async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          content: input.content,
          authorId: input.userId,
          source: "web",
          executionMode: "sync",
        }),
      }),
    catch: toError,
  })
})

const handleScheduledRoutineAlarm = Effect.fn("workflows.handleScheduledRoutineAlarm")(
  function* (input: {
    env: Env
    storage: WorkflowAlarmStorage
    schedule: StoredSchedule
    routineId: string
  }) {
    const store = new BotStore(makeD1Drizzle(input.env.DB))
    const routineOption = yield* store.getRoutineById(input.routineId)
    yield* Option.match(routineOption, {
      onNone: () =>
        Effect.tryPromise({
          try: () => input.storage.delete("schedule"),
          catch: toError,
        }),
      onSome: (routine) =>
        dispatchRoutineTick({
          env: input.env,
          storage: input.storage,
          schedule: input.schedule,
          routine,
          store,
        }),
    })
  },
)

const dispatchRoutineTick = Effect.fn("workflows.dispatchRoutineTick")(function* (input: {
  env: Env
  storage: WorkflowAlarmStorage
  schedule: StoredSchedule
  routine: BotRoutineSummary
  store: BotStore
}) {
  const now = Date.now()
  const decision = evaluateRoutineTick({
    kind: input.routine.kind,
    until: input.routine.until,
    status: input.routine.status,
    cadence: input.routine.cadence,
    now,
    nextCronDate,
  })
  const nextRunAt = Match.value(decision).pipe(
    Match.when({ action: "run" }, (run) => Option.some(run.nextRunAt)),
    Match.orElse(() => Option.none()),
  )
  const expiredRoutineId = Match.value(decision.action).pipe(
    Match.when("expire", () => Option.some(input.routine.id)),
    Match.orElse(() => Option.none()),
  )
  yield* Option.match(nextRunAt, {
    onSome: (scheduledAt) =>
      runActiveRoutineTick({
        env: input.env,
        storage: input.storage,
        schedule: input.schedule,
        routine: input.routine,
        store: input.store,
        now,
        nextRunAt: scheduledAt,
      }),
    onNone: () =>
      settleInactiveRoutine({
        store: input.store,
        storage: input.storage,
        expiredRoutineId,
      }),
  })
})

const settleInactiveRoutine = Effect.fn("workflows.settleInactiveRoutine")(function* (input: {
  store: BotStore
  storage: WorkflowAlarmStorage
  expiredRoutineId: Option.Option<string>
}) {
  yield* Option.match(input.expiredRoutineId, {
    onSome: (routineId) => input.store.deleteRoutineById(routineId),
    onNone: () => Effect.void,
  })
  yield* Effect.tryPromise({
    try: () => input.storage.delete("schedule"),
    catch: toError,
  })
})

const runActiveRoutineTick = Effect.fn("workflows.runActiveRoutineTick")(function* (input: {
  env: Env
  storage: WorkflowAlarmStorage
  schedule: StoredSchedule
  routine: BotRoutineSummary
  store: BotStore
  now: number
  nextRunAt: string
}) {
  const bot = yield* input.store.getOwned(input.routine.userId, input.routine.botId)
  yield* Option.match(Option.fromNullishOr(bot.sessionId), {
    onNone: () => Effect.void,
    onSome: (sessionId) =>
      promptBotSession({
        env: input.env,
        sessionId,
        userId: input.routine.userId,
        content: buildRoutineTickPrompt(input.routine),
      }),
  })
  yield* input.store.markRoutineRun(input.routine.id, input.now)
  const cron = Match.value(input.routine.cadence).pipe(
    Match.when({ kind: "cron" }, (cadence) => Option.fromNullishOr(cadence.cron)),
    Match.orElse(() => Option.none()),
  )
  const kind = Match.value(input.routine.cadence.kind).pipe(
    Match.when("cron", () => "cron" as const),
    Match.orElse(() => "datetime" as const),
  )
  yield* Effect.tryPromise({
    try: () =>
      persistRoutineReschedule({
        storage: input.storage,
        schedule: input.schedule,
        nextRunAt: input.nextRunAt,
        cron: Option.getOrNull(cron),
        kind,
      }),
    catch: toError,
  })
})

async function persistRoutineReschedule(input: {
  storage: WorkflowAlarmStorage
  schedule: StoredSchedule
  nextRunAt: string
  cron: string | null
  kind: "cron" | "datetime"
}): Promise<void> {
  const nextSchedule: StoredSchedule = {
    ...input.schedule,
    kind: input.kind,
    cron: input.cron,
    target: "routine",
    scheduledAt: input.nextRunAt,
  }
  await input.storage.put("schedule", nextSchedule)
  await input.storage.setAlarm(Date.parse(input.nextRunAt))
}

export function handleWorkflowAlarm(input: {
  env: Env
  storage: WorkflowAlarmStorage
}): Promise<void> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Worker/DO alarm boundary bridging the Effect alarm handler to the Promise-based Durable Object entrypoint.
  return Effect.runPromise(handleWorkflowAlarmEffect(input))
}

function getWorkflowAlarmStub(env: Env, workflowId: string, nodeId: string) {
  const namespace = env.WORKFLOW_ALARM as DurableObjectNamespace
  const id = namespace.idFromName(`${workflowId}:${nodeId}`)
  return namespace.get(id)
}

const deleteAlarmScheduleFetch = (stub: { fetch: typeof fetch }) =>
  Effect.tryPromise({
    try: () => stub.fetch("http://workflow-alarm/schedule", { method: "DELETE" }),
    catch: toError,
  })

function postAlarmScheduleFetch(
  stub: { fetch: typeof fetch },
  input: {
    workflowId: string
    userId: string
    node: { id: string; type: string }
    cron: string
    scheduledAt: string
  },
) {
  const scheduleKind = Match.value(input.node.type).pipe(
    Match.when("cron-trigger", () => "cron"),
    Match.orElse(() => "datetime"),
  )
  const scheduleCron = Match.value(input.node.type === "cron-trigger").pipe(
    Match.when(true, () => input.cron),
    Match.orElse(() => null),
  )
  return Effect.tryPromise({
    try: () =>
      stub.fetch("http://workflow-alarm/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          workflowId: input.workflowId,
          nodeId: input.node.id,
          userId: input.userId,
          kind: scheduleKind,
          scheduledAt: input.scheduledAt,
          cron: scheduleCron,
        }),
      }),
    catch: toError,
  })
}

const scheduleTriggerNode = Effect.fn("workflows.scheduleTriggerNode")(function* (input: {
  env: Env
  workflowId: string
  userId: string
  node: { id: string; type: string; options: WorkflowNodeOptions }
}) {
  const cron = Match.value(input.node.options.cron).pipe(
    Match.when(Match.string, (value) => value.trim()),
    Match.orElse(() => ""),
  )
  const scheduledAt = Match.value(input.node.type).pipe(
    Match.when("cron-trigger", () =>
      Match.value(cron.length > 0).pipe(
        Match.when(true, () => nextCronDate(cron, new Date()).toISOString()),
        Match.orElse(() => ""),
      ),
    ),
    Match.when("datetime-trigger", () =>
      Match.value(input.node.options.scheduledAt).pipe(
        Match.when(Match.string, (value) => value.trim()),
        Match.orElse(() => ""),
      ),
    ),
    Match.orElse(() => ""),
  )
  const stub = getWorkflowAlarmStub(input.env, input.workflowId, input.node.id)
  yield* Match.value(scheduledAt.length > 0).pipe(
    Match.when(true, () =>
      postAlarmScheduleFetch(stub, {
        workflowId: input.workflowId,
        userId: input.userId,
        node: input.node,
        cron,
        scheduledAt,
      }),
    ),
    Match.orElse(() => deleteAlarmScheduleFetch(stub)),
  )
})

export const scheduleWorkflowDateTriggers = Effect.fn("workflows.scheduleDateTriggers")(
  function* (input: {
    env: Env
    workflowId: string
    userId: string
    nodes: Array<{ id: string; type: string; options: WorkflowNodeOptions }>
  }) {
    const triggerNodes = Arr.filter(
      input.nodes,
      (node) => node.type === "datetime-trigger" || node.type === "cron-trigger",
    )
    yield* Effect.forEach(
      triggerNodes,
      (node) =>
        scheduleTriggerNode({
          env: input.env,
          workflowId: input.workflowId,
          userId: input.userId,
          node,
        }),
      { concurrency: "unbounded" },
    )
  },
)

export function scheduleRoutineAlarm(input: {
  env: Env
  routineId: string
  userId: string
  scheduledAt: string
  cron: string | null
}) {
  const stub = getWorkflowAlarmStub(
    input.env,
    routineAlarmWorkflowId(input.routineId),
    BOT_ROUTINE_ALARM_NODE_ID,
  )
  const kind = Match.value(Option.fromNullishOr(input.cron)).pipe(
    Match.when(Option.isSome, () => "cron" as const),
    Match.orElse(() => "datetime" as const),
  )
  return Effect.tryPromise({
    try: () =>
      stub.fetch("http://workflow-alarm/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          workflowId: routineAlarmWorkflowId(input.routineId),
          nodeId: BOT_ROUTINE_ALARM_NODE_ID,
          userId: input.userId,
          kind,
          scheduledAt: input.scheduledAt,
          cron: input.cron,
          target: "routine",
        }),
      }),
    catch: toError,
  }).pipe(Effect.map(() => undefined))
}

export function cancelRoutineAlarm(input: { env: Env; routineId: string }) {
  return deleteAlarmScheduleFetch(
    getWorkflowAlarmStub(
      input.env,
      routineAlarmWorkflowId(input.routineId),
      BOT_ROUTINE_ALARM_NODE_ID,
    ),
  )
}

export const cancelWorkflowDateTriggers = Effect.fn("workflows.cancelDateTriggers")(
  function* (input: { env: Env; workflowId: string; nodes: Array<{ id: string; type: string }> }) {
    const triggerNodes = Arr.filter(
      input.nodes,
      (node) => node.type === "datetime-trigger" || node.type === "cron-trigger",
    )
    yield* Effect.forEach(
      triggerNodes,
      (node) =>
        deleteAlarmScheduleFetch(getWorkflowAlarmStub(input.env, input.workflowId, node.id)),
      { concurrency: "unbounded" },
    )
  },
)
