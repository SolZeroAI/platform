import { describe, expect, it } from "vitest"
import { WORKFLOW_MANIFEST_VERSION, type WorkflowManifest } from "../../packages/shared/src"
import {
  auditWorkflowManifestRuntimeCompatibility,
  migrateWorkflowManifestForSave,
} from "../../packages/api/src/server/background/workflows/manifest-migrations"
import {
  CURRENT_WORKFLOW_RUNTIME_ABI_VERSION,
  getWorkflowRuntimeKernelModuleName,
  getWorkflowRuntimeKernelModules,
  getWorkflowRuntimeKernelSourceFingerprint,
  getWorkflowRuntimeLoaderCacheVersion,
  isWorkflowRuntimeAbiVersion,
} from "../../packages/api/src/server/background/workflows/runtime-abi"
import { normalizeWorkflowManifest } from "../../packages/api/src/server/background/workflows/manifest"

function manifest(overrides: Partial<WorkflowManifest> = {}): WorkflowManifest {
  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name: "ABI workflow",
    nodes: [
      {
        id: "manual",
        type: "manual-trigger",
        label: "Manual",
        position: { x: 0, y: 0 },
        options: {},
      },
      {
        id: "notify",
        type: "slack-send-message",
        label: "Notify",
        position: { x: 200, y: 0 },
        options: {
          channel: "#ops",
          text: "Manual workflow fired",
        },
      },
    ],
    edges: [
      {
        id: "manual-notify",
        source: "manual",
        target: "notify",
        sourceHandle: "payload",
        targetHandle: "text",
      },
    ],
    ...overrides,
  }
}

describe("workflow runtime ABI registry", () => {
  it("exposes immutable runtime kernel modules and selects the current Slack-aware ABI", () => {
    expect(CURRENT_WORKFLOW_RUNTIME_ABI_VERSION).toBe(2)
    expect(isWorkflowRuntimeAbiVersion(1)).toBe(true)
    expect(isWorkflowRuntimeAbiVersion(2)).toBe(true)
    expect(isWorkflowRuntimeAbiVersion(3)).toBe(false)
    expect(getWorkflowRuntimeKernelModuleName(1)).toBe("workflow-runtime-kernel.v1.js")
    expect(getWorkflowRuntimeKernelModuleName(2)).toBe("workflow-runtime-kernel.v2.js")
    expect(Object.keys(getWorkflowRuntimeKernelModules())).toEqual([
      "workflow-runtime-kernel.v1.js",
      "workflow-runtime-kernel.v2.js",
    ])
  })

  it("includes the runtime kernel source fingerprint in the loader cache version", () => {
    const modules = getWorkflowRuntimeKernelModules()
    const fingerprint = getWorkflowRuntimeKernelSourceFingerprint(modules)

    expect(getWorkflowRuntimeLoaderCacheVersion()).toBe(`runtime-abi-1-2-${fingerprint}`)
    expect(fingerprint).toMatch(/^[a-z0-9]+$/)
    expect(
      getWorkflowRuntimeKernelSourceFingerprint({
        ...modules,
        "workflow-runtime-kernel.v1.js": `${modules["workflow-runtime-kernel.v1.js"]}\n// cache bust`,
      }),
    ).not.toBe(fingerprint)
  })
})

