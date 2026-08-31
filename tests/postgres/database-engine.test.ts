import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "jsonc-parser"
import { describe, expect, it } from "vitest"
import {
  APP_DB_MODE_ENV,
  DEFAULT_S0_DATABASE_ENGINE,
  LOCAL_PGLITE_DATABASE_URL,
  LOCAL_PGLITE_PORT,
  parseAppDbMode,
  parseS0DatabaseEngine,
  resolveS0Config,
  s0DatabaseEngineFromDeployment,
} from "../../packages/shared/src"
import {
  appDbModeForStage,
  databaseEngineFromConfig,
  needsPlanetscaleProviders,
} from "../../packages/infra/src/database-engine"
import { planetscaleStackFlags } from "../../packages/infra/src/stack-flags"

const repoRoot = resolve(import.meta.dirname, "../..")

describe("control-plane database engine", () => {
  it("defaults omitted deployment.databaseEngine to d1", () => {
    expect(parseS0DatabaseEngine(undefined)).toBe("d1")
    expect(parseS0DatabaseEngine("")).toBe("d1")
    expect(s0DatabaseEngineFromDeployment(undefined)).toBe(DEFAULT_S0_DATABASE_ENGINE)
  })

  it("rejects an unknown engine name", () => {
    expect(() => parseS0DatabaseEngine("sqlite")).toThrow("Invalid database engine")
    expect(() => parseS0DatabaseEngine("postgres")).toThrow("Invalid database engine")
  })

  it("keeps APP_DB_MODE as the postgres local-vs-remote switch", () => {
    expect(parseAppDbMode(undefined, "remote")).toBe("remote")
    expect(parseAppDbMode("local", "remote")).toBe("local")
    expect(() => parseAppDbMode("sqlite", "local")).toThrow(APP_DB_MODE_ENV)
  })

  it("selects local PGLite for Alchemy dev and test stages", () => {
    expect(appDbModeForStage("dev", undefined, true)).toBe("local")
    expect(appDbModeForStage("test", undefined, false)).toBe("local")
    expect(appDbModeForStage("prod", undefined, false)).toBe("remote")
    expect(appDbModeForStage("prod", "local", false)).toBe("local")
  })

  it("requires PlanetScale providers only for remote planetscale", () => {
    expect(needsPlanetscaleProviders("d1", "remote")).toBe(false)
    expect(needsPlanetscaleProviders("d1", "local")).toBe(false)
    expect(needsPlanetscaleProviders("planetscale", "local")).toBe(false)
    expect(needsPlanetscaleProviders("planetscale", "remote")).toBe(true)
  })

  it("documents the single local PGLite port", () => {
    expect(LOCAL_PGLITE_PORT).toBe(15432)
    expect(LOCAL_PGLITE_DATABASE_URL).toContain("127.0.0.1:15432")
  })

  it("resolves shipped example config as the D1 flavor", () => {
    const config = resolveS0Config(
      parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8")),
    )
    expect(config.deployment.databaseEngine).toBe("d1")
    expect(databaseEngineFromConfig(config)).toBe("d1")
  })

  it("selects planetscale when deployment.databaseEngine is set", () => {
    const source = parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8"))
    source.deployment.databaseEngine = "planetscale"
    const config = resolveS0Config(source)
    expect(databaseEngineFromConfig(config)).toBe("planetscale")
  })

  it("does not enable PlanetScale providers for the default D1 stack flags", () => {
    const flags = planetscaleStackFlags({
      stage: "dev",
      alchemyDev: true,
      appDbMode: "local",
    })
    expect(flags.planetscale).toBe(false)
    expect(flags.postgresLogicalDatabase).toBe(false)
  })
})
