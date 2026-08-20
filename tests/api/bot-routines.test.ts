import { describe, expect, it } from "vitest"
import {
  BotRoutineValidationError,
  buildRoutineTickPrompt,
  evaluateRoutineTick,
  isTemporaryRoutineExpired,
  nextRoutineRunAt,
  normalizeCreateBotRoutineInput,
  parseRoutineAlarmWorkflowId,
  parseStoredBotRoutineCadence,
  parseStoredBotRoutineWatch,
  parseUntilTimestamp,
  routineAlarmWorkflowId,
} from "../../packages/shared/src/bots"

const nextCronDate = (expression: string, after: Date) => {
  expect(expression).toBe("*/5 * * * *")
  return new Date(after.getTime() + 5 * 60 * 1000)
}

describe("bot routines", () => {
  it("accepts a standing cron routine", () => {
    const routine = normalizeCreateBotRoutineInput({
      name: "Morning standup",
      kind: "standing",
      cadence: { kind: "cron", cron: "0 13 * * *" },
      prompt: "Post the standup summary",
    })

    expect(routine.kind).toBe("standing")
    expect(routine.until).toBeNull()
    expect(routine.cadence).toEqual({ kind: "cron", cron: "0 13 * * *" })
  })

  it("accepts a temporary GitHub pull request watch", () => {
    const until = Date.parse("2026-08-20T12:00:00.000Z")
    const routine = normalizeCreateBotRoutineInput({
      name: "Watch PR 12 CI",
      kind: "temporary",
      cadence: { kind: "interval", intervalSeconds: 300 },
      prompt: "Check lint and validation on PR 12",
      until,
      watch: {
        kind: "github_pull_request",
        owner: "SolZeroAI",
        repo: "platform",
        pullNumber: 12,
        completeWhen: "checks_concluded",
      },
    })

    expect(routine.kind).toBe("temporary")
    expect(routine.until).toBe(until)
    expect(routine.watch).toEqual({
      kind: "github_pull_request",
      owner: "SolZeroAI",
      repo: "platform",
      pullNumber: 12,
      completeWhen: "checks_concluded",
    })
  })

  it("rejects a temporary routine with no deadline and no watch", () => {
    expect(() =>
      normalizeCreateBotRoutineInput({
        name: "Linger",
        kind: "temporary",
        cadence: { kind: "interval", intervalSeconds: 120 },
        prompt: "Keep watching",
      }),
    ).toThrow(BotRoutineValidationError)
  })

  it("rejects a standing routine with a deadline", () => {
    expect(() =>
      normalizeCreateBotRoutineInput({
        name: "Daily",
        kind: "standing",
        cadence: { kind: "cron", cron: "0 * * * *" },
        prompt: "Hourly check",
        until: "2026-08-20T12:00:00.000Z",
      }),
    ).toThrow(BotRoutineValidationError)
  })

  it("expires a temporary routine after its deadline", () => {
    const until = Date.parse("2026-08-19T20:00:00.000Z")
    expect(
      isTemporaryRoutineExpired({
        kind: "temporary",
        until,
        now: until + 1,
      }),
    ).toBe(true)
    expect(
      evaluateRoutineTick({
        kind: "temporary",
        until,
        status: "active",
        cadence: { kind: "interval", intervalSeconds: 300 },
        now: until + 1,
        nextCronDate,
      }),
    ).toEqual({ action: "expire" })
  })

  it("keeps a standing routine scheduled after a tick", () => {
    const now = Date.parse("2026-08-19T20:00:00.000Z")
    expect(
      evaluateRoutineTick({
        kind: "standing",
        until: null,
        status: "active",
        cadence: { kind: "cron", cron: "*/5 * * * *" },
        now,
        nextCronDate,
      }),
    ).toEqual({
      action: "run",
      nextRunAt: new Date(now + 5 * 60 * 1000).toISOString(),
    })
  })

  it("schedules the next interval run from now", () => {
    const now = Date.parse("2026-08-19T20:00:00.000Z")
    expect(
      nextRoutineRunAt({
        cadence: { kind: "interval", intervalSeconds: 180 },
        now,
        nextCronDate,
      }),
    ).toBe(new Date(now + 180_000).toISOString())
  })

  it("builds a tick prompt that tells the bot to complete a finished watch", () => {
    const prompt = buildRoutineTickPrompt({
      id: "routine_1",
      name: "Watch PR 12 CI",
      kind: "temporary",
      prompt: "Check lint and validation on PR 12",
      until: Date.parse("2026-08-20T12:00:00.000Z"),
      watch: {
        kind: "github_pull_request",
        owner: "SolZeroAI",
        repo: "platform",
        pullNumber: 12,
        completeWhen: "checks_concluded",
      },
    })

    expect(prompt).toContain("Routine id: routine_1")
    expect(prompt).toContain("github_pull_request SolZeroAI/platform#12")
    expect(prompt).toContain("complete_bot_routine")
  })

  it("uses the existing workflow alarm id prefix for routine ticks", () => {
    expect(routineAlarmWorkflowId("routine_1")).toBe("routine:routine_1")
    expect(parseRoutineAlarmWorkflowId("routine:routine_1")).toBe("routine_1")
    expect(parseRoutineAlarmWorkflowId("wf_1")).toBeNull()
  })

  it("parses stored cadence and watch JSON at the D1 boundary", () => {
    expect(parseStoredBotRoutineCadence('{"kind":"cron","cron":"0 * * * *"}')).toEqual({
      kind: "cron",
      cron: "0 * * * *",
    })
    expect(parseStoredBotRoutineWatch('{"kind":"none"}')).toEqual({ kind: "none" })
    expect(
      parseStoredBotRoutineWatch(
        '{"kind":"github_pull_request","owner":"SolZeroAI","repo":"platform","pullNumber":12,"completeWhen":"checks_concluded"}',
      ),
    ).toEqual({
      kind: "github_pull_request",
      owner: "SolZeroAI",
      repo: "platform",
      pullNumber: 12,
      completeWhen: "checks_concluded",
    })
    expect(parseStoredBotRoutineWatch("{")).toEqual({ kind: "none" })
    expect(() => parseStoredBotRoutineCadence("{")).toThrow(BotRoutineValidationError)
    expect(() => parseStoredBotRoutineWatch('{"kind":"weekly"}')).toThrow(BotRoutineValidationError)
  })

  it("parses until as a unix timestamp or ISO-8601 string", () => {
    expect(parseUntilTimestamp(null)).toBeNull()
    expect(parseUntilTimestamp("")).toBeNull()
    expect(parseUntilTimestamp(1_777_000_000_000)).toBe(1_777_000_000_000)
    expect(parseUntilTimestamp("2026-08-20T12:00:00.000Z")).toBe(
      Date.parse("2026-08-20T12:00:00.000Z"),
    )
    expect(() => parseUntilTimestamp(0)).toThrow(BotRoutineValidationError)
    expect(() => parseUntilTimestamp("not-a-date")).toThrow(BotRoutineValidationError)
  })
})
