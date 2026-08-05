import type {
  AdminAgentSkillCreatePayload,
  AdminAgentSkillDefaultPayload,
  AdminIdParams,
} from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import {
  AgentSkillStore,
  createAdminGlobalSkill,
  deleteGlobalSkillPackage,
  hashSkillContent,
  listAdminGlobalSkills,
  parseAgentSkillMarkdown,
} from "../../../background/skills/catalog"
import { stringifyJson } from "../../../lib/json"
import {
  ControlPlaneFailure,
  describeError,
  json,
  runControlPlane,
  type ControlPlaneContext,
} from "../shared/control-plane"
import { requireAdmin, withAudit } from "./route-helpers"

function skillFailure(cause: unknown): ControlPlaneFailure {
  const tag = Option.fromNullishOr(cause).pipe(
    Option.filter(
      (candidate): candidate is { _tag: unknown } =>
        typeof candidate === "object" && "_tag" in candidate,
    ),
    Option.map((tagged) => String(tagged._tag)),
    Option.getOrElse(() => ""),
  )
  const status = Match.value(tag).pipe(
    Match.when("AgentSkillValidationError", () => 400),
    Match.when("AgentSkillConflictError", () => 409),
    Match.when("AgentSkillNotFoundError", () => 404),
    Match.orElse(() => 500),
  )
  return new ControlPlaneFailure({ payload: { error: describeError(cause) }, status })
}

export function agentSkillAuditMetadata(skill: {
  id: string
  slug: string
  origin: string
  contentHash: string
  defaultEnabled: boolean
}): string {
  return stringifyJson({
    id: skill.id,
    slug: skill.slug,
    origin: skill.origin,
    contentHash: skill.contentHash,
    defaultEnabled: skill.defaultEnabled,
  })
}

const response = Effect.fn("admin.skills.response")(function* (context: ControlPlaneContext) {
  const skills = yield* Effect.tryPromise({
    try: () => listAdminGlobalSkills(context.env.DB),
    catch: skillFailure,
  })
  return json({ skills })
})

export function agentSkills() {
  return runControlPlane(
    Effect.fn("admin.skills.list")(function* (context: ControlPlaneContext) {
      yield* requireAdmin(context)
      return yield* response(context)
    }),
  )
}

export function createAgentSkill({ payload }: { payload: AdminAgentSkillCreatePayload }) {
  return runControlPlane(
    Effect.fn("admin.skills.create")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      const parsed = yield* Effect.try({
        try: () => parseAgentSkillMarkdown(payload.skillMd),
        catch: skillFailure,
      })
      const contentHash = yield* Effect.tryPromise({
        try: () => hashSkillContent(payload.skillMd),
        catch: skillFailure,
      })
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "agent_skill",
          targetId: parsed.name,
          action: "create",
          reason: agentSkillAuditMetadata({
            id: "new",
            slug: parsed.name,
            origin: "admin",
            contentHash,
            defaultEnabled: payload.defaultEnabled,
          }),
        },
        Effect.tryPromise({
          try: () =>
            createAdminGlobalSkill({
              db: context.env.DB,
              bucket: context.env.AGENT_SKILLS,
              skillMd: payload.skillMd,
              defaultEnabled: payload.defaultEnabled,
              adminUserId: admin.userId,
            }),
          catch: skillFailure,
        }).pipe(Effect.flatMap(() => response(context))),
      )
    }),
  )
}

export function updateAgentSkill({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminAgentSkillDefaultPayload
}) {
  return runControlPlane(
    Effect.fn("admin.skills.update")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      const store = new AgentSkillStore(context.env.DB)
      const skill = yield* store.requireActive(params.id).pipe(Effect.mapError(skillFailure))
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "agent_skill",
          targetId: params.id,
          action: "update_default",
          reason: agentSkillAuditMetadata({ ...skill, defaultEnabled: payload.defaultEnabled }),
        },
        store.setDefaultEnabled(params.id, payload.defaultEnabled).pipe(
          Effect.mapError(skillFailure),
          Effect.flatMap(() => response(context)),
        ),
      )
    }),
  )
}

export function deleteAgentSkill({ params }: { params: AdminIdParams }) {
  return runControlPlane(
    Effect.fn("admin.skills.delete")(function* (context: ControlPlaneContext) {
      const admin = yield* requireAdmin(context)
      const store = new AgentSkillStore(context.env.DB)
      const skill = yield* store.requireActive(params.id).pipe(Effect.mapError(skillFailure))
      return yield* withAudit(
        {
          context,
          admin,
          targetType: "agent_skill",
          targetId: params.id,
          action: "delete",
          reason: agentSkillAuditMetadata(skill),
        },
        store.softDelete(params.id).pipe(
          Effect.mapError(skillFailure),
          Effect.tap((skill) =>
            Effect.tryPromise(() =>
              deleteGlobalSkillPackage(context.env.AGENT_SKILLS, skill.slug),
            ).pipe(
              Effect.tapError((cause) =>
                // oxlint-disable-next-line s0-lint/warn-effect-sync-wrapper -- The request-scoped logger is an imperative service and the effect keeps it ordered with the failed cleanup.
                Effect.sync(() =>
                  context.log.error(cause, {
                    event: "admin.agent_skill.r2_cleanup_failed",
                    skillId: skill.id,
                    skillSlug: skill.slug,
                  }),
                ),
              ),
              Effect.orElseSucceed(() => undefined),
            ),
          ),
          Effect.flatMap(() => response(context)),
        ),
      )
    }),
  )
}
