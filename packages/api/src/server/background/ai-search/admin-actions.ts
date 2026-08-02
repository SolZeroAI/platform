import * as Effect from "effect/Effect"
import { stringifyJson } from "../../lib/json"
import type { Env } from "../types"
import { AiSearchRegistryStore, type AiSearchSourceRecord } from "../db/ai-search"

export interface AiSearchConfigExport {
  dotenv: string
  variableCount: number
  sourceCount: number
}

function exportSourceValue(source: AiSearchSourceRecord) {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    enabled: source.enabled,
    maxResults: source.maxResults,
    dataSource: source.dataSource,
  }
}

export const exportAiSearchConfig = Effect.fn("aiSearch.exportConfig")(function* (env: Env) {
  const registry = new AiSearchRegistryStore(env)
  const sources = yield* registry.listSources()
  const lines = [
    "// AI Search sources are runtime registry data stored in C0_CONFIG KV.",
    stringifyJson({ aiSearchSources: sources.map(exportSourceValue) }),
  ]

  return {
    dotenv: `${lines.join("\n")}\n`,
    variableCount: sources.length,
    sourceCount: sources.length,
  } satisfies AiSearchConfigExport
})
