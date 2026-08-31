import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "jsonc-parser"
import { afterEach, describe, expect, it } from "vitest"
import {
  APP_DB_MODE_ENV,
  DATABASE_ENV,
  DEFAULT_S0_DATABASE_ENGINE,
  LOCAL_PGLITE_DATABASE_URL,
  LOCAL_PGLITE_PORT,
  PLANETSCALE_ALCHEMY_TOKEN_ENV,
  PLANETSCALE_ALCHEMY_TOKEN_ID_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
  databaseEngineFromRecord,
  parseAppDbMode,
  parseS0DatabaseEngine,
  resolveS0Config,
} from "../../packages/shared/src"
import {
  appDbModeForStage,
  bindPlanetscaleAlchemyAuthFromServiceTokens,
  databaseEngineFromProcessEnv,
  needsPlanetscaleProviders,
} from "../../packages/infra/src/database-engine"
import { planetscaleStackFlags } from "../../packages/infra/src/stack-flags"

const repoRoot = resolve(import.meta.dirname, "../..")

const planetscaleAuthEnvKeys = [
  PLANETSCALE_SERVICE_TOKEN_ID_ENV,
  PLANETSCALE_SERVICE_TOKEN_ENV,
  PLANETSCALE_ORGANIZATION_ENV,
  PLANETSCALE_ALCHEMY_TOKEN_ID_ENV,
  PLANETSCALE_ALCHEMY_TOKEN_ENV,
  DATABASE_ENV,
  APP_DB_MODE_ENV,
] as const

function restorePlanetscaleAuthEnv(snapshot: Record<string, string | undefined>) {
  for (const key of planetscaleAuthEnvKeys) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe("control-plane database engine", () => {
  const envSnapshot = Object.fromEntries(
    planetscaleAuthEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>

  afterEach(() => {
    restorePlanetscaleAuthEnv(envSnapshot)
  })

  it("defaults omitted DATABASE to d1", () => {
    expect(parseS0DatabaseEngine(undefined)).toBe("d1")
    expect(parseS0DatabaseEngine("")).toBe("d1")
    expect(databaseEngineFromRecord({})).toBe(DEFAULT_S0_DATABASE_ENGINE)
    expect(databaseEngineFromProcessEnv(undefined)).toBe("d1")
  })

  it("rejects an unknown DATABASE value and does not accept DATABASE_ENGINE", () => {
    expect(() => parseS0DatabaseEngine("sqlite")).toThrow(`Invalid ${DATABASE_ENV}`)
    expect(() => parseS0DatabaseEngine("postgres")).toThrow(`Invalid ${DATABASE_ENV}`)
    expect(databaseEngineFromRecord({ DATABASE_ENGINE: "planetscale" })).toBe("d1")
  })

  it("keeps APP_DB_MODE as the postgres local-vs-remote switch", () => {
    expect(parseAppDbMode(undefined, "remote")).toBe("remote")
    expect(parseAppDbMode("local", "remote")).toBe("local")
    expect(() => parseAppDbMode("sqlite", "local")).toThrow(APP_DB_MODE_ENV)
    expect(() => parseS0DatabaseEngine("local")).toThrow(`Invalid ${DATABASE_ENV}`)
  })

  it("selects local PGLite for Alchemy dev and test stages", () => {
    expect(appDbModeForStage("dev", undefined, true)).toBe("local")
    expect(appDbModeForStage("test", undefined, false)).toBe("local")
    expect(appDbModeForStage("prod", undefined, false)).toBe("remote")
    expect(appDbModeForStage("prod", "local", false)).toBe("local")
  })

  it("requires PlanetScale resource auth only for remote planetscale", () => {
    expect(needsPlanetscaleProviders("d1", "remote")).toBe(false)
    expect(needsPlanetscaleProviders("d1", "local")).toBe(false)
    expect(needsPlanetscaleProviders("planetscale", "local")).toBe(false)
    expect(needsPlanetscaleProviders("planetscale", "remote")).toBe(true)
  })

  it("documents the single local PGLite port", () => {
    expect(LOCAL_PGLITE_PORT).toBe(15432)
    expect(LOCAL_PGLITE_DATABASE_URL).toContain("127.0.0.1:15432")
  })

  it("resolves shipped example config without a JSONC engine field", () => {
    const config = resolveS0Config(
      parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8")),
    )
    expect(config.deployment).not.toHaveProperty("databaseEngine")
  })

  it("selects planetscale from DATABASE env", () => {
    expect(parseS0DatabaseEngine("planetscale")).toBe("planetscale")
    expect(databaseEngineFromRecord({ DATABASE: "planetscale" })).toBe("planetscale")
  })

  it("does not enable PlanetScale Layers for the default missing DATABASE", () => {
    delete process.env[DATABASE_ENV]
    const flags = planetscaleStackFlags({
      stage: "dev",
      alchemyDev: true,
      appDbMode: "local",
    })
    expect(flags.planetscale).toBe(false)
    expect(flags.postgresLogicalDatabase).toBe(false)
  })

  it("does not require PlanetScale tokens for DATABASE=planetscale with local PGLite", () => {
    delete process.env[PLANETSCALE_SERVICE_TOKEN_ID_ENV]
    delete process.env[PLANETSCALE_SERVICE_TOKEN_ENV]
    delete process.env[PLANETSCALE_ORGANIZATION_ENV]
    const flags = planetscaleStackFlags({
      stage: "dev",
      database: "planetscale",
      appDbMode: "local",
      alchemyDev: true,
    })
    expect(flags.planetscale).toBe(false)
  })

  it("requires alchemy.new service tokens when DATABASE=planetscale and APP_DB_MODE=remote", () => {
    delete process.env[PLANETSCALE_SERVICE_TOKEN_ID_ENV]
    delete process.env[PLANETSCALE_SERVICE_TOKEN_ENV]
    delete process.env[PLANETSCALE_ORGANIZATION_ENV]
    expect(() =>
      planetscaleStackFlags({
        stage: "prod",
        database: "planetscale",
        appDbMode: "remote",
        alchemyDev: false,
      }),
    ).toThrow(PLANETSCALE_SERVICE_TOKEN_ID_ENV)
  })

  it("copies service tokens into Alchemy AuthProvider names", () => {
    process.env[PLANETSCALE_SERVICE_TOKEN_ID_ENV] = "token-id"
    process.env[PLANETSCALE_SERVICE_TOKEN_ENV] = "token-secret"
    process.env[PLANETSCALE_ORGANIZATION_ENV] = "solzero"
    delete process.env[PLANETSCALE_ALCHEMY_TOKEN_ID_ENV]
    delete process.env[PLANETSCALE_ALCHEMY_TOKEN_ENV]
    bindPlanetscaleAlchemyAuthFromServiceTokens()
    expect(process.env[PLANETSCALE_ALCHEMY_TOKEN_ID_ENV]).toBe("token-id")
    expect(process.env[PLANETSCALE_ALCHEMY_TOKEN_ENV]).toBe("token-secret")
  })
})
