export const S0_DATABASE_ENGINES = ["d1", "planetscale"] as const
export type S0DatabaseEngine = (typeof S0_DATABASE_ENGINES)[number]
export const DEFAULT_S0_DATABASE_ENGINE: S0DatabaseEngine = "d1"

/** alchemy.new contract: select parameter and Worker/process env. Missing or empty is `d1`. */
export const DATABASE_ENV = "DATABASE"

export const APP_DB_MODES = ["local", "remote"] as const
export type AppDbMode = (typeof APP_DB_MODES)[number]

/** Local PGLite socket used as the Hyperdrive `dev` origin for the PlanetScale flavor. */
export const LOCAL_PGLITE_PORT = 15432
export const LOCAL_PGLITE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${LOCAL_PGLITE_PORT}/postgres`

export const APP_DB_MODE_ENV = "APP_DB_MODE"
export const APP_HYPERDRIVE_BINDING = "APP_HYPERDRIVE"

export const PLANETSCALE_SERVICE_TOKEN_ID_ENV = "PLANETSCALE_SERVICE_TOKEN_ID"
export const PLANETSCALE_SERVICE_TOKEN_ENV = "PLANETSCALE_SERVICE_TOKEN"
export const PLANETSCALE_ORGANIZATION_ENV = "PLANETSCALE_ORGANIZATION"

/** Alchemy 2.0.0-beta.74 AuthProvider names. Mapped from service-token env at Layer merge. */
export const PLANETSCALE_ALCHEMY_TOKEN_ID_ENV = "PLANETSCALE_API_TOKEN_ID"
export const PLANETSCALE_ALCHEMY_TOKEN_ENV = "PLANETSCALE_API_TOKEN"

export const PLANETSCALE_REMOTE_SERVICE_TOKEN_ENVS = [
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
] as const

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
    `Invalid ${DATABASE_ENV} '${String(value)}'. Expected ${S0_DATABASE_ENGINES.join(" | ")}`,
  )
}

export function parseAppDbMode(value: unknown, fallback: AppDbMode): AppDbMode {
  if (value === undefined || value === null || value === "") return fallback
  if (isAppDbMode(value)) return value
  throw new Error(
    `Invalid ${APP_DB_MODE_ENV} '${String(value)}'. Expected ${APP_DB_MODES.join(" | ")}`,
  )
}

export function databaseEngineFromRecord(env: object): S0DatabaseEngine {
  return parseS0DatabaseEngine(Reflect.get(env, DATABASE_ENV))
}
