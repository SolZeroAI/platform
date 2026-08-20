import type { Env } from "../types"
import type { PullRequest } from "@solzero/shared"
import type { StreamCallback } from "@cloudflare/think"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  BackgroundTracing,
  type CloudflareTracing,
  type LocalSpanContext,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- isolate runtime.ts is a composition root. It builds the tracing layer at the Effect.runPromise edge.
  makeBackgroundTracingLayer,
} from "../observability/tracing"
import {
  type IsolateCloneAuth,
  type IsolatePromptRequest,
  type IsolatePromptResult,
  type IsolateSessionConfig,
  type IsolateWarmResult,
} from "./agent"

export type {
  IsolateCloneAuth,
  IsolatePromptRequest,
  IsolatePromptResult,
  IsolateSessionConfig,
  IsolateWarmResult,
} from "./agent"

export type { LocalSpanContext }

interface IsolateSessionAgentStub {
  setName?(name: string): Promise<void> | void
  initializeSession(config: IsolateSessionConfig): Promise<{ runtimeId: string }>
  updateSessionConfig(config: Omit<IsolateSessionConfig, "userId">): Promise<{ runtimeId: string }>
  warm(auth?: IsolateCloneAuth): Promise<IsolateWarmResult>
  runPrompt(request: IsolatePromptRequest, callback?: StreamCallback): Promise<IsolatePromptResult>
  stopPrompt(): Promise<{ runtimeId: string; status: string }>
  clearSubagentRuns(): Promise<void>
  readWorkspaceFile(path: string): Promise<{ path: string; content: string }>
  writeWorkspaceFile(path: string, content: string): Promise<{ path: string; bytes: number }>
  globWorkspace(pattern?: string, limit?: number): Promise<string[]>
  searchWorkspace(
    query: string,
    pattern?: string,
    limit?: number,
  ): Promise<Array<{ path: string; excerpt: string }>>
  gitStatus(): Promise<Array<{ filepath: string; status: string }>>
  gitDiff(): Promise<Array<{ filepath: string; status: string }>>
  gitLog(depth?: number): Promise<Array<{ oid: string; message: string }>>
  gitCreatePullRequest(input: {
    title: string
    body?: string
    commitMessage?: string
  }): Promise<PullRequest>
}

interface IsolateSessionNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): unknown
}

export class IsolateSessionRuntime {
  constructor(
    private readonly env: Env,
    private readonly tracing: CloudflareTracing,
  ) {}

  private getAgent(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      const rawNamespace = (this.env as { ISOLATE_SESSION?: unknown }).ISOLATE_SESSION
      const namespace = rawNamespace as IsolateSessionNamespace | undefined
      const resolvedNamespace = yield* Option.match(Option.fromNullishOr(namespace), {
        onNone: () =>
          Effect.die(
            new Error(
              "ISOLATE_SESSION binding is not configured. Restart the API worker after regenerating Wrangler config.",
            ),
          ),
        onSome: (resolved) => Effect.succeed(resolved),
      })
      const id = resolvedNamespace.idFromName(sessionId)
      const stub = resolvedNamespace.get(id) as IsolateSessionAgentStub
      yield* Option.match(
        Option.fromNullishOr(stub.setName).pipe(
          Option.filter((setName) => typeof setName === "function"),
        ),
        {
          onNone: () => Effect.void,
          onSome: () =>
            Effect.tryPromise({
              try: () => Promise.resolve(stub.setName?.(sessionId)),
              catch: (cause) => cause,
            }),
        },
      )
      return stub
    })
  }

  initializeSession(config: IsolateSessionConfig) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(config.sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.initializeSession(config),
        catch: (cause) => cause,
      })
    })
  }

  updateSessionConfig(config: Omit<IsolateSessionConfig, "userId">) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(config.sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.updateSessionConfig(config),
        catch: (cause) => cause,
      })
    })
  }

  warm(sessionId: string, auth?: IsolateCloneAuth) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.warm(auth),
        catch: (cause) => cause,
      })
    })
  }

  private runPromptRpc(
    sessionId: string,
    request: IsolatePromptRequest,
    callback?: StreamCallback,
  ) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.runPrompt(request, callback),
        catch: (cause) => cause,
      })
    })
  }

  runPrompt(sessionId: string, request: IsolatePromptRequest, callback?: StreamCallback) {
    return Effect.gen({ self: this }, function* () {
      const backgroundTracing = yield* BackgroundTracing
      return yield* backgroundTracing.withSpan(
        "isolate.agent.rpc.run_prompt",
        {
          "session.id": sessionId,
          "message.content_length": request.content.length,
          "ai.model": request.model,
          "reasoning.effort": request.reasoningEffort ?? "",
        },
        this.runPromptRpc(sessionId, request, callback),
        { parentContext: request.observabilityTrace },
      )
    }).pipe(Effect.provide(makeBackgroundTracingLayer({ tracing: this.tracing })))
  }

  stopPrompt(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.stopPrompt(),
        catch: (cause) => cause,
      })
    })
  }

  clearSubagentRuns(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.clearSubagentRuns(),
        catch: (cause) => cause,
      })
    })
  }

  /** Cancel and delete retained sub-agent facets before an isolate session row is removed. */
  static clearSubagentRunsBeforeDelete(input: {
    env: Env
    tracing: CloudflareTracing
    sessionId: string
    agentRuntime: string | null | undefined
  }) {
    const isIsolateSession = Effect.succeed(input.agentRuntime === "isolate")
    return new IsolateSessionRuntime(input.env, input.tracing)
      .clearSubagentRuns(input.sessionId)
      .pipe(Effect.when(isIsolateSession))
  }

  readWorkspaceFile(sessionId: string, path: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.readWorkspaceFile(path),
        catch: (cause) => cause,
      })
    })
  }

  writeWorkspaceFile(sessionId: string, path: string, content: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.writeWorkspaceFile(path, content),
        catch: (cause) => cause,
      })
    })
  }

  globWorkspace(sessionId: string, pattern?: string, limit?: number) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.globWorkspace(pattern, limit),
        catch: (cause) => cause,
      })
    })
  }

  searchWorkspace(sessionId: string, query: string, pattern?: string, limit?: number) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.searchWorkspace(query, pattern, limit),
        catch: (cause) => cause,
      })
    })
  }

  gitStatus(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.gitStatus(),
        catch: (cause) => cause,
      })
    })
  }

  gitDiff(sessionId: string) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.gitDiff(),
        catch: (cause) => cause,
      })
    })
  }

  gitLog(sessionId: string, depth?: number) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.gitLog(depth),
        catch: (cause) => cause,
      })
    })
  }

  gitCreatePullRequest(
    sessionId: string,
    input: {
      title: string
      body?: string
      commitMessage?: string
    },
  ) {
    return Effect.gen({ self: this }, function* () {
      const agent = yield* this.getAgent(sessionId)
      return yield* Effect.tryPromise({
        try: () => agent.gitCreatePullRequest(input),
        catch: (cause) => cause,
      })
    })
  }
}
