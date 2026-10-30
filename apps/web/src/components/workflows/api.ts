import type {
  WorkflowSaveResponse as ApiWorkflowSaveResponse,
  WorkflowSummary as ApiWorkflowSummary,
} from "@solzero/api"
import type { WorkflowManifest } from "@solzero/shared"
import * as Predicate from "effect/Predicate"
import type { WorkflowSaveResponse, WorkflowSummary } from "./types"

/**
 * Whether the stored manifest JSON has the manifest's top-level shape. The builder migrates a
 * manifest from an older version with migrateWorkflowManifestForBuilder before it reads the nodes,
 * so this check does not pin the node options.
 */
function isStoredWorkflowManifest(
  value: ApiWorkflowSummary["manifest"],
): value is NonNullable<ApiWorkflowSummary["manifest"]> & WorkflowManifest {
  return (
    Predicate.hasProperty(value, "name") &&
    Predicate.isString(value.name) &&
    Predicate.hasProperty(value, "nodes") &&
    Array.isArray(value.nodes) &&
    Predicate.hasProperty(value, "edges") &&
    Array.isArray(value.edges)
  )
}

/** The builder's view of a workflow the API returned. */
export function toWorkflowSummary(workflow: ApiWorkflowSummary): WorkflowSummary {
  const { manifest, ...summary } = workflow

  return isStoredWorkflowManifest(manifest) ? { ...summary, manifest } : summary
}

export function toWorkflowSaveResponse(data: ApiWorkflowSaveResponse): WorkflowSaveResponse {
  return {
    workflow: toWorkflowSummary(data.workflow),
    manifestMigration: { ...data.manifestMigration, steps: [...data.manifestMigration.steps] },
  }
}
