import config from "./e2e.config"
export default {
  ...config,
  reporters: ["list", "junit", "markdown"],
  tests: ["tests/auth.setup.e2e.ts", "tests/lifecycle/fixtures/failure.e2e.ts"],
  output: ".e2e/cleanup-failure-inner",
}
