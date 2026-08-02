import { describe, expect, it } from "vitest"
import {
  evaluateInactivityTimeout,
  evaluateSpawnDecision,
  evaluateWarmDecision,
  getReusableSandboxIdentity,
  reconcileInactiveSandboxStatus,
} from "../../packages/api/src/server/background/sandbox/lifecycle/decisions"

describe("session lifecycle decisions", () => {
  it("spawns when no active sandbox socket exists", () => {
    const decision = evaluateSpawnDecision({
      status: "pending",
      hasSandboxId: false,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(decision).toEqual({
      action: "spawn",
      reason: "spawn_required",
    })
  })

  it("skips spawn while spawn is in progress", () => {
    const decision = evaluateSpawnDecision({
      status: "spawning",
      hasSandboxId: false,
      hasSandboxSocket: false,
      isSpawning: true,
    })
    expect(decision.action).toBe("skip")
  })

  it("starts recovery when persisted startup state has no in-memory spawn", () => {
    const decision = evaluateSpawnDecision({
      status: "spawning",
      hasSandboxId: true,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(decision).toEqual({
      action: "spawn",
      reason: "orphaned_sandbox_start",
    })
  })

  it("reuses a ready sandbox even without an active sandbox socket", () => {
    const decision = evaluateSpawnDecision({
      status: "ready",
      hasSandboxId: true,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(decision).toEqual({
      action: "skip",
      reason: "sandbox_ready",
    })
  })

  it("warms only when there is no active sandbox", () => {
    const warm = evaluateWarmDecision({
      status: "pending",
      hasSandboxId: false,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(warm.action).toBe("warm")

    const skip = evaluateWarmDecision({
      status: "ready",
      hasSandboxId: true,
      hasSandboxSocket: true,
      isSpawning: false,
    })
    expect(skip.action).toBe("skip")
  })

  it("reuses a sleeping sandbox id instead of spawning a new container", () => {
    const spawn = evaluateSpawnDecision({
      status: "stopped",
      hasSandboxId: true,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(spawn).toEqual({
      action: "skip",
      reason: "sandbox_ready",
    })

    const warm = evaluateWarmDecision({
      status: "stopped",
      hasSandboxId: true,
      hasSandboxSocket: false,
      isSpawning: false,
    })
    expect(warm).toEqual({
      action: "skip",
      reason: "sandbox_ready",
    })
  })

  it("reuses an existing sandbox identity when recovering startup state", () => {
    expect(
      getReusableSandboxIdentity({
        sandboxId: "sandbox-1",
        authToken: "token-1",
        status: "spawning",
      }),
    ).toEqual({
      sandboxId: "sandbox-1",
      authToken: "token-1",
    })
  })

  it("does not reuse failed or uncreated sandbox identities", () => {
    expect(
      getReusableSandboxIdentity({
        sandboxId: "sandbox-1",
        authToken: "token-1",
        status: "failed",
      }),
    ).toBeNull()

    expect(
      getReusableSandboxIdentity({
        sandboxId: null,
        authToken: null,
        status: "pending",
      }),
    ).toBeNull()
  })

  it("times out inactive sandboxes", () => {
    const now = Date.now()
    expect(
      evaluateInactivityTimeout({
        lastActivity: now - 700_000,
        timeoutMs: 600_000,
        now,
      }),
    ).toEqual({ action: "timeout" })
    expect(
      evaluateInactivityTimeout({
        lastActivity: now - 300_000,
        timeoutMs: 600_000,
        now,
      }),
    ).toEqual({ action: "none" })
  })

  it("marks expired ready sandbox sessions stopped for state display", () => {
    const now = Date.now()
    expect(
      reconcileInactiveSandboxStatus({
        status: "ready",
        lastActivity: now - 700_000,
        createdAt: now - 700_000,
        hasSandboxSocket: false,
        timeoutMs: 600_000,
        now,
      }),
    ).toBe("stopped")
  })

  it("keeps ready status while the sandbox is active", () => {
    const now = Date.now()
    expect(
      reconcileInactiveSandboxStatus({
        status: "ready",
        lastActivity: now - 700_000,
        createdAt: now - 700_000,
        hasSandboxSocket: true,
        timeoutMs: 600_000,
        now,
      }),
    ).toBe("ready")

    expect(
      reconcileInactiveSandboxStatus({
        status: "ready",
        lastActivity: now - 300_000,
        createdAt: now - 700_000,
        hasSandboxSocket: false,
        timeoutMs: 600_000,
        now,
      }),
    ).toBe("ready")
  })
})
