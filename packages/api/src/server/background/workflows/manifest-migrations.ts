import {
  WORKFLOW_MANIFEST_VERSION,
  validateWorkflowDraft,
  type WorkflowManifest,
  type WorkflowManifestNode,
} from "@c0-agent/shared"

export type WorkflowManifestAuditSeverity = "info" | "warning" | "error"

export interface WorkflowManifestMigrationStep {
  fromVersion: number
  toVersion: number
  description: string
}

export interface WorkflowManifestMigrationResult {
  manifest: WorkflowManifest
  fromVersion: number
  toVersion: typeof WORKFLOW_MANIFEST_VERSION
  steps: WorkflowManifestMigrationStep[]
}

export interface WorkflowManifestAuditFinding {
  severity: WorkflowManifestAuditSeverity
  code: string
  message: string
  nodeId?: string
  path?: string
}

export interface WorkflowManifestAuditResult extends WorkflowManifestMigrationResult {
  valid: boolean
  findings: WorkflowManifestAuditFinding[]
}

type ManifestNormalizer = (input: unknown, name: string) => WorkflowManifest
type ManifestMigrationInput = (input: unknown) => unknown

interface WorkflowManifestMigrator extends WorkflowManifestMigrationStep {
  migrate: ManifestMigrationInput
}

const LEGACY_WORKFLOW_MANIFEST_VERSION = 0
const WORKFLOW_MANIFEST_VERSION_V1 = 1
const WORKFLOW_MANIFEST_VERSION_V2 = 2
const WORKFLOW_MANIFEST_VERSION_V3 = 3
const WORKFLOW_MANIFEST_VERSION_V4 = 4
const WORKFLOW_MANIFEST_MIGRATORS = new Map<number, WorkflowManifestMigrator>([
  [
    LEGACY_WORKFLOW_MANIFEST_VERSION,
    {
      fromVersion: LEGACY_WORKFLOW_MANIFEST_VERSION,
      toVersion: WORKFLOW_MANIFEST_VERSION_V1,
      description: "Normalize legacy unversioned workflow manifests to manifest v1",
      migrate(input) {
        return isRecord(input) ? { ...input, version: WORKFLOW_MANIFEST_VERSION_V1 } : input
      },
    },
  ],
  [
    WORKFLOW_MANIFEST_VERSION_V1,
    {
      fromVersion: WORKFLOW_MANIFEST_VERSION_V1,
      toVersion: WORKFLOW_MANIFEST_VERSION_V2,
      description: "Preserve R2 save nodes as text content before storage encoding support",
      migrate(input) {
        return migrateR2PutObjectEncodingToV2(input)
      },
    },
  ],
  [
    WORKFLOW_MANIFEST_VERSION_V2,
    {
      fromVersion: WORKFLOW_MANIFEST_VERSION_V2,
      toVersion: WORKFLOW_MANIFEST_VERSION_V3,
      description: "Enable workflow-hosted Slack app trigger and action node contracts",
      migrate(input) {
        return isRecord(input) ? { ...input, version: WORKFLOW_MANIFEST_VERSION_V3 } : input
      },
    },
  ],
  [
    WORKFLOW_MANIFEST_VERSION_V3,
    {
      fromVersion: WORKFLOW_MANIFEST_VERSION_V3,
      toVersion: WORKFLOW_MANIFEST_VERSION_V4,
      description: "Preserve legacy Isolate agent behavior with sub-agents disabled",
      migrate(input) {
        return migrateIsolateSubagentsToV4(input)
      },
    },
  ],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function migrateR2PutObjectEncodingToV2(input: unknown): unknown {
  if (!isRecord(input)) {
    return input
  }
  if (!Array.isArray(input.nodes)) {
    return { ...input, version: WORKFLOW_MANIFEST_VERSION_V2 }
  }

  return {
    ...input,
    version: WORKFLOW_MANIFEST_VERSION_V2,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node) || node.type !== "r2-put-object") {
        return node
      }
      const options = isRecord(node.options) ? node.options : {}
      return {
        ...node,
        options: {
          ...options,
          encoding: "text",
        },
      }
    }),
  }
}

function migrateIsolateSubagentsToV4(input: unknown): unknown {
  if (!isRecord(input)) {
    return input
  }
  if (!Array.isArray(input.nodes)) {
    return { ...input, version: WORKFLOW_MANIFEST_VERSION_V4 }
  }

  return {
    ...input,
    version: WORKFLOW_MANIFEST_VERSION_V4,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node) || node.type !== "isolate-session") {
        return node
      }
      const options = isRecord(node.options) ? node.options : {}
      return {
        ...node,
        options: {
          ...options,
          subagents: "disabled",
        },
      }
    }),
  }
}

function readManifestVersion(input: unknown): number {
  if (!isRecord(input) || typeof input.version !== "number" || !Number.isInteger(input.version)) {
    return LEGACY_WORKFLOW_MANIFEST_VERSION
  }
  return input.version
}

function assertSupportedManifestVersion(version: number): void {
  if (version > WORKFLOW_MANIFEST_VERSION) {
    throw new Error(
      `Workflow manifest version ${version} is newer than supported version ${WORKFLOW_MANIFEST_VERSION}`,
    )
  }
}

