import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { generateId } from "../../../background/auth/crypto"
import { AdminStore } from "../../../background/db/admin"
import { isAdminEmailForEnv } from "../../../background/db/admin-config"
import { describeError } from "../../../lib/effect-errors"
import {
  ControlPlaneFailure,
  failUnless,
  requireOption,
  resolveUserIdentity,
  type ControlPlaneContext,
} from "../shared/control-plane"

export interface AdminIdentity {
  userId: string
  email: string
}

interface AuditInput {
  context: ControlPlaneContext
  admin: AdminIdentity
  targetType: string
  targetId: string
  action: string
  reason?: string | null
}

function auditResult(ok: boolean): "success" | "failed" {
  return Match.value(ok).pipe(
    Match.when(true, () => "success" as const),
    Match.orElse(() => "failed" as const),
  )
}

function controlPlaneFailureStatus(failure: unknown): number {
  return Match.value(failure).pipe(
    Match.when(Match.instanceOf(ControlPlaneFailure), (cpf) => cpf.status),
    Match.orElse(() => 500),
  )
}

function isErrorPayload(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  )
}

function describePayload(payload: unknown): string {
  return Match.value(payload).pipe(
    Match.when(isErrorPayload, (value) => value.error),
    Match.orElse(() => "Request failed"),
  )
}

function failureMessage(failure: unknown): string {
  return Match.value(failure).pipe(
    Match.when(Match.instanceOf(ControlPlaneFailure), (cpf) => describePayload(cpf.payload)),
    Match.orElse(() => describeError(failure)),
  )
}

const readResponseMessage = Effect.fn("admin.readResponseMessage")(function* (response: Response) {
  const text = yield* Effect.tryPromise(() => response.clone().text()).pipe(
    Effect.orElseSucceed(() => ""),
  )
  const message = text || response.statusText
  return Option.fromNullishOr(message).pipe(Option.filter((value) => value.length > 0))
})

const responseMessage = Effect.fn("admin.responseMessage")(function* (response: Response) {
  return yield* Match.value(response.ok).pipe(
    Match.when(true, () => Effect.succeed(Option.none<string>())),
    Match.orElse(() => readResponseMessage(response)),
  )
})

export const requireAdmin = Effect.fn("admin.requireAdmin")(function* (
  context: ControlPlaneContext,
) {
  const identity = yield* resolveUserIdentity(
    context.request,
    context.env,
    context.principal,
    context.identityProvider,
  )
  const email = yield* requireOption(Option.fromNullishOr(identity.email), "Forbidden", 403)
  yield* failUnless(yield* isAdminEmailForEnv(context.env, email), "Forbidden", 403)
  return { userId: identity.userId, email } satisfies AdminIdentity
})

export const resolveAdminAccess = Effect.fn("admin.resolveAdminAccess")(function* (
  context: ControlPlaneContext,
) {
  const identity = yield* resolveUserIdentity(
    context.request,
    context.env,
    context.principal,
    context.identityProvider,
  )
  return yield* isAdminEmailForEnv(context.env, identity.email)
})

const recordAdminAudit = Effect.fn("admin.recordAdminAudit")(function* (
  store: AdminStore,
  input: AuditInput,
  result: "success" | "failed",
  status: number,
  message: string | null,
) {
  yield* store.recordAudit({
    id: `aae_${generateId(12)}`,
    adminUserId: input.admin.userId,
    adminEmail: input.admin.email,
    targetType: input.targetType,
    targetId: input.targetId,
    action: input.action,
    reason: input.reason,
    result,
    status,
    message,
    createdAt: Date.now(),
  })
})

const auditSuccess = Effect.fn("admin.auditSuccess")(function* (
  store: AdminStore,
  input: AuditInput,
  response: Response,
) {
  const messageOption = yield* responseMessage(response)
  yield* recordAdminAudit(
    store,
    input,
    auditResult(response.ok),
    response.status,
    Option.getOrNull(messageOption),
  )
})

const auditFailure = Effect.fn("admin.auditFailure")(function* (
  store: AdminStore,
  input: AuditInput,
  failure: unknown,
) {
  yield* recordAdminAudit(
    store,
    input,
    "failed",
    controlPlaneFailureStatus(failure),
    failureMessage(failure),
  )
})

export const withAudit = <R>(
  input: AuditInput,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic audited-perform contract: the perform Effect channels must be named explicitly here.
  perform: Effect.Effect<Response, unknown, R>,
) =>
  Effect.gen(function* () {
    const store = new AdminStore(input.context.db)
    return yield* perform.pipe(
      Effect.tap((response) => auditSuccess(store, input, response)),
      Effect.tapError((failure) => auditFailure(store, input, failure)),
    )
  })
