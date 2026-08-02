import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./packages/api/src/server", import.meta.url).toString()),
      infra: fileURLToPath(new URL("./packages/infra/src", import.meta.url).toString()),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    maxWorkers: 1,
    reporters: ["default"],
  },
})