interface ManifestMigrationChain {
  migratedInput: unknown
  steps: WorkflowManifestMigrationStep[]
}

/**
 * Apply manifest migrators one version at a time until the target manifest version is reached.
 * Implemented as a tail-style recursion to preserve the exact step ordering and invariant checks
 * of the original sequential migration loop (each step advances by exactly one migrator).
 */
function applyManifestMigrationChain(
  migratedInput: unknown,
  version: number,
  steps: WorkflowManifestMigrationStep[],
): ManifestMigrationChain {
  if (version >= WORKFLOW_MANIFEST_VERSION) {
    return { migratedInput, steps }
  }
  const migrator = WORKFLOW_MANIFEST_MIGRATORS.get(version)
  if (!migrator) {
    throw new Error(`No workflow manifest migration path from version ${version}`)
  }
  const nextInput = migrator.migrate(migratedInput)
  if (migrator.toVersion <= version) {
    throw new Error(`Workflow manifest migration from version ${version} did not advance`)
  }
  return applyManifestMigrationChain(nextInput, migrator.toVersion, [
    ...steps,
    {
      fromVersion: migrator.fromVersion,
      toVersion: migrator.toVersion,
      description: migrator.description,
    },
  ])
}

export function migrateWorkflowManifestForSave(
  input: unknown,
  name: string,
  normalizeManifest: ManifestNormalizer,
): WorkflowManifestMigrationResult {
  const fromVersion = readManifestVersion(input)
  assertSupportedManifestVersion(fromVersion)

  const { migratedInput, steps } = applyManifestMigrationChain(input, fromVersion, [])

  const manifest = normalizeManifest(migratedInput, name)
  return {
    manifest,
    fromVersion,
    toVersion: WORKFLOW_MANIFEST_VERSION,
    steps,
  }
}

function scanTemplateReferences(input: {
  value: unknown
  node: WorkflowManifestNode
  path: string
  findings: WorkflowManifestAuditFinding[]
}): void {
  if (typeof input.value === "string") {
    const templatePattern = /\{\{\s*([^}]+?)\s*\}\}/g
    Array.from(input.value.matchAll(templatePattern))
      .map((match) => match[1]?.trim() ?? "")
      .filter((expression) => expression.startsWith("nodes.") || expression.startsWith("trigger."))
      .forEach((expression) => {
        input.findings.push({
          severity: "warning",
          code: "runtime-template-reference",
          nodeId: input.node.id,
          path: input.path,
          message: `Template '${expression}' depends on workflow runtime context shape`,
        })
      })
    return
  }

  if (Array.isArray(input.value)) {
    input.value.forEach((value, index) =>
      scanTemplateReferences({
        value,
        node: input.node,
        path: `${input.path}[${index}]`,
        findings: input.findings,
      }),
    )
    return
  }

  if (!isRecord(input.value)) {
    return
  }

  Object.entries(input.value).forEach(([key, value]) => {
    scanTemplateReferences({
      value,
      node: input.node,
      path: input.path ? `${input.path}.${key}` : key,
      findings: input.findings,
    })
  })
}

function classifyValidationError(message: string): WorkflowManifestAuditFinding {
  if (message.includes("unknown source handle") || message.includes("unknown target handle")) {
    return {
      severity: "error",
      code: "runtime-handle-reference",
      message,
    }
  }
  if (message.includes("template")) {
    return {
      severity: "error",
      code: "runtime-template-reference",
      message,
    }
  }
  return {
    severity: "error",
    code: "manifest-validation",
    message,
  }
}

export function auditWorkflowManifestRuntimeCompatibility(input: {
  manifest: unknown
  name?: string
  normalizeManifest: ManifestNormalizer
}): WorkflowManifestAuditResult {
  const findings: WorkflowManifestAuditFinding[] = []
  let migration: WorkflowManifestMigrationResult | null = null

  // oxlint-disable-next-line effect/avoid-try-catch -- Synchronous, non-Effect boundary that must capture throws from the injected `normalizeManifest` validator (and migration invariant checks) as audit findings. This module is intentionally kept Effect-free so the c0 control-flow rules stay inactive; wrapping in Effect would force an effect import across the whole file and change the migration ABI surface.
  try {
    migration = migrateWorkflowManifestForSave(
      input.manifest,
      input.name ?? "Workflow",
      input.normalizeManifest,
    )
  } catch (error) {
    findings.push({
      severity: "error",
      code: "manifest-migration",
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const validation = validateWorkflowDraft(migration?.manifest ?? input.manifest)
  validation.errors.forEach((message) => {
    findings.push(classifyValidationError(message))
  })

  const manifest = migration?.manifest ?? validation.manifest
  if (manifest) {
    manifest.nodes.forEach((node) => {
      scanTemplateReferences({
        value: node.options,
        node,
        path: `nodes.${node.id}.options`,
        findings,
      })
    })
  }

  return {
    manifest: manifest ?? {
      version: WORKFLOW_MANIFEST_VERSION,
      name: input.name ?? "Workflow",
      nodes: [],
      edges: [],
    },
    fromVersion: migration?.fromVersion ?? readManifestVersion(input.manifest),
    toVersion: WORKFLOW_MANIFEST_VERSION,
    steps: migration?.steps ?? [],
    valid: findings.every((finding) => finding.severity !== "error"),
    findings,
  }
}
