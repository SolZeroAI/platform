import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"
import * as Context from "effect/Context"
import * as schema from "./schema"

export type D1DrizzleDatabase = DrizzleD1Database<typeof schema>

export const D1Drizzle = Context.Service<D1DrizzleDatabase>("c0/api/D1Drizzle")

export function makeD1Drizzle(db: D1Database): D1DrizzleDatabase {
  const config = { schema, jit: true } as Parameters<typeof drizzle<typeof schema>>[1]
  return drizzle(db, config)
}
