import { defineRule } from "@oxlint/plugins"
import type { Context, Rule, Visitor } from "@oxlint/plugins"
import {
  hasEffectSignal,
  isS0AllowedBackendEffectBoundary,
  isS0RequestObservabilitySurface,
} from "./s0-boundaries.ts"
import { messages } from "./messages.ts"
import type { S0RuleName } from "./rule-names.ts"
import type { NodeLike, RuleReporter, RuleRuntime, VisitorMap } from "./types.ts"

export function makeRule(
  name: S0RuleName,
  createVisitors: (runtime: RuleRuntime, context: Context) => VisitorMap,
  options: {
    description?: string
    requiresEffectFile?: boolean
    requiresS0RequestObservabilitySurface?: boolean
  } = {},
): Rule {
  const requiresEffectFile = options.requiresEffectFile ?? true

  const requiresS0RequestObservabilitySurface =
    options.requiresS0RequestObservabilitySurface ?? false

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

      const visitor = {
        before() {
          effectFile = false
          const allowedBackendBoundary = isS0AllowedBackendEffectBoundary(context.filename)
          matchingFile =
            !allowedBackendBoundary &&
            (!requiresS0RequestObservabilitySurface ||
              isS0RequestObservabilitySurface(context.filename))
        },
        Program(node: NodeLike) {
          effectFile = hasEffectSignal(node)
        },
        ...createVisitors(runtime, context),
      }

      // SAFETY: oxlint invokes before, Program, and the hooks this rule registers.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- oxlint's Visitor type is a dependency type this partial visitor does not satisfy.
      return visitor as unknown as Visitor
    },
  })
}
