/* oxlint-disable effect/imperative-loops -- Deployment compilation resolves and deduplicates a bounded list of secret references sequentially so Alchemy outputs retain stable identities. */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as Alchemy from "alchemy"
import dotenv from "dotenv"
import * as Effect from "effect/Effect"
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser"
import {
  APP_DB_MODE_ENV,
  s0ActiveSecretReferences,
  s0ConfigPathForStage,
  s0ConfigStageForStage,
  canonicalS0ConfigJson,
  configSecretWithDefault,
  getStageMetadataFromConfig,
  requiredConfigString,
  resolveS0Config,
  type S0ResolvedConfig,
  type SecretReference,
} from "@solzero/shared"
import { appDbModeForStage, databaseEngineFromProcessEnv } from "../database-engine"
import { getApiInfraEnv, type ApiSecretInput } from "../../../../apps/api/infra"
import { createDeploymentMetadata } from "../deploymentMetadata"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const INFRA_DIR = resolve(__dirname, "../..")
export const REPO_ROOT = resolve(INFRA_DIR, "../..")

export function loadS0ConfigFile(
  repoRoot: string,
  stage: string,
  profile?: string,
): S0ResolvedConfig {
  const configPath = resolve(repoRoot, s0ConfigPathForStage(stage, profile))
  if (!existsSync(configPath)) {
    throw new Error(
      `Missing s0 configuration file for stage '${stage}': ${configPath}. Preview stages use the pre config for the selected profile.`,
    )
  }
  const errors: ParseError[] = []
  const parsed = parse(readFileSync(configPath, "utf8"), errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ")
    throw new Error(`Invalid JSONC in ${configPath}: ${details}`)
  }
  return resolveS0Config(parsed)
}

export function loadStageVars(stageTag: string) {
  dotenv.config({ path: resolve(REPO_ROOT, `config/.${stageTag}.vars`), quiet: true })
}

function stageVarsTag(stage: string): string {
  return s0ConfigStageForStage(stage)
}

function generatedSecretLogicalId(environmentVariable: string): string {
  const stableIds: Readonly<Record<string, string>> = {
    S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD: "admin-password",
    BETTER_AUTH_SECRET: "better-auth-secret",
    MCPCF_PROXY_SIGNING_SECRET: "mcpcf-proxy-signing-secret",
    TOKEN_ENCRYPTION_KEY: "token-encryption-key",
    REPO_SECRETS_ENCRYPTION_KEY: "repository-secrets-encryption-key",
  }
  return (
    stableIds[environmentVariable] ??
    `generated-${environmentVariable.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`
  )
}

function uniqueSecretReferences(
  references: readonly SecretReference[],
): readonly SecretReference[] {
  const byEnvironmentVariable = new Map<string, SecretReference>()
  for (const reference of references) {
    const existing = byEnvironmentVariable.get(reference.env)
    if (existing && Boolean(existing.generateIfMissing) !== Boolean(reference.generateIfMissing)) {
      throw new Error(
        `Secret reference ${reference.env} has conflicting generateIfMissing declarations in the stage config file`,
      )
    }
    byEnvironmentVariable.set(reference.env, reference)
  }
  return [...byEnvironmentVariable.values()]
}

function resolveSecretReference(reference: SecretReference) {
  return Effect.gen(function* () {
    const configured = yield* configSecretWithDefault(reference.env, "")
    if (configured.trim().length > 0) return configured
    if (!reference.generateIfMissing) {
      return yield* Effect.die(
        new Error(
          `${reference.env} is required by the stage config file. Configure it in the stage secret environment.`,
        ),
      )
    }
    return yield* Alchemy.makeRandom(generatedSecretLogicalId(reference.env), { bytes: 32 })
  })
}

function resolveConfigSecrets(config: S0ResolvedConfig) {
  return Effect.gen(function* () {
    const entries: [string, ApiSecretInput][] = []
    for (const reference of uniqueSecretReferences(s0ActiveSecretReferences(config))) {
      entries.push([reference.env, yield* resolveSecretReference(reference)])
    }
    return Object.fromEntries(entries)
  })
}

function deploymentConfigDigest(config: S0ResolvedConfig): string {
  const { adminPassword: _omittedCredentialRef, ...authForDigest } = config.auth
  const digestConfig = { ...config, auth: authForDigest }
  // SHA-256 here is a config content digest so a deploy can detect change. It is not a password hash.
  return createHash("sha256").update(canonicalS0ConfigJson(digestConfig)).digest("hex") // lgtm[js/insufficient-password-hash]
}

export function s0StackRuntime() {
  return Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const context = yield* Alchemy.AlchemyContext
    loadStageVars(stageVarsTag(stage))
    // oxlint-disable-next-line effect/avoid-process-env -- An explicit operator-selected profile chooses a complete local deployment config without changing the Alchemy stage.
    const configProfile = process.env.S0_CONFIG_PROFILE
    const configFile = s0ConfigPathForStage(stage, configProfile)
    const s0Config = loadS0ConfigFile(REPO_ROOT, stage, configProfile)
    const apiEnv = getApiInfraEnv(
      s0Config,
      configFile,
      deploymentConfigDigest(s0Config),
      yield* resolveConfigSecrets(s0Config),
    )
    const stageMetadata = yield* getStageMetadataFromConfig(
      stage,
      s0Config.deployment,
      s0Config.application,
    ).pipe(Effect.orDie)
    // oxlint-disable-next-line effect/avoid-process-env -- DATABASE is the alchemy.new engine select. Missing or empty stays d1.
    const databaseEngine = databaseEngineFromProcessEnv()
    // oxlint-disable-next-line effect/avoid-process-env -- APP_DB_MODE is a local-vs-remote operator switch for the PlanetScale flavor only.
    const appDbMode = appDbModeForStage(stage, process.env[APP_DB_MODE_ENV], context.dev)

    return {
      appName: s0Config.deployment.appName,
      apiEnv,
      cloudflareAccountId: yield* requiredConfigString("CLOUDFLARE_ACCOUNT_ID"),
      deploymentMetadata: createDeploymentMetadata({ repoRoot: REPO_ROOT }),
      databaseEngine,
      appDbMode,
      // oxlint-disable-next-line effect/avoid-process-env -- Local PGLite Hyperdrive origin is an operator-supplied URL, not a Worker secret.
      databaseUrl: process.env.DATABASE_URL,
      dev: context.dev,
      infraDir: INFRA_DIR,
      repoRoot: REPO_ROOT,
      stageMetadata,
    }
  })
}
