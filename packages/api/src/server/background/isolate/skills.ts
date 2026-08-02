import { skills, type SkillSource } from "@cloudflare/think"
import type { SessionToolSpec } from "@c0-agent/shared"
import { listIsolateGlobalSkillNames } from "../skills/catalog"

const WORKFLOW_BUILDER_SKILL_NAME = "c0.workflow-builder"
const GLOBAL_SKILLS_PREFIX = "global/"
const USER_SKILLS_PREFIX = "user"

const WORKFLOW_BUILDER_SKILL_BODY = [
  "# c0 Workflow Builder",
  "",
  "Use this skill when a user asks you to build, edit, repair, or explain a c0 Workflow draft.",
  "",
  "## Process",
  "",
  "1. Inspect `get_workflow_node_catalog` before drafting or editing a manifest.",
  "2. Build a manifest using only supported node types, options, handles, and bindings.",
  "3. When one node needs another node's output, add an edge from the source output handle to the target input handle.",
  "4. Reference connected input values as `{{inputs.<targetHandle>}}`.",
  "5. Validate the manifest with `validate_workflow_manifest`.",
  "6. Fix every validation error before calling `submit_workflow_draft`.",
  "7. Call `submit_workflow_draft` with the final valid manifest before your final response.",
  "",
  "## Constraints",
  "",
  "- Do not use `{{nodes.*}}` or `{{trigger.*}}` templates.",
  "- Do not invent node types, handles, option keys, runtime bindings, or secret keys.",
  "- Keep storage keys portable. Do not include a userId prefix in `r2-put-object` or `kv-put` keys; the runtime adds the current user's prefix automatically.",
  "- Preserve stable node ids when editing an existing workflow unless a replacement is required.",
  "- Prefer small, understandable workflows over dense all-in-one nodes.",
  "",
  "## Final response",
  "",
  "Summarize what changed, mention any validation warnings, and do not paste the full manifest unless the user asks for it.",
].join("\n")

const WORKFLOW_BUILDER_MANIFEST_REFERENCE = [
  "# Workflow Manifest Editing Notes",
  "",
  "- Treat the current YAML or manifest context as the user's intended baseline.",
  "- Keep existing triggers, node ids, and edges unless the requested change makes them obsolete.",
  "- Add edges for data flow instead of using undeclared template variables.",
  "- Use catalog metadata as the source of truth for node options and handles.",
  "- Re-run validation after each material manifest change.",
].join("\n")

const c0BuiltInSkillSource = skills.fromManifest({
  id: "c0-built-in-skills",
  fingerprint: "c0-built-in-skills:v1",
  skills: [
    {
      name: WORKFLOW_BUILDER_SKILL_NAME,
      description:
        "Build, edit, validate, and submit c0 Workflow manifests using the workflow builder tools.",
      body: WORKFLOW_BUILDER_SKILL_BODY,
      resources: [
        {
          path: "references/manifest-editing.md",
          kind: "reference",
          mimeType: "text/markdown",
          content: WORKFLOW_BUILDER_MANIFEST_REFERENCE,
        },
      ],
    },
  ],
})

function hasWorkflowBuilderTool(tools: readonly SessionToolSpec[] | null | undefined): boolean {
  return (tools ?? []).some((tool) => tool.kind === "workflow_builder")
}

export function buildIsolateSkillSources(input: {
  tools: readonly SessionToolSpec[] | null | undefined
  skillsBucket?: R2Bucket
  userId?: string | null
  globalSkillNames?: readonly string[]
}): SkillSource[] {
  const sources: SkillSource[] = []
  if (hasWorkflowBuilderTool(input.tools)) {
    sources.push(c0BuiltInSkillSource)
  }
  if (input.skillsBucket && (input.globalSkillNames?.length ?? 0) > 0) {
    sources.push(
      skills.r2(input.skillsBucket, {
        id: "global-skills",
        prefix: GLOBAL_SKILLS_PREFIX,
        skills: [...(input.globalSkillNames ?? [])],
      }),
    )
  }
  const userSkillsPrefix = getUserSkillsPrefix(input.userId)
  if (input.skillsBucket && userSkillsPrefix) {
    sources.push(
      skills.r2(input.skillsBucket, {
        id: `user-skills:${encodeSkillSourceIdSegment(input.userId ?? "")}`,
        prefix: userSkillsPrefix,
      }),
    )
  }
  return sources
}

export async function buildResolvedIsolateSkillSources(input: {
  db: D1Database
  tools: readonly SessionToolSpec[] | null | undefined
  skillsBucket?: R2Bucket
  userId?: string | null
}): Promise<SkillSource[]> {
  const globalSkillNames = await listIsolateGlobalSkillNames({
    db: input.db,
    userId: input.userId ?? "",
  })
  return buildIsolateSkillSources({ ...input, globalSkillNames })
}

function getUserSkillsPrefix(userId: string | null | undefined): string | null {
  const normalized = userId?.trim()
  if (!normalized) {
    return null
  }
  return `${USER_SKILLS_PREFIX}/${encodeSkillPrefixSegment(normalized)}/`
}

function encodeSkillPrefixSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "~")
}

function encodeSkillSourceIdSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "_") || "unknown"
}
