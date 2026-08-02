import { defineRule, type Rule, type Visitor } from "@oxlint/plugins"
import {
  bareErrorConstructors,
  callArguments,
  effectCallMethod,
  findDescendant,
  firstNestedEffectCall,
  functionBody,
  hasCallbackReturning,
  hasEffectCall,
  hasNullishUnionMember,
  hasSequencingCall,
  hasSideEffectCall,
  isBranchCall,
  isCallExpression,
  isCallTo,
  isConsoleAccess,
  isConsoleCall,
  isEffectCall,
  isEffectMember,
  isEffectVoid,
  isIife,
  isInsideEffectHandler,
  isMatchValuePipe,
  isNode,
  isNodeType,
  isNullableLocalOrReturnType,
  isPipeCall,
  isSchemaFilterCall,
  nodeChild,
  nodeChildren,
  parentCall,
  propertyKeyName,
  propertyValue,
  returnStatements,
  typeNameText,
} from "./ast.ts"
import { isC0AllowedDynamicImportBoundary } from "./c0-boundaries.ts"
import { makeRule } from "./make-rule.ts"
import { messages } from "./messages.ts"
import type { C0RuleName } from "./rule-names.ts"
import type { NodeLike } from "./types.ts"

const MAX_AUTHORED_FILE_LINES = 1000

function shouldIgnoreFileLineCount(filename: string) {
  return ["/node_modules/", "/dist/", "/.alchemy/", "/.output/", "/coverage/"].some((segment) =>
    filename.includes(segment),
  )
}

function programEndLine(node: NodeLike) {
  const loc = node.loc as { end?: { line?: number } } | undefined
  return loc?.end?.line ?? 0
}

