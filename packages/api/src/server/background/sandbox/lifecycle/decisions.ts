import type { SandboxStatus } from "../../types"

export interface SpawnDecisionInput {
  status: SandboxStatus | null
  hasSandboxId: boolean
  hasSandboxSocket: boolean
  isSpawning: boolean
}

export type SpawnDecision = { action: "skip"; reason: string } | { action: "spawn"; reason: string }

export function evaluateSpawnDecision(input: SpawnDecisionInput): SpawnDecision {
  if (input.isSpawning) {
    return { action: "skip", reason: "spawn_in_progress" }
  }
  if (input.hasSandboxSocket) {
    return { action: "skip", reason: "sandbox_socket_active" }
  }
  if (input.status === "spawning" || input.status === "connecting") {
    return { action: "spawn", reason: "orphaned_sandbox_start" }
  }
  if (
    input.hasSandboxId &&
    (input.status === "ready" || input.status === "running" || input.status === "stopped")
  ) {
    return { action: "skip", reason: "sandbox_ready" }
  }
  return { action: "spawn", reason: "spawn_required" }
}

export interface WarmDecisionInput {
  status: SandboxStatus | null
  hasSandboxId: boolean
  hasSandboxSocket: boolean
  isSpawning: boolean
}

export type WarmDecision = { action: "skip"; reason: string } | { action: "warm"; reason: string }

export function evaluateWarmDecision(input: WarmDecisionInput): WarmDecision {
  if (input.hasSandboxSocket) {
    return { action: "skip", reason: "sandbox_connected" }
  }
  if (input.isSpawning) {
    return { action: "skip", reason: "spawn_in_progress" }
  }
  if (
    input.hasSandboxId &&
    (input.status === "ready" || input.status === "running" || input.status === "stopped")
  ) {
    return { action: "skip", reason: "sandbox_ready" }
  }
  return { action: "warm", reason: "warm_requested" }
}

export interface InactivityDecisionInput {
  lastActivity: number | null
  timeoutMs: number
  now: number
}

export type InactivityDecision = { action: "none" } | { action: "timeout" }

export function evaluateInactivityTimeout(input: InactivityDecisionInput): InactivityDecision {
  if (!input.lastActivity) {
    return { action: "none" }
  }
  return input.now - input.lastActivity > input.timeoutMs
    ? { action: "timeout" }
    : { action: "none" }
}

export interface ReusableSandboxIdentityInput {
  status: SandboxStatus
  sandboxId: string | null
  authToken: string | null
}

export function getReusableSandboxIdentity(
  input: ReusableSandboxIdentityInput,
): { sandboxId: string; authToken: string } | null {
  if (!input.sandboxId || !input.authToken) {
    return null
  }

  if (input.status === "pending" || input.status === "failed") {
    return null
  }

  return {
    sandboxId: input.sandboxId,
    authToken: input.authToken,
  }
}

export interface SandboxStatusReconciliationInput {
  status: SandboxStatus
  lastActivity: number | null
  createdAt: number
  hasSandboxSocket: boolean
  timeoutMs: number
  now: number
}

export function reconcileInactiveSandboxStatus(
  input: SandboxStatusReconciliationInput,
): SandboxStatus {
  if (input.status !== "ready" || input.hasSandboxSocket) {
    return input.status
  }

  const lastActivity = input.lastActivity ?? input.createdAt
  if (!lastActivity) {
    return input.status
  }

  return evaluateInactivityTimeout({
    lastActivity,
    timeoutMs: input.timeoutMs,
    now: input.now,
  }).action === "timeout"
    ? "stopped"
    : input.status
}
