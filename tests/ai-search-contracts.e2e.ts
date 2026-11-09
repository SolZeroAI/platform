import { describe, expect, test } from "e2e"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import {
  AdminAiSearchSourcePayload,
  AdminAiSearchDataSource,
} from "../packages/api/src/http/schemas/admin"
import { readAiSearchSourceRecord } from "../packages/api/src/server/background/db/ai-search-records"
import {
  validateWorkflowDraft,
  getStageMetadataFromConfigSync,
  resolveS0Config,
} from "@solzero/shared"
import { exampleDeploymentConfig } from "./support/deployment-config"

const source = {
  id: "migration-original",
  label: "Original source",
  description: "Retain until verified",
  enabled: true,
  maxResults: 5,
  createdAt: 1700000000000,
  updatedAt: 1700000000001,
}

const legacySources = [
  { type: "r2", bucketName: "original-documents", prefix: "knowledge/", r2Jurisdiction: null },
  {
    type: "website",
    domain: "docs.example.test",
    includePaths: ["/docs/*"],
    excludePaths: ["/private/*"],
    specificSitemaps: ["https://docs.example.test/sitemap.xml"],
    useBrowserRendering: true,
    includeImages: true,
  },
]

describe("AI Search source transition", { platforms: ["tools"] }, () => {
  test("local AI Search is opt-in and standing stages retain their namespace bindings", async () => {
    const base = exampleDeploymentConfig()
    const config = resolveS0Config(base)

    expect(
      getStageMetadataFromConfigSync("dev", config.deployment, config.application).infra
        .aiSearchNamespaceEnabled,
    ).toBe(false)
    expect(
      getStageMetadataFromConfigSync("pre", config.deployment, config.application).infra
        .aiSearchNamespaceEnabled,
    ).toBe(true)

    const local = resolveS0Config({
      ...base,
      deployment: { ...base.deployment, aiSearchEnabledInDev: true },
    })

    expect(
      getStageMetadataFromConfigSync("dev", local.deployment, local.application).infra
        .aiSearchNamespaceEnabled,
    ).toBe(true)
  })

  test("new source requests accept built-in storage and reject external storage", async () => {
    const decode = Schema.decodeUnknownSync(AdminAiSearchSourcePayload)

    expect(decode({ ...source, dataSource: { type: "built-in" } }).dataSource.type).toBe("built-in")

    for (const dataSource of legacySources) {
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(AdminAiSearchSourcePayload)({ ...source, dataSource }),
        ),
      ).toBe(true)
    }
  })

  test("legacy records retain identity, timestamps and all source details for export", async () => {
    for (const dataSource of legacySources) {
      const original = { ...source, dataSource }
      const snapshot = JSON.stringify(original)
      const parsed = readAiSearchSourceRecord(original)

      expect(Option.isSome(parsed)).toBe(true)
      expect(Option.getOrThrow(parsed)).toEqual(original)
      expect(Schema.decodeUnknownSync(AdminAiSearchDataSource)(dataSource)).toEqual(dataSource)
      expect(JSON.stringify(original)).toBe(snapshot)
    }
  })

  test("the upload node compiles as an additive action while existing R2 nodes remain valid", async () => {
    for (const action of [
      {
        type: "ai-search-upload" as const,
        options: { aiSearchSourceId: "knowledge", name: "document.txt" },
      },
      {
        type: "r2-put-object" as const,
        options: { bucket: "AI_SEARCH_CONTENT_BUCKET", key: "original.txt" },
      },
      {
        type: "r2-put-object" as const,
        options: { bucket: "WORKFLOW_BUCKET", key: "artifact.txt" },
      },
    ]) {
      const result = validateWorkflowDraft({
        version: 4,
        name: "Ingestion compatibility",
        nodes: [
          {
            id: "start",
            type: "manual-trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            options: {},
          },
          { id: "upload", ...action, label: "Upload", position: { x: 300, y: 0 } },
        ],
        edges: [
          {
            id: "content",
            source: "start",
            target: "upload",
            sourceHandle: "payload",
            targetHandle: "content",
          },
        ],
      })

      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
      expect(result.manifest?.nodes[1].type).toBe(action.type)
      expect(result.manifest?.nodes[1].options).toEqual(action.options)
    }
  })
})
