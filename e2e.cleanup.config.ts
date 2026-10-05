import type { E2EConfig } from "e2e"
import { github } from "@e2e-dev/github"
import "./scripts/e2e/environment"

export default {
  projectId: "solzero-cleanup",
  tests: "tests/lifecycle/cleanup.e2e.ts",
  targets: [{ name: "owned-lifecycle", platform: "tools" }],
  timeout: 600_000,
  assertionTimeout: 120_000,
  workers: 1,
  retries: 0,
  trace: "off",
  reporters: ["list", "junit", "markdown", github({ key: "solzero-lifecycle" })],
  output: ".e2e/cleanup-proof",
} satisfies E2EConfig
