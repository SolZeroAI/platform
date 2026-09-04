/* oxlint-disable effect/avoid-process-env, s0-lint/no-if-statement -- DATABASE and PlanetScale service tokens are operator process env from alchemy.new. */
import {
  DATABASE_ENV,
  PLANETSCALE_ALCHEMY_TOKEN_ENV,
  PLANETSCALE_ALCHEMY_TOKEN_ID_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_REMOTE_SERVICE_TOKEN_ENVS,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
  parseAppDbMode,
  parseS0DatabaseEngine,
  type AppDbMode,
  type S0DatabaseEngine,
} from "@solzero/shared"

export function databaseEngineFromProcessEnv(value: unknown = process.env[DATABASE_ENV]) {
  return parseS0DatabaseEngine(value)
}

export function appDbModeForStage(
  stage: string,
  configured: unknown,
  alchemyDev: boolean,
): AppDbMode {
  const fallback: AppDbMode = alchemyDev || stage === "dev" || stage === "test" ? "local" : "remote"
  return parseAppDbMode(configured, fallback)
}

export function needsPlanetscaleProviders(engine: S0DatabaseEngine, mode: AppDbMode) {
  return engine === "planetscale" && mode === "remote"
}

function requiredServiceToken(name: (typeof PLANETSCALE_REMOTE_SERVICE_TOKEN_ENVS)[number]) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is required when ${DATABASE_ENV}=planetscale and APP_DB_MODE=remote. PlanetScale is paid and is not a deployment provider.`,
    )
  }
  return value
}

/**
 * alchemy.new supplies service-token names. Alchemy 2.0.0-beta.74 AuthProvider
 * still reads PLANETSCALE_API_TOKEN_*. Copy only when the Alchemy names are empty.
 */
export function bindPlanetscaleAlchemyAuthFromServiceTokens() {
  const tokenId = requiredServiceToken(PLANETSCALE_SERVICE_TOKEN_ID_ENV)
  const token = requiredServiceToken(PLANETSCALE_SERVICE_TOKEN_ENV)
  const organization = requiredServiceToken(PLANETSCALE_ORGANIZATION_ENV)
  if (!process.env[PLANETSCALE_ALCHEMY_TOKEN_ID_ENV]?.trim()) {
    process.env[PLANETSCALE_ALCHEMY_TOKEN_ID_ENV] = tokenId
  }
  if (!process.env[PLANETSCALE_ALCHEMY_TOKEN_ENV]?.trim()) {
    process.env[PLANETSCALE_ALCHEMY_TOKEN_ENV] = token
  }
  if (!process.env[PLANETSCALE_ORGANIZATION_ENV]?.trim()) {
    process.env[PLANETSCALE_ORGANIZATION_ENV] = organization
  }
}
