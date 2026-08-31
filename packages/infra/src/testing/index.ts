import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as State from "alchemy/State"
import type * as Effect from "effect/Effect"
import { getStageMetadataSync, type S0AuthConfig } from "@solzero/shared"
import type { ApiInfraEnv } from "../../../../apps/api/infra/index"
import { createS0Api } from "../s0"
import { createDeploymentMetadata } from "../deploymentMetadata"
import { stackOptions } from "../stack"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const INFRA_DIR = resolve(__dirname, "../..")
const REPO_ROOT = resolve(INFRA_DIR, "../..")
const S0_ALCHEMY_LOCAL_ACCOUNT_ID = "00000000000000000000000000000000"
const S0_ALCHEMY_LOCAL_API_TOKEN = "local-emulation-token"
const S0_ALCHEMY_TEST_LITELLM_BASE_URL = "https://litellm.example.test"
const S0_ALCHEMY_TEST_LITELLM_DEFAULT_MODEL = "gpt-5.4-mini"
const S0_ALCHEMY_TEST_CLOUDFLARE_AI_GATEWAY_CONFIG = {
  enabled: true,
  cacheTtl: null,
  collectLogs: true,
  defaultModel: "@cf/openai/gpt-oss-120b",
  providerKeys: {},
  models: {
    "@cf/openai/gpt-oss-120b": {
      name: "GPT OSS 120B Starter",
      provider: { api: "responses" },
      reasoning: {
        efforts: ["low", "medium", "high"],
        default: "medium",
      },
    },
    "openai/gpt-5.6-luna": {
      name: "GPT 5.6 Luna",
      provider: { npm: "@ai-sdk/openai", api: "responses" },
      reasoning: {
        efforts: ["low", "medium", "high"],
        default: "medium",
      },
    },
  },
} as const
const S0_ALCHEMY_TEST_ADMIN_CONFIG = {
  adminEmails: ["admin@example.test"],
  adminDomains: [],
}
const S0_ALCHEMY_TEST_AUTH_CONFIG = {
  defaultSignInProviderId: "credential",
  adminPassword: { env: "S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD" },
  providers: {
    credential: {
      kind: "credential",
      enabled: true,
      displayName: "Administrator",
      capabilities: { signIn: true, provisionUsers: true, link: false },
      provisioning: { scope: "configured-admins" },
    },
  },
} satisfies S0AuthConfig
const S0_ALCHEMY_TEST_LITELLM_CONFIG = {
  enabled: true,
  baseUrl: S0_ALCHEMY_TEST_LITELLM_BASE_URL,
  defaultModel: S0_ALCHEMY_TEST_LITELLM_DEFAULT_MODEL,
  defaultReasoningLevel: "medium" as const,
  adapterOverrides: {},
  apiKey: { env: "S0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY" },
}
const S0_ALCHEMY_TEST_API_ENV_DEFAULTS = {
  S0_PROVIDER_LAYER: "mock",
  S0_CONFIG_FILE: "config/test.config.jsonc",
  S0_CONFIG_ADMIN: S0_ALCHEMY_TEST_ADMIN_CONFIG,
  S0_CONFIG_AUTH: S0_ALCHEMY_TEST_AUTH_CONFIG,
  S0_CONFIG_CLOUDFLARE_AI_GATEWAY: S0_ALCHEMY_TEST_CLOUDFLARE_AI_GATEWAY_CONFIG,
  S0_CONFIG_LITELLM: S0_ALCHEMY_TEST_LITELLM_CONFIG,
  S0_DEPLOYMENT_CONFIG_DIGEST: "test-config-digest",
  configSecretBindings: {
    S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD: "test-admin-password-at-least-32-bytes",
    S0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY: "test-litellm-api-key",
  },
  cloudflareAiGatewayProviderKeySecrets: {},
  BETTER_AUTH_SECRET: "u7Qm9Kx2Vp8Ls4Nr6Tb1Wd5Yc3Hf0ZaE",
  CF_AI_SEARCH_SERVICE_TOKEN_ID: "",
  GITHUB_APP_CLIENT_ID: "test-github-client-id",
  GITHUB_APP_CLIENT_SECRET: "test-github-client-secret",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "test-github-private-key",
  GITHUB_APP_SLUG: "test-github-app",
  GITHUB_APP_WEBHOOK_SECRET: "test-github-webhook-secret",
  MCPCF_PROXY_SIGNING_SECRET: "test-mcpcf-proxy-signing-secret-at-least-32-bytes",
  REPO_SECRETS_ENCRYPTION_KEY: "test-repo-secrets-encryption-key",
  SLACK_TOKEN: "test-slack-token",
  TOKEN_ENCRYPTION_KEY: "test-token-encryption-key",
} satisfies ApiInfraEnv

const S0_ALCHEMY_TEST_PROCESS_ENV = {
  ALCHEMY_DEV: "1",
  CI: "1",
  CLOUDFLARE_ACCOUNT_ID: S0_ALCHEMY_LOCAL_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: S0_ALCHEMY_LOCAL_API_TOKEN,
  STAGE: "test",
} satisfies Record<string, string>

