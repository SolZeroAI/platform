import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@c0-agent/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    env: {
      VITE_STAGE: "test",
      VITE_C0_LOG_LEVEL: "trace",
      VITE_C0_SHOW_TEST_ERROR_BUTTON: "true",
      VITE_C0_BETTER_AUTH_SESSION_TRANSFER_ENABLED: "true",
      VITE_C0_SANDBOX_INACTIVITY_TIMEOUT_MS: "600000",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
