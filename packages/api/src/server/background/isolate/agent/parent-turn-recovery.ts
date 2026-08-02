import { tracing as workerTracing } from "cloudflare:workers"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { ApiRequestObserver } from "../../../effect/services/observability"
import type { Env } from "../../types"
import { compileIsolateModelContext } from "../model"
import { prepareIsolateMcpTurn, type IsolateMcpTurnManager } from "../mcpcf-turn"
import {
  clearParentTurnEnvelope,
  parentTurnEnvelopeFromPrompt,
  readParentTurnEnvelope,
  registerParentTurnEnvelope,
  setParentTurnFinalizationMode,
  type ParentTurnEnvelopeSql,
} from "./parent-turn-envelope"
import type { ActiveTurn, IsolatePromptRequest, IsolateSessionAgentState } from "./types"

const PARENT_TURN_RECOVERY_ERROR = "Unable to recover the interrupted Isolate turn."

export interface ParentTurnRecoveryHost {
  readonly state: IsolateSessionAgentState
  readonly mcp: IsolateMcpTurnManager
  activeTurn: ActiveTurn | null
  getEnv(): Env
  getRuntimeId(): string
  createInternalRequestObserver(path: string, routeBranch: string): ApiRequestObserver
}

/**
 * Owns the private recovery envelope for a parent Isolate turn. The envelope
 * is deliberately outside Agent state so it is not synchronized to clients or
 * included in session metadata. The agent keeps the Think lifecycle hooks and
 * delegates envelope handling here.
 */
export class IsolateParentTurnRecovery {
  constructor(
    private readonly host: ParentTurnRecoveryHost,
    private readonly sql: ParentTurnEnvelopeSql,
  ) {}

  registerEnvelope(request: IsolatePromptRequest, repoWarning: string | null): void {
    registerParentTurnEnvelope(this.sql, parentTurnEnvelopeFromPrompt(request, repoWarning))
  }

  clearEnvelope(): void {
    clearParentTurnEnvelope(this.sql)
  }

  setFinalizationMode(finalizingAfterStepLimit: boolean): void {
    setParentTurnFinalizationMode(this.sql, finalizingAfterStepLimit)
  }

  /** Rebuild the active turn from the durable envelope before Think replays a recovered chat. */
  recoverParentTurn(): Promise<void> {
    // oxlint-disable-next-line effect/effect-run-in-body -- Think's recovery lifecycle is a Promise boundary; runtime reconstruction remains expressed as one Effect below it.
    return Effect.runPromise(
      this.prepareRecoveredParentTurn().pipe(
        Effect.catchCause(() => Effect.die(new Error(PARENT_TURN_RECOVERY_ERROR))),
      ),
    )
  }

  /** Clear recovery state once a recovered turn produced its chat response. */
  completeRecoveredTurn(): void {
    Option.match(
      Option.liftPredicate(this.host.activeTurn, (turn) => turn?.recovered === true),
      {
        onNone: () => undefined,
        onSome: () => {
          this.clearEnvelope()
          this.host.activeTurn = null
        },
      },
    )
  }

  private prepareRecoveredParentTurn() {
    return Effect.gen({ self: this }, function* () {
      const host = this.host
      const envelope = Option.getOrThrowWith(
        readParentTurnEnvelope(this.sql),
        () => new Error(PARENT_TURN_RECOVERY_ERROR),
      )
      const selectedTools = host.state.tools ?? []
      const callback = host.activeTurn?.callback
      const [model, mcpTurn] = yield* Effect.all(
        [
          compileIsolateModelContext({
            env: host.getEnv(),
            observability: { tracing: workerTracing },
            userId: host.state.userId,
            model: envelope.requestedModel,
            reasoningEffort: envelope.reasoningEffort,
          }),
          prepareIsolateMcpTurn({
            env: host.getEnv(),
            manager: host.mcp,
            customMcpServers: host.state.customMcpServers,
            selectedTools,
            createObserver: host.createInternalRequestObserver.bind(host),
            runtime: {
              sessionId: host.getRuntimeId(),
              userId: host.state.userId,
              repoOwner: host.state.repoOwner,
              repoName: host.state.repoName,
            },
            request: {
              content: "",
              model: envelope.requestedModel,
              reasoningEffort: envelope.reasoningEffort,
            },
            callback,
          }),
        ] as const,
        { concurrency: "unbounded" },
      )

      host.activeTurn = {
        model,
        requestedModel: envelope.requestedModel,
        reasoningEffort: envelope.reasoningEffort,
        auth: { githubAccessToken: envelope.githubAccessToken },
        repoWarning: envelope.repoWarning,
        customMcpServerNames: mcpTurn.connectedServerNames,
        mcpcfMcpServers: mcpTurn.mcpcfMcpServers,
        finalizingAfterStepLimit: envelope.finalizingAfterStepLimit,
        messageId: envelope.messageId,
        callback,
        recovered: true,
      }
    })
  }
}
