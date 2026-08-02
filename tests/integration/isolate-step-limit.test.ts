import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_ISOLATE_STEP_LIMIT,
  MAX_ISOLATE_STEP_LIMIT,
  MIN_ISOLATE_STEP_LIMIT,
  normalizeIsolateStepLimit,
} from "../../packages/shared/src"
import {
  getFinishReason,
  isStepLimitFinishReason,
} from "../../packages/api/src/server/background/isolate/message-chunks"

describe("isolate step limits", () => {
  it("normalizes configured step limits", () => {
    expect(DEFAULT_ISOLATE_STEP_LIMIT).toBe(50)
    expect(normalizeIsolateStepLimit(undefined)).toBe(DEFAULT_ISOLATE_STEP_LIMIT)
    expect(normalizeIsolateStepLimit(0)).toBe(MIN_ISOLATE_STEP_LIMIT)
    expect(normalizeIsolateStepLimit(MAX_ISOLATE_STEP_LIMIT + 10)).toBe(MAX_ISOLATE_STEP_LIMIT)
  })

  it("detects tool-call finishes as step-limit recovery candidates", () => {
    const finishReason = getFinishReason(
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    )

    expect(Option.getOrUndefined(finishReason)).toBe("tool-calls")
    expect(isStepLimitFinishReason(finishReason)).toBe(true)
  })
})
