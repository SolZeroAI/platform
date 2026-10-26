import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { parse } from "jsonc-parser"
import { resolveS0Config, s0ActiveSecretReferences, type S0ResolvedConfig } from "@solzero/shared"

const repoRoot = process.cwd()
const scriptPath = resolve(repoRoot, "scripts/s0-config.ts")
const loader = import.meta.resolve("tsx")

export function exampleDeploymentConfig(): S0ResolvedConfig {
  return resolveS0Config(
    parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8")),
  )
}

interface ConfigFixture {
  readonly varsPath: string
  readonly run: (args: string[], env?: Record<string, string>) => SpawnSyncReturns<string>
  readonly writePre: (contents: string) => void
}

export function withConfigFixture(
  config: S0ResolvedConfig,
  run: (fixture: ConfigFixture) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "solzero-config-"))
  const configDirectory = join(directory, "config")
  mkdirSync(configDirectory)
  const contents = JSON.stringify(config)

  for (const stage of ["dev", "test", "pre", "prod"]) {
    writeFileSync(join(configDirectory, `fixture-${stage}.config.jsonc`), contents)
  }

  writeFileSync(join(configDirectory, "example.config.jsonc"), contents)
  writeFileSync(
    join(configDirectory, "s0.config.schema.json"),
    readFileSync(resolve(repoRoot, "config/s0.config.schema.json")),
  )

  const emptySecrets = Object.fromEntries(
    s0ActiveSecretReferences(config).map((reference) => [reference.env, ""]),
  )

  try {
    run({
      varsPath: join(configDirectory, ".pre.vars"),
      run: (args, env = {}) =>
        spawnSync(process.execPath, ["--import", loader, scriptPath, ...args], {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, ...emptySecrets, ...env, S0_CONFIG_PROFILE: "fixture" },
        }),
      writePre: (text) => writeFileSync(join(configDirectory, "fixture-pre.config.jsonc"), text),
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
