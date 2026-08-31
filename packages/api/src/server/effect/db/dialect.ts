import { sql, type SQL, type SQLWrapper } from "drizzle-orm"
import * as Match from "effect/Match"

export type ControlPlaneDialect = "sqlite" | "postgres"

export function placeholder(dialect: ControlPlaneDialect, index: number): string {
  return Match.value(dialect).pipe(
    Match.when("postgres", () => `$${index}`),
    Match.orElse(() => `?${index}`),
  )
}

export function rewriteSqlitePlaceholders(query: string, dialect: ControlPlaneDialect): string {
  return Match.value(dialect).pipe(
    Match.when("sqlite", () => query),
    Match.orElse(() => query.replaceAll(/\?(\d+)/g, (_match, index: string) => `$${index}`)),
  )
}

export function jsonArrayContainsAny(
  dialect: ControlPlaneDialect,
  column: SQLWrapper,
  values: readonly string[],
): SQL {
  const list = sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )
  return Match.value(dialect).pipe(
    Match.when(
      "postgres",
      () =>
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${column}::jsonb) AS tag(value) WHERE tag.value IN (${list}))`,
    ),
    Match.orElse(() => sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value IN (${list}))`),
  )
}

export function jsonArrayElementsFrom(dialect: ControlPlaneDialect, column: SQLWrapper): SQL {
  return Match.value(dialect).pipe(
    Match.when("postgres", () => sql`jsonb_array_elements_text(${column}::jsonb) AS tag(value)`),
    Match.orElse(() => sql`json_each(${column})`),
  )
}

export function jsonArrayElementValue(dialect: ControlPlaneDialect): SQL {
  return Match.value(dialect).pipe(
    Match.when("postgres", () => sql`tag.value`),
    Match.orElse(() => sql`json_each.value`),
  )
}
