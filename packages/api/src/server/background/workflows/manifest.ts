import { validateWorkflowDraft, type WorkflowManifest } from "@solzero/shared"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function normalizeWorkflowManifest(input: unknown, name: string): WorkflowManifest {
  const manifestInput = isRecord(input) ? { ...input, name } : input
  const validation = validateWorkflowDraft(manifestInput)
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.errors[0] ?? "Invalid workflow manifest")
  }
  return validation.manifest
}
