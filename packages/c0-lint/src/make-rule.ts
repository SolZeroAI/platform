import { defineRule } from "@oxlint/plugins"
import type { Context, Rule, Visitor } from "@oxlint/plugins"
import {
  hasEffectSignal,
  isC0AllowedBackendEffectBoundary,
  isC0RequestObservabilitySurface,
} from "./c0-boundaries.ts"
import { messages } from "./messages.ts"
import type { C0RuleName } from "./rule-names.ts"
import type { NodeLike, RuleReporter, RuleRuntime, VisitorMap } from "./types.ts"

export function makeRule(
  name: C0RuleName,
  createVisitors: (runtime: RuleRuntime, context: Context) => VisitorMap,
  options: {
    description?: string
    requiresEffectFile?: boolean
    requiresC0RequestObservabilitySurface?: boolean
  } = {},
): Rule {
  const requiresEffectFile = options.requiresEffectFile ?? true
  const requiresC0RequestObservabilitySurface =
    options.requiresC0RequestObservabilitySurface ?? false
  return defineRule({
    meta: {
      type: "suggestion",
      docs: {
        description: options.description ?? messages[name],
      },
      schema: [],
    },
    createOnce(context: Context) {
      let effectFile = false
      let matchingFile = false
      const report: RuleReporter = (node, message = messages[name]) => {
        context.report({ node, message })
      }
      const runtime: RuleRuntime = {
        report,
        shouldRun: () => matchingFile && (!requiresEffectFile || effectFile),
      }
      return {
        before() {
          effectFile = false
          const allowedBackendBoundary = isC0AllowedBackendEffectBoundary(context.filename)
          matchingFile =
            !allowedBackendBoundary &&
            (!requiresC0RequestObservabilitySurface ||
              isC0RequestObservabilitySurface(context.filename))
        },
        Program(node: NodeLike) {
          effectFile = hasEffectSignal(node)
        },
        ...createVisitors(runtime, context),
      } as unknown as Visitor
    },
  })
}