type S0AlchemyTestOptions = ReturnType<typeof createS0AlchemyTestOptions>
type S0ApiTestOutput = Effect.Success<ReturnType<typeof createS0Api>>
type S0StackServices = Effect.Services<ReturnType<typeof createS0Api>>

class S0ApiTest extends Alchemy.Stack<S0ApiTest, S0ApiTestOutput>()("s0-alchemy-test") {}

export function createS0AlchemyTestOptions() {
  setS0AlchemyTestEnv()

  return {
    dev: true,
    providers: Cloudflare.providers(),
    stage: "test",
    state: State.inMemoryState(),
  } as const
}

export function setS0AlchemyTestEnv() {
  // oxlint-disable-next-line effect/avoid-process-env -- Alchemy's test mode is still selected through process env.
  Object.assign(process.env, S0_ALCHEMY_TEST_PROCESS_ENV)
}

export function makeS0ApiTestResources(options: S0AlchemyTestOptions) {
  const apiEnv = createS0AlchemyTestApiEnv()
  const stageMetadata = getStageMetadataSync(options.stage)

  return createS0Api({
    apiEnv,
    appName: "s0-alchemy-test",
    cloudflareAccountId: S0_ALCHEMY_LOCAL_ACCOUNT_ID,
    deploymentMetadata: createDeploymentMetadata({
      // oxlint-disable-next-line effect/avoid-process-env -- Test metadata mirrors the current CI/local environment.
      env: process.env,
      repoRoot: REPO_ROOT,
    }),
    databaseEngine: "d1",
    appDbMode: "local",
    dev: options.dev,
    infraDir: INFRA_DIR,
    repoRoot: REPO_ROOT,
    stageMetadata,
  })
}

export function makeS0ApiTestStack(options: S0AlchemyTestOptions) {
  return S0ApiTest.make(
    stackOptions<S0StackServices>({
      providers: options.providers,
      state: options.state,
    }),
    makeS0ApiTestResources(options),
  )
}

function createS0AlchemyTestApiEnv(): ApiInfraEnv {
  return {
    ...S0_ALCHEMY_TEST_API_ENV_DEFAULTS,
  }
}

export function requireWorkerUrl(appName: string, url: string | undefined) {
  // oxlint-disable-next-line s0-lint/no-if-statement -- Test helper validates deployed Worker output before issuing HTTP requests.
  if (!url) {
    throw new Error(`Expected deployed ${appName} worker URL.`)
  }

  return url.replace(/\/+$/, "")
}

export function s0ApiRequest(
  url: string | undefined,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // oxlint-disable-next-line effect/avoid-native-fetch -- Alchemy stack tests intentionally exercise the deployed local Worker over HTTP like Janus.
  return fetch(`${requireWorkerUrl("s0 API", url)}${path}`, init)
}

export interface S0ApiRequestWhenReadyOptions {
  /** Number of retries after the initial request. */
  readonly retries?: number
  /** Retry a 404 while a fresh Worker route propagates. Defaults to true. */
  readonly retryNotFound?: boolean
}

const S0_API_READY_INITIAL_DELAY_MS = 500
const S0_API_READY_MAX_DELAY_MS = 3_000
const S0_API_READY_RETRIES = 6

function isTransientWorkerResponse(
  response: Response,
  options: S0ApiRequestWhenReadyOptions,
): boolean {
  return ((options.retryNotFound ?? true) && response.status === 404) || response.status >= 500
}

function waitForRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Retries a test request through Cloudflare's bounded Worker/binding convergence window.
 * Callers must opt in only when replaying the request is safe.
 */
export async function s0ApiRequestWhenReady(
  url: string | undefined,
  path: string,
  init: RequestInit = {},
  options: S0ApiRequestWhenReadyOptions = {},
): Promise<Response> {
  const retries = options.retries ?? S0_API_READY_RETRIES
  let retryDelayMs = S0_API_READY_INITIAL_DELAY_MS

  // oxlint-disable-next-line effect/imperative-loops -- A bounded transport retry must preserve the last Response or thrown network error for the caller.
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // oxlint-disable-next-line effect/avoid-try-catch -- Promise transport failures and retryable HTTP responses share one ordered retry budget.
    try {
      const response = await s0ApiRequest(url, path, init)
      // oxlint-disable-next-line s0-lint/no-if-statement -- This Promise-based test transport preserves the final Response while bounding transient edge retries.
      if (!isTransientWorkerResponse(response, options) || attempt === retries) {
        return response
      }
      await response.body?.cancel()
    } catch (error) {
      // oxlint-disable-next-line s0-lint/no-if-statement -- Aborted requests and the final transport failure must surface without another wait.
      if (init.signal?.aborted || attempt === retries) {
        throw error
      }
    }

    await waitForRetry(retryDelayMs)
    retryDelayMs = Math.min(retryDelayMs * 2, S0_API_READY_MAX_DELAY_MS)
  }

  throw new Error("Worker readiness retry loop exhausted unexpectedly")
}
