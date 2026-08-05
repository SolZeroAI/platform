import { eslintCompatPlugin } from "@oxlint/plugins"
import { rules } from "./rules.ts"

export { s0RuleNames } from "./rule-names.ts"
export type { S0RuleName } from "./rule-names.ts"

export default eslintCompatPlugin({
  meta: { name: "s0-lint" },
  rules,
})