describe("workflow manifest runtime migrations", () => {
  it("keeps current manifests explicit and unchanged", () => {
    const current = manifest()
    expect(
      migrateWorkflowManifestForSave(current, current.name, normalizeWorkflowManifest),
    ).toMatchObject({
      manifest: current,
      fromVersion: WORKFLOW_MANIFEST_VERSION,
      toVersion: WORKFLOW_MANIFEST_VERSION,
      steps: [],
    })
  })

  it("migrates legacy unversioned manifests before save", () => {
    const legacy = { ...manifest(), version: undefined }

    expect(
      migrateWorkflowManifestForSave(legacy, legacy.name, normalizeWorkflowManifest),
    ).toMatchObject({
      manifest: { ...legacy, version: WORKFLOW_MANIFEST_VERSION },
      fromVersion: 0,
      toVersion: WORKFLOW_MANIFEST_VERSION,
      steps: [
        {
          fromVersion: 0,
          toVersion: 1,
          description: "Normalize legacy unversioned workflow manifests to manifest v1",
        },
        {
          fromVersion: 1,
          toVersion: 2,
          description: "Preserve R2 save nodes as text content before storage encoding support",
        },
        {
          fromVersion: 2,
          toVersion: 3,
          description: "Enable workflow-hosted Slack app trigger and action node contracts",
        },
        {
          fromVersion: 3,
          toVersion: WORKFLOW_MANIFEST_VERSION,
          description: "Preserve legacy Isolate agent behavior with sub-agents disabled",
        },
      ],
    })
  })

  it("migrates v1 R2 save nodes to explicit text encoding", () => {
    const v1Manifest = {
      version: 1,
      name: "R2 migration workflow",
      nodes: [
        {
          id: "manual",
          type: "manual-trigger",
          label: "Manual",
          position: { x: 0, y: 0 },
          options: {},
        },
        {
          id: "save",
          type: "r2-put-object",
          label: "Save image",
          position: { x: 200, y: 0 },
          options: {
            bucket: "WORKFLOW_BUCKET",
            key: "outputs/{{runId}}/image.png",
            contentType: "image/png",
            encoding: "base64",
          },
        },
      ],
      edges: [
        {
          id: "manual-save",
          source: "manual",
          target: "save",
          sourceHandle: "payload",
          targetHandle: "content",
        },
      ],
    }

    const migration = migrateWorkflowManifestForSave(
      v1Manifest,
      v1Manifest.name,
      normalizeWorkflowManifest,
    )

    expect(migration).toMatchObject({
      fromVersion: 1,
      toVersion: WORKFLOW_MANIFEST_VERSION,
      steps: [
        {
          fromVersion: 1,
          toVersion: 2,
          description: "Preserve R2 save nodes as text content before storage encoding support",
        },
        {
          fromVersion: 2,
          toVersion: 3,
          description: "Enable workflow-hosted Slack app trigger and action node contracts",
        },
        {
          fromVersion: 3,
          toVersion: WORKFLOW_MANIFEST_VERSION,
          description: "Preserve legacy Isolate agent behavior with sub-agents disabled",
        },
      ],
    })
    expect(migration.manifest.version).toBe(WORKFLOW_MANIFEST_VERSION)
    expect(migration.manifest.nodes.find((node) => node.id === "save")?.options).toMatchObject({
      encoding: "text",
    })
  })

  it("migrates v3 Isolate nodes to an explicit disabled sub-agent mode", () => {
    const v3Manifest = {
      version: 3,
      name: "Legacy agent workflow",
      nodes: [
        {
          id: "isolate",
          type: "isolate-session",
          label: "Isolate",
          position: { x: 0, y: 0 },
          options: { model: "litellm/gpt-5.4-mini", subagents: "enabled" },
        },
        {
          id: "sandbox",
          type: "sandbox-session",
          label: "Sandbox",
          position: { x: 200, y: 0 },
          options: { model: "litellm/gpt-5.4-mini" },
        },
      ],
      edges: [],
    }

    const migration = migrateWorkflowManifestForSave(
      v3Manifest,
      v3Manifest.name,
      normalizeWorkflowManifest,
    )

    expect(migration.steps).toEqual([
      {
        fromVersion: 3,
        toVersion: WORKFLOW_MANIFEST_VERSION,
        description: "Preserve legacy Isolate agent behavior with sub-agents disabled",
      },
    ])
    expect(migration.manifest.nodes.find((node) => node.id === "isolate")?.options).toMatchObject({
      model: "litellm/gpt-5.4-mini",
      subagents: "disabled",
    })
    expect(
      migration.manifest.nodes.find((node) => node.id === "sandbox")?.options,
    ).not.toHaveProperty("subagents")
  })

  it("rejects manifests from unsupported future versions", () => {
    expect(() =>
      migrateWorkflowManifestForSave(
        {
          ...manifest(),
          version: WORKFLOW_MANIFEST_VERSION + 1,
        },
        "Future",
        normalizeWorkflowManifest,
      ),
    ).toThrow("newer than supported version")
  })

  it("validates the migrated manifest when auditing", () => {
    const invalidLegacyManifest = {
      ...manifest({
        edges: [
          {
            id: "manual-notify",
            source: "manual",
            target: "notify",
            sourceHandle: "renamed-payload",
            targetHandle: "text",
          },
        ],
      }),
      version: 0,
    }
    const migratedManifest = manifest()

    const audit = auditWorkflowManifestRuntimeCompatibility({
      manifest: invalidLegacyManifest,
      normalizeManifest: () => migratedManifest,
    })

    expect(audit).toMatchObject({
      valid: true,
      manifest: migratedManifest,
      fromVersion: 0,
      steps: [
        {
          fromVersion: 0,
          toVersion: 1,
        },
        {
          fromVersion: 1,
          toVersion: 2,
        },
        {
          fromVersion: 2,
          toVersion: 3,
        },
        {
          fromVersion: 3,
          toVersion: WORKFLOW_MANIFEST_VERSION,
        },
      ],
    })
    expect(audit.findings).toEqual([])
  })

  it("reports the v3 sub-agent compatibility migration in runtime audits", () => {
    const audit = auditWorkflowManifestRuntimeCompatibility({
      manifest: {
        version: 3,
        name: "Legacy Isolate",
        nodes: [
          {
            id: "agent",
            type: "isolate-session",
            label: "Agent",
            position: { x: 0, y: 0 },
            options: { model: "litellm/gpt-5.4-mini" },
          },
        ],
        edges: [],
      },
      normalizeManifest: normalizeWorkflowManifest,
    })

    expect(audit.valid).toBe(true)
    expect(audit.steps).toEqual([
      expect.objectContaining({ fromVersion: 3, toVersion: WORKFLOW_MANIFEST_VERSION }),
    ])
    expect(audit.manifest.nodes[0]?.options.subagents).toBe("disabled")
  })

  it("audits runtime template references for explicit migration review", () => {
    const audit = auditWorkflowManifestRuntimeCompatibility({
      manifest: manifest({
        nodes: [
          {
            id: "manual",
            type: "manual-trigger",
            label: "Manual",
            position: { x: 0, y: 0 },
            options: {},
          },
          {
            id: "notify",
            type: "slack-send-message",
            label: "Notify",
            position: { x: 200, y: 0 },
            options: {
              channel: "#ops",
              text: "{{nodes.manual.payload}}",
            },
          },
        ],
      }),
      normalizeManifest: normalizeWorkflowManifest,
    })

    expect(audit.valid).toBe(false)
    expect(audit.findings).toContainEqual(
      expect.objectContaining({
        code: "runtime-template-reference",
      }),
    )
  })

  it("reports renamed or invalid handles as runtime contract findings", () => {
    const audit = auditWorkflowManifestRuntimeCompatibility({
      manifest: manifest({
        edges: [
          {
            id: "manual-notify",
            source: "manual",
            target: "notify",
            sourceHandle: "renamed-payload",
            targetHandle: "text",
          },
        ],
      }),
      normalizeManifest: normalizeWorkflowManifest,
    })

    expect(audit.valid).toBe(false)
    expect(audit.findings).toContainEqual(
      expect.objectContaining({
        code: "runtime-handle-reference",
        severity: "error",
      }),
    )
  })
})
