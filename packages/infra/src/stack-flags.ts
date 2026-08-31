/* oxlint-disable effect/avoid-process-env -- Stack provider selection reads operator stage and APP_DB_MODE before Alchemy context exists. */
import { APP_DB_MODE_ENV } from "@solzero/shared"
import {
  appDbModeForStage,
  databaseEngineFromConfig,
  needsPlanetscaleProviders,
} from "./database-engine"
import { loadS0ConfigFile, REPO_ROOT } from "./stacks/runtime"

export function planetscaleStackFlags(
  input: {
    readonly stage?: string
    readonly profile?: string
    readonly appDbMode?: unknown
    readonly alchemyDev?: boolean
  } = {},
) {
  const stage = input.stage ?? process.env.ALCHEMY_STAGE ?? process.env.STAGE ?? "dev"
  const profile = input.profile ?? process.env.S0_CONFIG_PROFILE
  const config = loadS0ConfigFile(REPO_ROOT, stage, profile)
  const engine = databaseEngineFromConfig(config)
  const mode = appDbModeForStage(
    stage,
    input.appDbMode ?? process.env[APP_DB_MODE_ENV],
    input.alchemyDev ?? stage === "dev",
  )
  const planetscale = needsPlanetscaleProviders(engine, mode)
  return { planetscale, postgresLogicalDatabase: planetscale }
}
