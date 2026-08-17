import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@solzero/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    env: {
      VITE_STAGE: "test",
      VITE_S0_LOG_LEVEL: "trace",
      VITE_S0_SHOW_TEST_ERROR_BUTTON: "true",
      VITE_S0_BETTER_AUTH_SESSION_TRANSFER_ENABLED: "true",
      VITE_S0_SANDBOX_INACTIVITY_TIMEOUT_MS: "600000",
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
