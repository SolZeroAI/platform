import type { E2EConfig } from "e2e"

export default {
  projectId: "solzero-config",
  tests: [
    "tests/deployment-config.e2e.ts",
    "tests/migration.e2e.ts",
    "tests/storage-transfer.e2e.ts",
    "tests/api-routing.e2e.ts",
  ],
  targets: [{ name: "deployment-cli", platform: "tools" }],
  workers: 1,
  retries: 0,
  trace: "off",
  reporters: ["list", "junit", "markdown"],
  output: ".e2e/config-proof",
} satisfies E2EConfig
