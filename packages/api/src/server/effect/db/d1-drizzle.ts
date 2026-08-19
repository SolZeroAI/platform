import { defineRelations } from "drizzle-orm"
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"
import * as Context from "effect/Context"
import * as schema from "./schema"

const relations = defineRelations(schema)

export type D1DrizzleDatabase = DrizzleD1Database<typeof relations>

export const D1Drizzle = Context.Service<D1DrizzleDatabase>("s0/api/D1Drizzle")

export function makeD1Drizzle(db: D1Database): D1DrizzleDatabase {
  return drizzle(db, { relations })
}
