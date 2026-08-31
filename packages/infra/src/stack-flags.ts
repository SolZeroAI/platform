/* oxlint-disable effect/avoid-process-env, s0-lint/no-if-statement -- Stack flavor selection reads DATABASE and APP_DB_MODE before Alchemy context exists. Service-token bind is only for remote planetscale. */
import { APP_DB_MODE_ENV, DATABASE_ENV } from "@solzero/shared"
import {
  appDbModeForStage,
  bindPlanetscaleAlchemyAuthFromServiceTokens,
  databaseEngineFromProcessEnv,
  needsPlanetscaleProviders,
} from "./database-engine"

export function planetscaleStackFlags(
  input: {
    readonly stage?: string
    readonly database?: unknown
    readonly appDbMode?: unknown
    readonly alchemyDev?: boolean
  } = {},
) {
  const stage = input.stage ?? process.env.ALCHEMY_STAGE ?? process.env.STAGE ?? "dev"
  const engine = databaseEngineFromProcessEnv(input.database ?? process.env[DATABASE_ENV])
  const mode = appDbModeForStage(
    stage,
    input.appDbMode ?? process.env[APP_DB_MODE_ENV],
    input.alchemyDev ?? stage === "dev",
  )
  const planetscale = needsPlanetscaleProviders(engine, mode)
  if (planetscale) bindPlanetscaleAlchemyAuthFromServiceTokens()
  return { planetscale, postgresLogicalDatabase: planetscale }
}
