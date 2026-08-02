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
  c0ActiveSecretReferences,
  c0ConfigPathForStage,
  c0ConfigStageForStage,
  canonicalC0ConfigJson,
  configSecretWithDefault,
  getStageMetadataFromConfig,
  requiredConfigString,
  resolveC0Config,
  type C0ResolvedConfig,
  type SecretReference,
} from "@c0-agent/shared"
import { getApiInfraEnv, type ApiSecretInput } from "../../../../apps/api/infra"
import { createDeploymentMetadata } from "../deploymentMetadata"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const INFRA_DIR = resolve(__dirname, "../..")
export const REPO_ROOT = resolve(INFRA_DIR, "../..")

export function loadC0ConfigFile(repoRoot: string, stage: string): C0ResolvedConfig {
  const configPath = resolve(repoRoot, c0ConfigPathForStage(stage))
  if (!existsSync(configPath)) {
    throw new Error(
      `Missing c0 configuration file for stage '${stage}': ${configPath}. Preview stages use config/pre.config.jsonc.`,
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
  return resolveC0Config(parsed)
}

export function loadStageVars(stageTag: string) {
  dotenv.config({ path: resolve(REPO_ROOT, `config/.${stageTag}.vars`), quiet: true })
}

function stageVarsTag(stage: string): string {
  return c0ConfigStageForStage(stage)
}

function generatedSecretLogicalId(environmentVariable: string): string {
  const stableIds: Readonly<Record<string, string>> = {
    C0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD: "admin-password",
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

function resolveConfigSecrets(config: C0ResolvedConfig) {
  return Effect.gen(function* () {
    const entries: [string, ApiSecretInput][] = []
    for (const reference of uniqueSecretReferences(c0ActiveSecretReferences(config))) {
      entries.push([reference.env, yield* resolveSecretReference(reference)])
    }
    return Object.fromEntries(entries)
  })
}

function deploymentConfigDigest(config: C0ResolvedConfig): string {
  return createHash("sha256").update(canonicalC0ConfigJson(config)).digest("hex")
}

export function c0StackRuntime() {
  return Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const context = yield* Alchemy.AlchemyContext
    loadStageVars(stageVarsTag(stage))
    const c0Config = loadC0ConfigFile(REPO_ROOT, stage)
    const apiEnv = getApiInfraEnv(
      c0Config,
      deploymentConfigDigest(c0Config),
      yield* resolveConfigSecrets(c0Config),
    )
    const stageMetadata = yield* getStageMetadataFromConfig(
      stage,
      c0Config.deployment,
      c0Config.application,
    ).pipe(Effect.orDie)

    return {
      appName: c0Config.deployment.appName,
      apiEnv,
      cloudflareAccountId: yield* requiredConfigString("CLOUDFLARE_ACCOUNT_ID"),
      deploymentMetadata: createDeploymentMetadata({ repoRoot: REPO_ROOT }),
      dev: context.dev,
      infraDir: INFRA_DIR,
      repoRoot: REPO_ROOT,
      stageMetadata,
    }
  })
}
