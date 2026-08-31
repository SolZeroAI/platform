import {
  parseAppDbMode,
  s0DatabaseEngineFromDeployment,
  type AppDbMode,
  type S0DatabaseEngine,
  type S0ResolvedConfig,
} from "@solzero/shared"

export function databaseEngineFromConfig(config: S0ResolvedConfig): S0DatabaseEngine {
  return s0DatabaseEngineFromDeployment(config.deployment.databaseEngine)
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
