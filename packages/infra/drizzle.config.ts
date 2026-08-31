import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  driver: "pglite",
  schema: "../api/src/server/effect/db/schema.pg.ts",
  out: "./migrations/pg",
})
