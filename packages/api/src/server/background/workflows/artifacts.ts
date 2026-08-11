import type { Env } from "../types"
import type { WorkflowManifest } from "@solzero/shared"
import { prefixStorageKeyWithUserId } from "../../lib/better-auth"
import { toError } from "../../lib/effect-errors"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

/** Failure raised when a workflow manifest/code artifact is missing from the bucket. */
export class WorkflowArtifactError extends Schema.TaggedErrorClass<WorkflowArtifactError>()(
  "WorkflowArtifactError",
  {
    message: Schema.String,
  },
) {}

export function getWorkflowManifestKey(input: {
  userId: string
  workflowId: string
  version: number
}): string {
  return prefixStorageKeyWithUserId(
    input.userId,
    `workflows/${input.workflowId}/v${input.version}/manifest.json`,
  )
}

export function getWorkflowCodeKey(input: {
  userId: string
  workflowId: string
  version: number
}): string {
  return prefixStorageKeyWithUserId(
    input.userId,
    `workflows/${input.workflowId}/v${input.version}/workflow.js`,
  )
}

export const writeWorkflowArtifacts = Effect.fn("workflows.writeArtifacts")(function* (input: {
  env: Env
  manifest: WorkflowManifest
  code: string
  userId: string
  workflowId: string
  version: number
}) {
  const manifestKey = getWorkflowManifestKey(input)
  const codeKey = getWorkflowCodeKey(input)

  yield* Effect.all(
    [
      Effect.tryPromise({
        try: () =>
          // oxlint-disable-next-line effect/avoid-direct-json -- Persists the workflow manifest artifact with exact 2-space pretty-printing that is read back as the stored artifact; the sanctioned `stringifyJson` helper is compact and would change persisted artifact bytes.
          input.env.WORKFLOW_BUCKET.put(manifestKey, JSON.stringify(input.manifest, null, 2), {
            httpMetadata: { contentType: "application/json" },
          }),
        catch: toError,
      }),
      Effect.tryPromise({
        try: () =>
          input.env.WORKFLOW_BUCKET.put(codeKey, input.code, {
            httpMetadata: { contentType: "application/javascript" },
          }),
        catch: toError,
      }),
    ],
    { concurrency: "unbounded" },
  )

  return { manifestKey, codeKey }
})

export const readWorkflowManifest = Effect.fn("workflows.readManifest")(function* (
  env: Env,
  key: string,
) {
  const object = yield* Effect.tryPromise({
    try: () => env.WORKFLOW_BUCKET.get(key),
    catch: toError,
  })
  return yield* Match.value(object).pipe(
    Match.when(Match.null, () =>
      Effect.fail(
        new WorkflowArtifactError({ message: `Workflow manifest artifact '${key}' was not found` }),
      ),
    ),
    Match.orElse((resolved) =>
      Effect.tryPromise({
        try: () => resolved.json() as Promise<WorkflowManifest>,
        catch: toError,
      }),
    ),
  )
})

export const readWorkflowCode = Effect.fn("workflows.readCode")(function* (env: Env, key: string) {
  const object = yield* Effect.tryPromise({
    try: () => env.WORKFLOW_BUCKET.get(key),
    catch: toError,
  })
  return yield* Match.value(object).pipe(
    Match.when(Match.null, () =>
      Effect.fail(
        new WorkflowArtifactError({ message: `Workflow code artifact '${key}' was not found` }),
      ),
    ),
    Match.orElse((resolved) =>
      Effect.tryPromise({
        try: () => resolved.text(),
        catch: toError,
      }),
    ),
  )
})

/**
 * Promise-facing read of the compiled workflow code artifact for the non-Effect dynamic workflow
 * runner loader, which deliberately stays Effect-free to keep its imperative Worker-loader path
 * lint-clean. Runs the underlying Effect at this boundary.
 */
export function readWorkflowCodePromise(env: Env, key: string): Promise<string> {
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging Effect artifact reads to the non-Effect dynamic workflow runner loader (Worker loader entry).
  return Effect.runPromise(readWorkflowCode(env, key))
}
