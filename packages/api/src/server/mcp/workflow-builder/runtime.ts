import {
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_TEMPLATES,
  validateWorkflowDraft,
  type WorkflowDraftValidationResult,
  type WorkflowManifest,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { prefixStorageKeyWithUserId } from "../../lib/better-auth"
import type { Env } from "../../background/types"
import { decodeJsonRecord, stringifyJson } from "../../lib/json"

const WORKFLOW_BUILDER_DRAFT_TTL_SECONDS = 24 * 60 * 60

export interface WorkflowBuilderDraft {
  sessionId: string
  userId: string
  manifest: WorkflowManifest
  validation: WorkflowDraftValidationResult
  submittedAt: string
}

export interface WorkflowBuilderContext {
  env: Pick<Env, "REPOS_CACHE">
  sessionId: string
  userId: string
}

interface StoredWorkflowBuilderDraft {
  sessionId: string
  userId: string
  manifest: unknown
  submittedAt: string
}

const readStringField = (record: Record<string, unknown>, key: string) =>
  Match.value(record[key]).pipe(
    Match.when(Match.string, (value) => value),
    Match.orElse(() => ""),
  )

const logWorkflowBuilderInfo = (message: string, fields: Record<string, unknown>) =>
  Effect.logInfo(message).pipe(Effect.annotateLogs(fields))

const logWorkflowBuilderWarn = (message: string, fields: Record<string, unknown>) =>
  Effect.logWarning(message).pipe(Effect.annotateLogs(fields))

function storedDraftFromRecord(
  parsed: Record<string, unknown>,
): Option.Option<StoredWorkflowBuilderDraft> {
  const sessionId = readStringField(parsed, "sessionId")
  const userId = readStringField(parsed, "userId")
  const submittedAt = readStringField(parsed, "submittedAt")
  const complete = sessionId.length > 0 && userId.length > 0 && submittedAt.length > 0
  return Match.value(complete).pipe(
    Match.when(true, () =>
      Option.some({
        sessionId,
        userId,
        manifest: parsed.manifest,
        submittedAt,
      }),
    ),
    Match.orElse(() => Option.none<StoredWorkflowBuilderDraft>()),
  )
}

function parseStoredWorkflowBuilderDraft(raw: string): Option.Option<StoredWorkflowBuilderDraft> {
  return decodeJsonRecord(raw).pipe(Option.flatMap(storedDraftFromRecord))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Match.value(value).pipe(
    Match.when(Match.record, () => true),
    Match.orElse(() => false),
  )

const manifestFromWrapper = (wrapper: unknown) =>
  Match.value(wrapper).pipe(
    Match.when(Match.record, (record) =>
      Match.value(isRecord(record.manifest)).pipe(
        Match.when(true, () => record.manifest),
        Match.orElse(() => record),
      ),
    ),
    Match.orElse(() => wrapper),
  )

const unwrapWorkflowManifestInput = (value: unknown): unknown =>
  Match.value(value).pipe(
    Match.when(Match.record, (record) =>
      Match.value(record.kind === "c0.workflow").pipe(
        Match.when(true, () => manifestFromWrapper(record.manifest)),
        Match.orElse(() =>
          Match.value(isRecord(record.workflow)).pipe(
            Match.when(true, () => manifestFromWrapper(record.workflow)),
            Match.orElse(() =>
              Match.value(isRecord(record.draft)).pipe(
                Match.when(true, () => manifestFromWrapper(record.draft)),
                Match.orElse(() => record),
              ),
            ),
          ),
        ),
      ),
    ),
    Match.orElse(() => value),
  )

const validatedManifest = (
  validation: WorkflowDraftValidationResult,
): Option.Option<WorkflowManifest> => Option.fromNullishOr(validation.manifest)

export function getWorkflowBuilderDraftKey(input: { userId: string; sessionId: string }): string {
  return prefixStorageKeyWithUserId(
    input.userId,
    `workflow-builder-drafts/${input.sessionId}/latest.json`,
  )
}

export function getWorkflowBuilderCatalog() {
  return {
    nodes: WORKFLOW_NODE_CATALOG,
    templates: WORKFLOW_TEMPLATES,
  }
}

export const validateWorkflowBuilderManifest = Effect.fn("mcp.workflowBuilder.validateManifest")(
  function* (input: { manifest: unknown }) {
    const validation = validateWorkflowDraft(unwrapWorkflowManifestInput(input.manifest))
    yield* logWorkflowBuilderInfo("Workflow builder manifest validation", {
      valid: validation.valid,
      nodeCount: validation.manifest?.nodes.length ?? 0,
      edgeCount: validation.manifest?.edges.length ?? 0,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
    })
    return validation
  },
)

const storeWorkflowBuilderDraft = (context: WorkflowBuilderContext, draft: WorkflowBuilderDraft) =>
  Effect.tryPromise({
    try: () =>
      context.env.REPOS_CACHE.put(getWorkflowBuilderDraftKey(context), stringifyJson(draft), {
        expirationTtl: WORKFLOW_BUILDER_DRAFT_TTL_SECONDS,
      }),
    catch: (cause) => cause,
  })

const submitAcceptedWorkflowBuilderDraft = Effect.fn("mcp.workflowBuilder.submitAcceptedDraft")(
  function* (
    context: WorkflowBuilderContext,
    validation: WorkflowDraftValidationResult & { manifest: WorkflowManifest },
  ) {
    const draft: WorkflowBuilderDraft = {
      sessionId: context.sessionId,
      userId: context.userId,
      manifest: validation.manifest,
      validation,
      submittedAt: new Date().toISOString(),
    }

    yield* storeWorkflowBuilderDraft(context, draft)
    yield* logWorkflowBuilderInfo("Workflow builder draft submitted", {
      sessionId: context.sessionId,
      userId: context.userId,
      nodeCount: draft.manifest.nodes.length,
      edgeCount: draft.manifest.edges.length,
      warningCount: draft.validation.warnings.length,
      submittedAt: draft.submittedAt,
    })

    return {
      ok: true as const,
      draft: Option.some(draft),
      validation,
    }
  },
)

const rejectWorkflowBuilderDraft = (
  context: WorkflowBuilderContext,
  validation: WorkflowDraftValidationResult,
) =>
  logWorkflowBuilderWarn("Workflow builder draft rejected", {
    sessionId: context.sessionId,
    userId: context.userId,
    errors: validation.errors,
    warnings: validation.warnings,
  }).pipe(
    Effect.map(() => ({
      ok: false as const,
      draft: Option.none<WorkflowBuilderDraft>(),
      validation,
    })),
  )

export const submitWorkflowBuilderDraft = Effect.fn("mcp.workflowBuilder.submitDraft")(function* (
  context: WorkflowBuilderContext,
  input: { manifest: unknown },
) {
  const validation = validateWorkflowDraft(unwrapWorkflowManifestInput(input.manifest))
  const manifest = Match.value(validation.valid).pipe(
    Match.when(true, () => validatedManifest(validation)),
    Match.orElse(() => Option.none<WorkflowManifest>()),
  )
  return yield* Option.match(manifest, {
    onNone: () => rejectWorkflowBuilderDraft(context, validation),
    onSome: (resolvedManifest) =>
      submitAcceptedWorkflowBuilderDraft(context, { ...validation, manifest: resolvedManifest }),
  })
})

const logMissingWorkflowBuilderDraft = (context: WorkflowBuilderContext) =>
  logWorkflowBuilderInfo("Workflow builder latest draft missing", {
    sessionId: context.sessionId,
    userId: context.userId,
  }).pipe(Effect.map(() => Option.none<WorkflowBuilderDraft>()))

const logUnparsedWorkflowBuilderDraft = (context: WorkflowBuilderContext) =>
  logWorkflowBuilderWarn("Workflow builder latest draft could not be parsed", {
    sessionId: context.sessionId,
    userId: context.userId,
  }).pipe(Effect.map(() => Option.none<WorkflowBuilderDraft>()))

const logInvalidWorkflowBuilderDraft = (
  context: WorkflowBuilderContext,
  validation: WorkflowDraftValidationResult,
) =>
  logWorkflowBuilderWarn("Workflow builder latest draft invalid", {
    sessionId: context.sessionId,
    userId: context.userId,
    errors: validation.errors,
    warnings: validation.warnings,
  }).pipe(Effect.map(() => Option.none<WorkflowBuilderDraft>()))

const readValidatedWorkflowBuilderDraft = (
  context: WorkflowBuilderContext,
  stored: StoredWorkflowBuilderDraft,
  manifest: WorkflowManifest,
  validation: WorkflowDraftValidationResult,
) =>
  logWorkflowBuilderInfo("Workflow builder latest draft read", {
    sessionId: context.sessionId,
    userId: context.userId,
    nodeCount: manifest.nodes.length,
    edgeCount: manifest.edges.length,
    warningCount: validation.warnings.length,
    submittedAt: stored.submittedAt,
  }).pipe(
    Effect.map(() =>
      Option.some({
        ...stored,
        manifest,
        validation,
      }),
    ),
  )

const manifestForValidation = (validation: WorkflowDraftValidationResult) =>
  Match.value(validation.valid).pipe(
    Match.when(true, () => validatedManifest(validation)),
    Match.orElse(() => Option.none<WorkflowManifest>()),
  )

function readStoredWorkflowBuilderDraft(
  context: WorkflowBuilderContext,
  stored: StoredWorkflowBuilderDraft,
) {
  const validation = validateWorkflowDraft(stored.manifest)
  return Option.match(manifestForValidation(validation), {
    onNone: () => logInvalidWorkflowBuilderDraft(context, validation),
    onSome: (resolvedManifest) =>
      readValidatedWorkflowBuilderDraft(context, stored, resolvedManifest, validation),
  })
}

const readParsedWorkflowBuilderDraft = (context: WorkflowBuilderContext, raw: string) =>
  Option.match(parseStoredWorkflowBuilderDraft(raw), {
    onNone: () => logUnparsedWorkflowBuilderDraft(context),
    onSome: (stored) => readStoredWorkflowBuilderDraft(context, stored),
  })

export const readLatestWorkflowBuilderDraft = Effect.fn("mcp.workflowBuilder.readLatestDraft")(
  function* (context: WorkflowBuilderContext) {
    const raw = yield* Effect.tryPromise({
      try: () => context.env.REPOS_CACHE.get(getWorkflowBuilderDraftKey(context)),
      catch: (cause) => cause,
    })

    return yield* Option.match(Option.fromNullishOr(raw), {
      onNone: () => logMissingWorkflowBuilderDraft(context),
      onSome: (value) => readParsedWorkflowBuilderDraft(context, value),
    })
  },
)

/** Synchronous validation for callers that cannot thread Effect (e.g. schema decode boundaries). */
export function validateWorkflowBuilderManifestSync(input: {
  manifest: unknown
}): WorkflowDraftValidationResult {
  return validateWorkflowDraft(unwrapWorkflowManifestInput(input.manifest))
}
