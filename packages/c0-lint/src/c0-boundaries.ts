import { containsNode, literalValue, memberParts, nodeChild } from "./ast.ts"
import type { NodeLike } from "./types.ts"

const effectUtilityImportSources = new Set(["effect/Clock", "effect/DateTime"])

export function isC0RequestObservabilitySurface(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/")
  return (
    normalized.endsWith("/apps/api/index.ts") ||
    /\/apps\/api\/infra(?:\/|$)/.test(normalized) ||
    /\/packages\/api\/src\/server(?:\/|$)/.test(normalized) ||
    normalized.endsWith("/packages/api/src/http/index.ts")
  )
}

export function isC0AllowedDynamicImportBoundary(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/")
  return (
    normalized.endsWith("/packages/api/src/server/background/workflows/runner.ts") ||
    normalized.endsWith("/apps/web/src/components/c0-loader.tsx") ||
    normalized.endsWith("/apps/web/src/components/code/highlighter.ts") ||
    normalized.endsWith("/apps/web/src/routes/_authenticated.settings.tsx") ||
    normalized.endsWith("/apps/web/vite.config.ts")
  )
}

export function isC0AllowedBackendEffectBoundary(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/")
  return (
    /\/packages\/infra\/alchemy(?:\.[^.]+)?\.run\.ts$/.test(normalized) ||
    /\/packages\/infra\/src\/stacks(?:\/|$)/.test(normalized)
  )
}

export function hasEffectSignal(program: NodeLike): boolean {
  return containsNode(program, (candidate) => {
    if (candidate.type === "ImportDeclaration") {
      const source = nodeChild(candidate, "source")
      const value = literalValue(source)
      return (
        value === "effect" ||
        value === "@effect-atom/atom-react" ||
        (typeof value === "string" &&
          value.startsWith("effect/") &&
          !effectUtilityImportSources.has(value))
      )
    }
    const parts = memberParts(candidate)
    return parts?.[0] === "Effect" && parts.length > 1
  })
}
