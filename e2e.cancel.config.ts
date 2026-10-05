import config from "./e2e.config"
export default {
  ...config,
  reporters: ["list", "junit", "markdown"],
  tests: "tests/lifecycle/fixtures/cancel.e2e.ts",
  output: ".e2e/cleanup-cancel-inner",
}
