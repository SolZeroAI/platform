import path from "node:path"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import agents from "agents/vite"
import { defineConfig } from "vitest/config"

const testsDir = path.join(import.meta.dirname, "test/facets")

export default defineConfig({
  plugins: [
    ...agents(),
    cloudflareTest({
      wrangler: {
        configPath: path.join(testsDir, "wrangler.jsonc"),
      },
    }),
  ],
  test: {
    name: "isolate-facets",
    include: [path.join(testsDir, "**/*.test.ts")],
    setupFiles: [path.join(testsDir, "setup.ts")],
    testTimeout: 15_000,
    teardownTimeout: 30_000,
    deps: {
      optimizer: {
        ssr: {
          include: ["ajv"],
        },
      },
    },
  },
})
