import {
  generateBranchName,
  getInfraServerUrl,
  getStageMetadataSync,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  type AgentRuntime,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Semaphore from "effect/Semaphore"
import { generateId } from "../../auth/crypto"
import type { GitHubCloneCredentials } from "../../auth/github-clone-auth"
import { toError } from "../../../lib/effect-errors"
import { parseJsonArray } from "../../../lib/json"
import { createGlobalSecretsStoreFromD1 } from "../../db/repo-secrets"
import { makeControlPlaneFromEnv } from "../../../effect/db/control-plane-db"
import type { SessionRuntimeRepository } from "../../session/repository"
import { buildResolvedSessionMcpServers } from "../../session/runtime-mcp"
import type { SessionRuntimeWebSocket } from "../../session/websocket-manager"
import type { Env, SandboxEvent, SandboxStatus, ServerMessage } from "../../types"
import type { SandboxProvider } from "../provider"
import type { PromptRequest } from "../provider"
import { HarnessContainerProvider } from "../providers/harness-container-provider"
import {
  evaluateSpawnDecision,
  evaluateWarmDecision,
  getReusableSandboxIdentity,
  reconcileInactiveSandboxStatus,
} from "./decisions"

interface LifecycleManagerDependencies {
  env: Env
  repository: SessionRuntimeRepository
  wsManager: SessionRuntimeWebSocket
  broadcast: (message: ServerMessage) => void
  onEvent: (event: SandboxEvent) => Promise<void>
  getGitHubCloneCredentials: () => Promise<GitHubCloneCredentials | null>
}

function parseStoredSecretKeys(value: string | null | undefined): string[] {
  return parseJsonArray(value).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
}

export class SandboxLifecycleManager {
  private readonly spawnSemaphore = Semaphore.makeUnsafe(1)

  constructor(
    private readonly dependencies: LifecycleManagerDependencies,
    private readonly provider: SandboxProvider,
  ) {}

  getSandboxId(): Option.Option<string> {
    return Option.fromNullishOr(this.dependencies.repository.getSandbox()?.sandbox_id)
  }

  ensureSandbox() {
    return this.beginSpawn("spawn")
  }

  warmSandbox() {
    return this.beginSpawn("warm")
  }

  runPrompt(request: PromptRequest) {
    return Effect.gen({ self: this }, function* () {
      yield* this.waitForSpawn()

      const session = yield* this.getReadySession()
      const sandbox = yield* this.getReadySandbox()

      this.dependencies.repository.updateSandboxStatus("running")
      this.dependencies.broadcast({ type: "sandbox_status", status: "running" })

      const ownerUserId = this.getOwnerUserId()
      const secretEnv = yield* this.resolveSecretEnv(ownerUserId, session.secret_keys_json)

      const result = yield* this.provider.runPrompt(
        session.session_name ?? session.id,
        sandbox.sandbox_id,
        { ...request, agentRuntime: session.agent_runtime, secretEnv },
        (event) => this.dependencies.onEvent(event),
      )

      this.dependencies.repository.updateSandboxStatus("ready")
      this.dependencies.repository.updateSandboxLastActivity(Date.now())
      this.dependencies.broadcast({ type: "sandbox_status", status: "ready" })

      yield* Option.match(
        Option.filter(Option.some(result), (promptResult) => !promptResult.success),
        {
          onNone: () => Effect.void,
          onSome: (failedResult) =>
            Effect.die(new Error(failedResult.error ?? "Prompt execution failed")),
        },
      )
    })
  }

  syncRuntimeConfig() {
    return Effect.gen({ self: this }, function* () {
      yield* this.waitForSpawn()

      const session = this.dependencies.repository.getSession()
      const sandbox = this.dependencies.repository.getSandbox()
      yield* Option.match(this.getSyncableSandbox(session, sandbox), {
        onNone: () => Effect.void,
        onSome: ([resolvedSession, resolvedSandbox]) =>
          this.syncResolvedRuntimeConfig(resolvedSession, resolvedSandbox.sandbox_id),
      })
    })
  }

  stopCurrentExecution() {
    const session = this.dependencies.repository.getSession()
    const sandbox = this.dependencies.repository.getSandbox()
    return Option.match(this.getSessionSandboxPair(session, sandbox), {
      onNone: () => Effect.void,
      onSome: ([resolvedSession, resolvedSandbox]) =>
        this.stopResolvedCurrentExecution(resolvedSession, resolvedSandbox.sandbox_id),
    })
  }

  destroySandbox(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      yield* this.waitForSpawn().pipe(Effect.catch(() => Effect.void))

      const sandbox = this.dependencies.repository.getSandbox()
      const session = this.dependencies.repository.getSession()
      yield* Option.match(
        Option.all({
          sandboxId: Option.fromNullishOr(sandbox?.sandbox_id),
          agentRuntime: Option.fromNullishOr(session?.agent_runtime),
        }),
        {
          onNone: () => Effect.void,
          onSome: ({ sandboxId, agentRuntime }) =>
            this.provider.destroySandbox(sessionId, sandboxId, agentRuntime),
        },
      )

      this.dependencies.repository.resetSandbox("stopped")
      this.dependencies.wsManager.clearSandboxSocket()
      this.dependencies.broadcast({ type: "sandbox_status", status: "stopped" })
    })
  }

  handleAlarm() {
    return Effect.sync(() => {
      Match.value(this.reconcileSandboxStatus()).pipe(
        Match.when(true, () =>
          this.dependencies.broadcast({ type: "sandbox_status", status: "stopped" }),
        ),
        Match.orElse(() => undefined),
      )
    })
  }

  reconcileSandboxStatus(): boolean {
    return Option.match(Option.fromNullishOr(this.dependencies.repository.getSandbox()), {
      onNone: () => false,
      onSome: (sandbox) => this.reconcileResolvedSandboxStatus(sandbox),
    })
  }

  private reconcileResolvedSandboxStatus(
    sandbox: NonNullable<ReturnType<SessionRuntimeRepository["getSandbox"]>>,
  ): boolean {
    const stageMetadata = getStageMetadataSync(this.dependencies.env)
    const nextStatus = reconcileInactiveSandboxStatus({
      status: sandbox.status,
      lastActivity: sandbox.last_activity,
      createdAt: sandbox.created_at,
      hasSandboxSocket: this.dependencies.wsManager.getSandboxSocket() !== null,
      timeoutMs: stageMetadata.app.sandboxInactivityTimeoutMs,
      now: Date.now(),
    })
    return Match.value(nextStatus === sandbox.status).pipe(
      Match.when(true, () => false),
      Match.orElse(() => this.applyReconciledSandboxStatus(nextStatus)),
    )
  }

  private applyReconciledSandboxStatus(nextStatus: SandboxStatus): boolean {
    this.dependencies.repository.updateSandboxStatus(nextStatus)
    this.dependencies.wsManager.clearSandboxSocket()
    return true
  }

  private waitForSpawn() {
    return this.spawnSemaphore.withPermit(Effect.void)
  }

  private beginSpawn(mode: "spawn" | "warm") {
    return this.spawnSemaphore.withPermit(
      Effect.gen({ self: this }, function* () {
        const sandbox = this.dependencies.repository.getSandbox()
        const decision = this.evaluateSpawnModeDecision(mode, sandbox)
        yield* Option.match(
          Option.filter(Option.some(decision.action), (action) => action !== "skip"),
          {
            onNone: () => Effect.void,
            onSome: () => this.spawnSandbox(mode),
          },
        )
      }),
    )
  }

  private evaluateSpawnModeDecision(
    mode: "spawn" | "warm",
    sandbox: ReturnType<SessionRuntimeRepository["getSandbox"]>,
  ) {
    const input = {
      status: sandbox?.status ?? null,
      hasSandboxId: Boolean(sandbox?.sandbox_id),
      hasSandboxSocket: this.dependencies.wsManager.getSandboxSocket() !== null,
      isSpawning: false,
    }
    return Match.value(mode).pipe(
      Match.when("warm", () => evaluateWarmDecision(input)),
      Match.orElse(() => evaluateSpawnDecision(input)),
    )
  }

  private spawnSandbox(mode: "spawn" | "warm") {
    return Effect.gen({ self: this }, function* () {
      const session = this.dependencies.repository.getSession()
      const sandbox = this.dependencies.repository.getSandbox()
      const context = Option.all({
        session: Option.fromNullishOr(session),
        sandbox: Option.fromNullishOr(sandbox),
      })

      yield* Option.match(context, {
        onNone: () => Effect.void,
        onSome: ({ session: resolvedSession, sandbox: resolvedSandbox }) =>
          this.spawnResolvedSandbox(mode, resolvedSession, resolvedSandbox),
      })
    })
  }

  private spawnResolvedSandbox(
    mode: "spawn" | "warm",
    session: NonNullable<ReturnType<SessionRuntimeRepository["getSession"]>>,
    sandbox: NonNullable<ReturnType<SessionRuntimeRepository["getSandbox"]>>,
  ) {
    return Effect.gen({ self: this }, function* () {
      const githubAuth = yield* Effect.tryPromise({
        try: () => this.dependencies.getGitHubCloneCredentials(),
        catch: toError,
      })
      const now = Date.now()
      const reusableIdentity = getReusableSandboxIdentity({
        status: sandbox.status,
        sandboxId: sandbox.sandbox_id,
        authToken: sandbox.auth_token,
      })
      const sandboxId =
        reusableIdentity?.sandboxId ?? `sandbox-${session.repo_owner}-${session.repo_name}-${now}`
      const authToken = reusableIdentity?.authToken ?? generateId()

      yield* this.destroyPreviousSandboxBeforeRespawn(
        session.session_name ?? session.id,
        sandbox.sandbox_id,
        Boolean(reusableIdentity),
        sandboxId,
        session.agent_runtime,
      )

      this.prepareSandboxSpawnState(reusableIdentity, sandboxId, authToken, now)
      this.broadcastSpawnStarted(mode)

      const result = yield* this.createSandboxForMode(
        mode,
        session,
        sandboxId,
        authToken,
        githubAuth,
      )

      const nextStatus = this.toSandboxRuntimeStatus(result.status)
      this.dependencies.repository.updateSandboxStatus(nextStatus)
      this.dependencies.repository.updateSandboxLastActivity(Date.now())
      this.dependencies.broadcast({
        type: "sandbox_status",
        status: nextStatus,
      })
    }).pipe(
      Effect.catch((errorValue) =>
        Effect.sync(() => {
          const message = this.describeError(errorValue)
          this.dependencies.repository.updateSandboxSpawnError(message, Date.now())
          this.dependencies.repository.updateSandboxStatus("failed")
          this.dependencies.broadcast({ type: "sandbox_error", error: message })
          this.dependencies.broadcast({ type: "sandbox_status", status: "failed" })
        }).pipe(Effect.flatMap(() => Effect.fail(errorValue))),
      ),
    )
  }

  private destroyPreviousSandboxBeforeRespawn(
    sessionId: string,
    sandboxId: string | null,
    hasReusableIdentity: boolean,
    nextSandboxId: string,
    agentRuntime: AgentRuntime,
  ) {
    return Option.match(
      Option.filter(Option.fromNullishOr(sandboxId), (currentSandboxId) =>
        Boolean(!hasReusableIdentity && currentSandboxId !== nextSandboxId),
      ),
      {
        onNone: () => Effect.void,
        onSome: (currentSandboxId) =>
          this.provider
            .destroySandbox(sessionId, currentSandboxId, agentRuntime)
            .pipe(
              Effect.catch((errorValue) =>
                Effect.logWarning("sandbox.destroy_previous_failed").pipe(
                  Effect.annotateLogs({ sandboxId: currentSandboxId, error: String(errorValue) }),
                ),
              ),
            ),
      },
    )
  }

  private prepareSandboxSpawnState(
    reusableIdentity: { sandboxId: string; authToken: string } | null,
    sandboxId: string,
    authToken: string,
    now: number,
  ): void {
    Match.value(Boolean(reusableIdentity)).pipe(
      Match.when(true, () => {
        this.dependencies.repository.updateSandboxStatus("spawning")
        this.dependencies.repository.updateSandboxSpawnError(null, null)
      }),
      Match.orElse(() =>
        this.dependencies.repository.updateSandboxForSpawn({
          status: "spawning",
          sandboxId,
          authToken,
          createdAt: now,
        }),
      ),
    )
  }

  private broadcastSpawnStarted(mode: "spawn" | "warm"): void {
    const startEvent = this.toSandboxStartEvent(mode)
    const startStatus = this.toSandboxStartStatus(mode)
    this.dependencies.broadcast({
      type: startEvent,
    })
    this.dependencies.broadcast({
      type: "sandbox_status",
      status: startStatus,
    })
  }

  private toSandboxRuntimeStatus(status: string): "ready" | "connecting" {
    return Match.value(status).pipe(
      Match.when("ready", () => "ready" as const),
      Match.orElse(() => "connecting" as const),
    )
  }

  private toSandboxStartEvent(mode: "spawn" | "warm"): "sandbox_warming" | "sandbox_spawning" {
    return Match.value(mode).pipe(
      Match.when("warm", () => "sandbox_warming" as const),
      Match.orElse(() => "sandbox_spawning" as const),
    )
  }

  private toSandboxStartStatus(mode: "spawn" | "warm"): "warming" | "spawning" {
    return Match.value(mode).pipe(
      Match.when("warm", () => "warming" as const),
      Match.orElse(() => "spawning" as const),
    )
  }

  private createSandboxForMode(
    mode: "spawn" | "warm",
    session: NonNullable<ReturnType<SessionRuntimeRepository["getSession"]>>,
    sandboxId: string,
    authToken: string,
    githubAuth: GitHubCloneCredentials | null,
  ) {
    return Effect.gen({ self: this }, function* () {
      const ownerUserId = this.getOwnerUserId()
      const secretEnv = yield* this.resolveSecretEnv(ownerUserId, session.secret_keys_json)
      const mcpServers = yield* this.buildResolvedMcpServers(session)
      const config = {
        sessionId: session.session_name ?? session.id,
        agentRuntime: session.agent_runtime,
        sandboxId,
        sandboxAuthToken: authToken,
        controlPlaneUrl: getInfraServerUrl(this.dependencies.env),
        repoOwner: session.repo_owner,
        repoName: session.repo_name,
        repoDefaultBranch: session.repo_default_branch,
        branchName: session.branch_name ?? generateBranchName(session.session_name ?? session.id),
        userId: ownerUserId,
        githubUserId: githubAuth?.githubUserId ?? null,
        githubAccessToken: githubAuth?.accessToken ?? null,
        githubLogin: githubAuth?.githubLogin ?? null,
        githubName: githubAuth?.githubName ?? null,
        githubEmail: githubAuth?.githubEmail ?? null,
        model: session.model,
        mcpServers,
        secretEnv,
      }

      return yield* Match.value(mode).pipe(
        Match.when("warm", () => this.provider.warmSandbox(config)),
        Match.orElse(() => this.provider.createSandbox(config)),
      )
    })
  }

  private buildRuntimeConfigInput(session: {
    id: string
    session_name: string | null
    tools_json: string
    custom_mcp_json: string
    secret_keys_json: string
    model: string
  }) {
    return Effect.gen({ self: this }, function* () {
      const ownerUserId = this.getOwnerUserId()
      const mcpServers = yield* this.buildResolvedMcpServers(session)
      const secretEnv = yield* this.resolveSecretEnv(ownerUserId, session.secret_keys_json)
      return {
        userId: ownerUserId,
        model: session.model,
        mcpServers,
        secretEnv,
      }
    })
  }

  private syncResolvedRuntimeConfig(
    session: {
      id: string
      session_name: string | null
      tools_json: string
      custom_mcp_json: string
      secret_keys_json: string
      model: string
    },
    sandboxId: string,
  ) {
    return Effect.gen({ self: this }, function* () {
      const config = yield* this.buildRuntimeConfigInput(session)
      yield* this.provider.syncRuntimeConfig(session.session_name ?? session.id, sandboxId, config)
    })
  }

  private buildResolvedMcpServers(session: {
    id: string
    session_name: string | null
    tools_json: string
    custom_mcp_json: string
  }) {
    return buildResolvedSessionMcpServers({
      env: this.dependencies.env,
      tools: parseStoredSessionTools(session.tools_json),
      customMcpServers: parseStoredOpenCodeMcpServers(session.custom_mcp_json),
      sessionId: session.session_name ?? session.id,
      stage: this.dependencies.env,
    })
  }

  private resolveSecretEnv(userId: string, secretKeysJson: string | null | undefined) {
    const secretKeys = parseStoredSecretKeys(secretKeysJson)
    return Match.value({
      hasSecretKeys: secretKeys.length > 0,
      hasUser: userId !== "anonymous",
      hasEncryptionKey: Boolean(this.dependencies.env.REPO_SECRETS_ENCRYPTION_KEY),
    }).pipe(
      Match.when({ hasSecretKeys: false }, () => Effect.succeed({})),
      Match.when({ hasUser: false }, () => Effect.succeed({})),
      Match.when({ hasEncryptionKey: false }, () =>
        Effect.die(new Error("Secret storage is not configured")),
      ),
      Match.orElse(() => this.resolveStoredSecretEnv(userId, secretKeys)),
    )
  }

  private resolveStoredSecretEnv(userId: string, secretKeys: string[]) {
    return Effect.tryPromise({
      try: () =>
        createGlobalSecretsStoreFromD1(
          makeControlPlaneFromEnv(this.dependencies.env),
          this.dependencies.env.REPO_SECRETS_ENCRYPTION_KEY ?? "",
        ).getDecryptedSecrets({ userId }),
      catch: toError,
    }).pipe(
      Effect.map((allSecrets) =>
        Object.fromEntries(
          secretKeys
            .filter((key) => Object.prototype.hasOwnProperty.call(allSecrets, key))
            .map((key) => [key, allSecrets[key]]),
        ),
      ),
    )
  }

  private stopResolvedCurrentExecution(
    session: NonNullable<ReturnType<SessionRuntimeRepository["getSession"]>>,
    sandboxId: string,
  ) {
    return this.provider
      .stopPrompt(session.session_name ?? session.id, sandboxId, session.agent_runtime)
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            this.dependencies.repository.updateSandboxStatus("ready")
            this.dependencies.broadcast({ type: "sandbox_status", status: "ready" })
          }),
        ),
      )
  }

  private getOwnerUserId(): string {
    return (
      this.dependencies.repository
        .listParticipants()
        .find((participant) => participant.role === "owner")?.user_id ?? "anonymous"
    )
  }

  private describeError(errorValue: unknown): string {
    return Match.value(errorValue).pipe(
      Match.when(Match.instanceOf(Error), (error) => error.message),
      Match.orElse((value) => String(value)),
    )
  }

  private getReadySession() {
    return Option.match(Option.fromNullishOr(this.dependencies.repository.getSession()), {
      onNone: () => Effect.die(new Error("Sandbox is not ready")),
      onSome: (session) => Effect.succeed(session),
    })
  }

  private getReadySandbox() {
    return Option.match(
      Option.filter(Option.fromNullishOr(this.dependencies.repository.getSandbox()), (sandbox) =>
        Boolean(sandbox.sandbox_id && sandbox.auth_token),
      ),
      {
        onNone: () => Effect.die(new Error("Sandbox is not ready")),
        onSome: (sandbox) => Effect.succeed({ ...sandbox, sandbox_id: sandbox.sandbox_id ?? "" }),
      },
    )
  }

  private getSessionSandboxPair(
    session: ReturnType<SessionRuntimeRepository["getSession"]>,
    sandbox: ReturnType<SessionRuntimeRepository["getSandbox"]>,
  ) {
    return Option.all({
      session: Option.fromNullishOr(session),
      sandbox: Option.filter(
        Option.fromNullishOr(sandbox),
        (resolvedSandbox) => typeof resolvedSandbox.sandbox_id === "string",
      ),
    }).pipe(
      Option.map(
        ({ session: resolvedSession, sandbox: resolvedSandbox }) =>
          [
            resolvedSession,
            { ...resolvedSandbox, sandbox_id: resolvedSandbox.sandbox_id ?? "" },
          ] as const,
      ),
    )
  }

  private getSyncableSandbox(
    session: ReturnType<SessionRuntimeRepository["getSession"]>,
    sandbox: ReturnType<SessionRuntimeRepository["getSandbox"]>,
  ) {
    return this.getSessionSandboxPair(session, sandbox).pipe(
      Option.filter(
        ([, resolvedSandbox]) =>
          resolvedSandbox.status === "ready" ||
          resolvedSandbox.status === "running" ||
          resolvedSandbox.status === "connecting",
      ),
    )
  }
}

export function createSandboxLifecycleManager(
  dependencies: LifecycleManagerDependencies,
): SandboxLifecycleManager {
  const provider = new HarnessContainerProvider(dependencies.env)
  return new SandboxLifecycleManager(dependencies, provider)
}
