export const S0_DATABASE_ENGINES = ["d1", "planetscale"] as const
export type S0DatabaseEngine = (typeof S0_DATABASE_ENGINES)[number]
export const DEFAULT_S0_DATABASE_ENGINE: S0DatabaseEngine = "d1"

export const APP_DB_MODES = ["local", "remote"] as const
export type AppDbMode = (typeof APP_DB_MODES)[number]

/** Local PGLite socket used as the Hyperdrive `dev` origin for the PlanetScale flavor. */
export const LOCAL_PGLITE_PORT = 15432
export const LOCAL_PGLITE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${LOCAL_PGLITE_PORT}/postgres`

export const S0_DATABASE_ENGINE_ENV = "S0_DATABASE_ENGINE"
export const APP_DB_MODE_ENV = "APP_DB_MODE"
export const APP_HYPERDRIVE_BINDING = "APP_HYPERDRIVE"

export function isS0DatabaseEngine(value: unknown): value is S0DatabaseEngine {
  return value === "d1" || value === "planetscale"
}

export function isAppDbMode(value: unknown): value is AppDbMode {
  return value === "local" || value === "remote"
}

export function parseS0DatabaseEngine(value: unknown): S0DatabaseEngine {
  if (isS0DatabaseEngine(value)) return value
  if (value === undefined || value === null || value === "") return DEFAULT_S0_DATABASE_ENGINE
  throw new Error(
    `Invalid database engine '${String(value)}'. Expected ${S0_DATABASE_ENGINES.join(" | ")}`,
  )
}

export function parseAppDbMode(value: unknown, fallback: AppDbMode): AppDbMode {
  if (value === undefined || value === null || value === "") return fallback
  if (isAppDbMode(value)) return value
  throw new Error(
    `Invalid ${APP_DB_MODE_ENV} '${String(value)}'. Expected ${APP_DB_MODES.join(" | ")}`,
  )
}

export function s0DatabaseEngineFromDeployment(databaseEngine: S0DatabaseEngine | undefined) {
  return databaseEngine ?? DEFAULT_S0_DATABASE_ENGINE
}
