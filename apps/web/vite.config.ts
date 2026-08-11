import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig(async () => {
  const [{ default: react }, { tanstackStart }] = await Promise.all([
    import("@vitejs/plugin-react"),
    import("@tanstack/react-start/plugin/vite"),
  ])
  const { default: tailwindcss } = await import("@tailwindcss/vite")

  return {
    server: {
      port: 3000,
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@solzero/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        external: ["cloudflare:workers"],
      },
    },
    plugins: [tailwindcss(), tanstackStart(), react()],
  }
})