export const rules: Record<C0RuleName, Rule> = {
  "max-file-lines": defineRule({
    meta: {
      type: "suggestion",
      docs: {
        description: messages["max-file-lines"],
      },
      schema: [],
    },
    createOnce(context) {
      return {
        Program(node: NodeLike) {
          const lineCount = programEndLine(node)
          if (lineCount > MAX_AUTHORED_FILE_LINES && !shouldIgnoreFileLineCount(context.filename)) {
            context.report({
              node,
              message: `${messages["max-file-lines"]} This file has ${lineCount} lines.`,
            })
          }
        },
      } as unknown as Visitor
    },
  }),
  "no-if-statement": makeRule("no-if-statement", ({ report, shouldRun }) => ({
    IfStatement(node) {
      if (shouldRun()) {
        report(nodeChild(node, "test") ?? node)
      }
    },
  })),
  "no-ternary": makeRule("no-ternary", ({ report, shouldRun }) => ({
    ConditionalExpression(node) {
      if (shouldRun()) {
        report(nodeChild(node, "test") ?? node)
      }
    },
  })),
  "no-pipe-ladder": makeRule("no-pipe-ladder", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isPipeCall(node)) {
        return
      }
      const nested = callArguments(node)
        .map((argument) => findDescendant(argument, isPipeCall))
        .find(isNode)
      if (nested) {
        report(nested)
      }
    },
  })),
  "no-flatmap-ladder": makeRule("no-flatmap-ladder", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun()) {
        return
      }
      if (
        isEffectCall(node, "flatMap") &&
        callArguments(node).some((argument) => hasEffectCall(argument, "flatMap"))
      ) {
        report(node)
      }
      if (
        isEffectCall(node, "flatten") &&
        callArguments(node).some((argument) => hasEffectCall(argument, "map"))
      ) {
        report(
          node,
          "Rule: avoid map+flatten ladders. Why: they hide sequencing. Fix: build context once (Effect.all/Effect.map) and run a single flatMap.",
        )
      }
    },
  })),
  "no-effect-ladder": makeRule("no-effect-ladder", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isEffectCall(node)) {
        return
      }
      const firstArgument = callArguments(node)[0]
      if (isEffectCall(firstArgument) && firstNestedEffectCall(firstArgument)) {
        report(node)
      }
    },
  })),
  "no-effect-call-in-effect-arg": makeRule(
    "no-effect-call-in-effect-arg",
    ({ report, shouldRun }) => ({
      CallExpression(node) {
        if (
          shouldRun() &&
          isEffectCall(node) &&
          callArguments(node).some((argument) => isEffectCall(argument))
        ) {
          report(node)
        }
      },
    }),
  ),
  "no-nested-effect-call": makeRule("no-nested-effect-call", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isEffectCall(node)) {
        return
      }
      const firstArgument = callArguments(node)[0]
      if (isEffectCall(firstArgument) && firstNestedEffectCall(firstArgument)) {
        report(node)
      }
    },
  })),
  "no-effect-as": makeRule("no-effect-as", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (shouldRun() && isEffectCall(node, "as")) {
        report(node)
      }
    },
  })),
  "no-call-tower": makeRule("no-call-tower", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (
        shouldRun() &&
        isEffectCall(node) &&
        callArguments(node).some((argument) => isEffectCall(argument))
      ) {
        report(node)
      }
    },
  })),
  "no-option-as": makeRule("no-option-as", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (shouldRun() && isCallTo(node, "Option", "as")) {
        report(node)
      }
    },
  })),
  "no-arrow-ladder": makeRule("no-arrow-ladder", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isIife(node)) {
        return
      }
      const nested = findDescendant(
        functionBody(nodeChild(node, "callee")),
        (candidate) => candidate !== node && isIife(candidate),
      )
      if (nested) {
        report(nested)
      }
    },
  })),
  "no-branch-in-object": makeRule("no-branch-in-object", ({ report, shouldRun }) => ({
    ObjectExpression(node) {
      if (!shouldRun()) {
        return
      }
      for (const property of nodeChildren(node, "properties")) {
        const value = nodeChild(property, "value")
        if (value && isBranchCall(value)) {
          report(value)
          return
        }
      }
    },
  })),
  "no-iife-wrapper": makeRule("no-iife-wrapper", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (shouldRun() && isIife(node)) {
        report(node)
      }
    },
  })),
  "no-return-in-arrow": makeRule("no-return-in-arrow", ({ report, shouldRun }) => ({
    ArrowFunctionExpression(node) {
      if (!shouldRun() || !isNodeType(functionBody(node), "BlockStatement")) {
        return
      }
      const call = parentCall(node)
      if (isSchemaFilterCall(call)) {
        return
      }
      const returned = returnStatements(functionBody(node))[0]
      if (returned) {
        report(returned)
      }
    },
  })),
  "no-effect-never": makeRule("no-effect-never", ({ report, shouldRun }) => ({
    MemberExpression(node) {
      if (shouldRun() && isEffectMember(node, "never")) {
        report(node)
      }
    },
    StaticMemberExpression(node) {
      if (shouldRun() && isEffectMember(node, "never")) {
        report(node)
      }
    },
  })),
  "no-effect-async": makeRule("no-effect-async", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (shouldRun() && isEffectCall(node, "async")) {
        report(node)
      }
    },
  })),
  "no-effect-do": makeRule("no-effect-do", ({ report, shouldRun }) => ({
    MemberExpression(node) {
      if (shouldRun() && isEffectMember(node, "Do")) {
        report(node)
      }
    },
    StaticMemberExpression(node) {
      if (shouldRun() && isEffectMember(node, "Do")) {
        report(node)
      }
    },
  })),
  "no-effect-bind": makeRule("no-effect-bind", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (shouldRun() && isEffectCall(node, "bind")) {
        report(node)
      }
    },
  })),
  "no-nested-effect-gen": makeRule("no-nested-effect-gen", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isEffectCall(node, "gen")) {
        return
      }
      const nested = callArguments(node)
        .map((argument) =>
          findDescendant(
            argument,
            (candidate) => candidate !== node && isEffectCall(candidate, "gen"),
          ),
        )
        .find(isNode)
      if (nested) {
        report(nested)
      }
    },
  })),
  "no-match-void-branch": makeRule("no-match-void-branch", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (
        !shouldRun() ||
        (!isCallTo(node, "Match", "when") && !isCallTo(node, "Match", "orElse"))
      ) {
        return
      }
      const args = callArguments(node)
      const callback = args.at(-1)
      if (hasCallbackReturning(callback, isEffectVoid)) {
        report(node)
      }
    },
  })),
  "no-match-effect-branch": makeRule("no-match-effect-branch", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun()) {
        return
      }
      if (
        isMatchValuePipe(node) &&
        callArguments(node).some((argument) => hasSequencingCall(argument))
      ) {
        report(node)
      }
      if (
        (isCallTo(node, "Match", "when") || isCallTo(node, "Match", "orElse")) &&
        callArguments(node).some((argument) => hasSequencingCall(argument))
      ) {
        report(node)
      }
      if (
        isCallTo(node, "Option", "match") &&
        callArguments(node).some((argument) => hasSequencingCall(argument))
      ) {
        report(node)
      }
    },
  })),
  "warn-effect-sync-wrapper": makeRule("warn-effect-sync-wrapper", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isEffectCall(node, "sync")) {
        return
      }
      const firstArgument = callArguments(node)[0]
      if (
        hasCallbackReturning(
          firstArgument,
          (body) => isCallExpression(body) && !isConsoleCall(body),
        )
      ) {
        report(node)
      }
    },
  })),
  "no-effect-side-effect-wrapper": makeRule(
    "no-effect-side-effect-wrapper",
    ({ report, shouldRun }) => ({
      CallExpression(node) {
        if (!shouldRun() || (!isEffectCall(node, "as") && !isEffectCall(node, "zipRight"))) {
          return
        }
        if (hasSideEffectCall(callArguments(node)[0])) {
          report(node)
        }
      },
    }),
  ),
  "no-effect-orElse-ladder": makeRule("no-effect-orElse-ladder", ({ report, shouldRun }) => ({
    CallExpression(node) {
      if (!shouldRun() || !isEffectCall(node, "orElse")) {
        return
      }
      const firstArgument = callArguments(node)[0]
      if (
        hasEffectCall(firstArgument, "flatMap") ||
        hasEffectCall(firstArgument, "zipRight") ||
        hasEffectCall(firstArgument, "as") ||
        hasEffectCall(firstArgument, "tap")
      ) {
        report(node)
      }
    },
  })),
  "no-return-in-callback": makeRule("no-return-in-callback", ({ report, shouldRun }) => ({
    ArrowFunctionExpression(node) {
      if (!shouldRun() || !isNodeType(functionBody(node), "BlockStatement")) {
        return
      }
      const call = parentCall(node)
      if (isSchemaFilterCall(call)) {
        return
      }
      const returned = returnStatements(functionBody(node))[0]
      if (returned) {
        report(returned)
      }
    },
  })),
  "no-manual-effect-channels": makeRule("no-manual-effect-channels", ({ report, shouldRun }) => ({
    TSTypeReference(node) {
      if (!shouldRun()) {
        return
      }
      const typeName = typeNameText(nodeChild(node, "typeName"))
      if (typeName === "Effect.Effect" || typeName === "Layer.Layer") {
        report(node)
      }
    },
  })),
  "prevent-dynamic-imports": makeRule(
    "prevent-dynamic-imports",
    ({ report }, context) => ({
      ImportExpression(node) {
        if (isC0AllowedDynamicImportBoundary(context.filename)) {
          return
        }
        report(node)
      },
    }),
    { requiresEffectFile: false },
  ),
  "prefer-option-over-null": makeRule("prefer-option-over-null", ({ report, shouldRun }) => ({
    TSUnionType(node) {
      if (shouldRun() && hasNullishUnionMember(node) && isNullableLocalOrReturnType(node)) {
        report(node)
      }
    },
  })),
  "avoid-untagged-errors": makeRule("avoid-untagged-errors", ({ report, shouldRun }) => {
    const reported = new Set<NodeLike>()
    const reportBareErrors = (node: NodeLike | undefined) => {
      if (!shouldRun()) {
        return
      }
      for (const errorNode of bareErrorConstructors(node)) {
        if (!reported.has(errorNode)) {
          reported.add(errorNode)
          report(errorNode)
        }
      }
    }

    return {
      CallExpression(node) {
        if (!shouldRun()) {
          return
        }

        const method = effectCallMethod(node)
        if (method === "fail" || method === "mapError") {
          for (const argument of callArguments(node)) {
            reportBareErrors(argument)
          }
          return
        }

        if (method !== "try" && method !== "tryPromise") {
          return
        }

        for (const argument of callArguments(node)) {
          if (argument.type !== "ObjectExpression") {
            continue
          }
          for (const property of nodeChildren(argument, "properties")) {
            if (propertyKeyName(property) === "catch") {
              reportBareErrors(propertyValue(property))
            }
          }
        }
      },
      ThrowStatement(node) {
        if (!shouldRun() || !isInsideEffectHandler(node)) {
          return
        }
        reportBareErrors(nodeChild(node, "argument"))
      },
    }
  }),
  "use-effect-otel": makeRule(
    "use-effect-otel",
    ({ report, shouldRun }) => {
      const reportAccess = (node: NodeLike) => {
        if (!shouldRun()) {
          return
        }
        if (isConsoleAccess(node)) {
          report(
            node,
            "Rule: avoid console.* in C0 API/Worker/server observability surfaces. Why: it bypasses Effect logs, spans, and Cloudflare Observability collection. Fix: use Effect.log*, Effect.withSpan, or request telemetry helpers.",
          )
        }
      }

      return {
        ComputedMemberExpression: reportAccess,
        MemberExpression: reportAccess,
        StaticMemberExpression: reportAccess,
      }
    },
    { requiresEffectFile: false, requiresC0RequestObservabilitySurface: true },
  ),
}
