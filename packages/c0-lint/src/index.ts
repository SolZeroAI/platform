import { eslintCompatPlugin } from "@oxlint/plugins"
import { rules } from "./rules.ts"

export { c0RuleNames } from "./rule-names.ts"
export type { C0RuleName } from "./rule-names.ts"

export default eslintCompatPlugin({
  meta: { name: "c0-lint" },
  rules,
})
