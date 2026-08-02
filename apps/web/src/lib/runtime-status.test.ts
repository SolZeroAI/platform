import { describe, expect, it } from "vitest"
import { isIdleRuntimeStatus, shouldClearProcessingForRuntimeStatus } from "./runtime-status"

describe("isIdleRuntimeStatus", () => {
  it.each(["ready", "stopped", "stale", "failed"])("treats %s as idle", (status) => {
    expect(isIdleRuntimeStatus(status)).toBe(true)
  })

  it.each([undefined, null, "pending", "spawning", "warming", "syncing", "connecting", "running"])(
    "does not treat %s as idle",
    (status) => {
      expect(isIdleRuntimeStatus(status)).toBe(false)
    },
  )
})

describe("shouldClearProcessingForRuntimeStatus", () => {
  it.each(["stopped", "stale", "failed"])("clears processing for %s", (status) => {
    expect(shouldClearProcessingForRuntimeStatus(status)).toBe(true)
  })

  it.each([
    undefined,
    null,
    "pending",
    "spawning",
    "warming",
    "syncing",
    "connecting",
    "ready",
    "running",
  ])("preserves processing for %s", (status) => {
    expect(shouldClearProcessingForRuntimeStatus(status)).toBe(false)
  })
})
