import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "jsonc-parser"
import { describe, expect, it } from "vitest"
import { loadS0ConfigFile } from "../../packages/infra/src/stacks/runtime"
import {
  s0ActiveSecretReferences,
  s0RuntimeSecretReferences,
  s0ConfigFileNameForStage,
  s0ConfigPathForStage,
  s0ConfigStageForStage,
  canonicalS0ConfigJson,
  resolveS0Config,
} from "../../packages/shared/src"

const repoRoot = resolve(import.meta.dirname, "../..")

function loadExampleConfigSource() {
  return parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8"))
}

const validGitHubLinkProvider = {
  kind: "social",
  enabled: true,
  displayName: "GitHub",
  clientId: "github-app-client-id",
  clientSecret: { env: "GITHUB_APP_CLIENT_SECRET" },
  capabilities: { signIn: false, provisionUsers: false, link: true },
} as const

function configWithEnabledGitHubApp() {
  const config = loadExampleConfigSource()
  config.integrations.githubApp = {
    ...config.integrations.githubApp,
    enabled: true,
    appId: "github-app-id",
    clientId: validGitHubLinkProvider.clientId,
    slug: "s0-example",
  }
  return config
}

describe("canonical s0 configuration", () => {
  it("uses credential sign-in as the enabled OSS default", () => {
    const config = resolveS0Config(loadExampleConfigSource())
    const enabledSignInProviders = Object.entries(config.auth.providers)
      .filter(([, provider]) => provider.enabled && provider.capabilities.signIn)
      .map(([providerId]) => providerId)

    expect(config.auth.defaultSignInProviderId).toBe("credential")
    expect(enabledSignInProviders).toEqual(["credential"])
    expect(config.aiProviders.cloudflareAiGateway.enabled).toBe(true)
    expect(config.aiProviders.cloudflareAiGateway.collectLogs).toBe(true)
    expect(config.aiProviders.cloudflareAiGateway.cacheTtl).toBeNull()
    expect(config.aiProviders.cloudflareAiGateway.defaultModel).toBe("@cf/openai/gpt-oss-120b")
    expect(Object.keys(config.aiProviders.cloudflareAiGateway.models)).toEqual([
      "@cf/openai/gpt-oss-120b",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "anthropic/claude-opus-5",
      "xai/grok-4.5",
    ])
    expect(config.aiProviders.litellm).toBeUndefined()
    expect(config.mcpcf).toBeUndefined()
    expect(config.integrations.githubApp.enabled).toBe(false)
    expect(config.integrations.slack.enabled).toBe(false)
    expect(s0ActiveSecretReferences(config).every((reference) => reference.generateIfMissing)).toBe(
      true,
    )
  })

  it("rejects an enabled Cloudflare AI Gateway without its configured default model", () => {
    const config = loadExampleConfigSource()
    config.aiProviders.cloudflareAiGateway.defaultModel = "@cf/example/missing"

    expect(() => resolveS0Config(config)).toThrow(
      "aiProviders.cloudflareAiGateway.defaultModel '@cf/example/missing' is not in models",
    )
  })

  it("keeps deployment BYOK keys in Secrets Store instead of Worker secret bindings", () => {
    const source = loadExampleConfigSource()
    source.aiProviders.cloudflareAiGateway.providerKeys.openai = {
      env: "S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY",
    }
    const config = resolveS0Config(source)
    const activeSecrets = s0ActiveSecretReferences(config).map((reference) => reference.env)
    const runtimeSecrets = s0RuntimeSecretReferences(config).map((reference) => reference.env)

    expect(activeSecrets).toContain("S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY")
    expect(runtimeSecrets).not.toContain("S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY")
  })

  it("requires an admin password only when credential sign-in is enabled", () => {
    const credentialConfig = parse(
      readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8"),
    )
    delete credentialConfig.auth.adminPassword

    expect(() => resolveS0Config(credentialConfig)).toThrow(
      "auth.adminPassword is required when credential sign-in is enabled",
    )

    credentialConfig.auth = {
      defaultSignInProviderId: "company-oidc",
      providers: {
        "company-oidc": {
          kind: "oidc",
          enabled: true,
          displayName: "Company SSO",
          issuer: "https://id.example.test",
          clientId: "company-client-id",
          clientSecret: { env: "COMPANY_OIDC_CLIENT_SECRET" },
          capabilities: { signIn: true, provisionUsers: true, link: true },
        },
      },
    }

    const oidcConfig = resolveS0Config(credentialConfig)
    expect(oidcConfig.auth.adminPassword).toBeUndefined()
    expect(s0ActiveSecretReferences(oidcConfig).map((reference) => reference.env)).toContain(
      "COMPANY_OIDC_CLIENT_SECRET",
    )
  })

  it("maps named preview stages to the shared pre config file", () => {
    const pre = loadS0ConfigFile(repoRoot, "pre")
    const preview = loadS0ConfigFile(repoRoot, "pre-123")

    expect(s0ConfigStageForStage("pre-123")).toBe("pre")
    expect(s0ConfigFileNameForStage("pre-123")).toBe("pre.config.jsonc")
    expect(s0ConfigPathForStage("pre-123")).toBe("config/pre.config.jsonc")
    expect(canonicalS0ConfigJson(preview)).toBe(canonicalS0ConfigJson(pre))
  })

  it.each(["dev", "pre", "prod"])(
    "keeps the optional GitHub App disabled in the shipped %s profile",
    (stage) => {
      const config = loadS0ConfigFile(repoRoot, stage)

      expect(config.integrations.githubApp.enabled).toBe(false)
      expect(config.auth.providers.github).toBeUndefined()
    },
  )

  it.each([
    [
      "a missing provider",
      undefined,
      "enabled integrations.githubApp requires auth.providers.github",
    ],
    [
      "a disabled provider",
      { ...validGitHubLinkProvider, enabled: false },
      "auth.providers.github must be an enabled social provider",
    ],
    [
      "a non-social provider",
      {
        ...validGitHubLinkProvider,
        kind: "oidc",
        issuer: "https://github.example.test",
      },
      "auth.providers.github must be an enabled social provider",
    ],
    [
      "linking disabled",
      {
        ...validGitHubLinkProvider,
        capabilities: { signIn: true, provisionUsers: true, link: false },
      },
      "auth.providers.github must allow explicit account linking",
    ],
    [
      "a mismatched client id",
      { ...validGitHubLinkProvider, clientId: "other-client-id" },
      "auth.providers.github.clientId must match integrations.githubApp.clientId",
    ],
    [
      "a mismatched client secret",
      {
        ...validGitHubLinkProvider,
        clientSecret: { env: "OTHER_GITHUB_APP_CLIENT_SECRET" },
      },
      "auth.providers.github.clientSecret.env must match integrations.githubApp.clientSecret.env",
    ],
  ] as const)("rejects an enabled GitHub App with %s", (_name, provider, expectedError) => {
    const config = configWithEnabledGitHubApp()
    Object.assign(config.auth.providers, provider ? { github: provider } : {})

    expect(() => resolveS0Config(config)).toThrow(expectedError)
  })

  it("requires only secrets active in the selected stage config", () => {
    const testConfig = loadS0ConfigFile(repoRoot, "test")
    const secretNames = s0ActiveSecretReferences(testConfig).map((reference) => reference.env)

    expect(secretNames).not.toContain("S0_CONFIG_SECRETS_AUTH_PROVIDERS_OKTA_CLIENT_SECRET")
    expect(secretNames).not.toContain("GITHUB_APP_CLIENT_SECRET")
    expect(secretNames).not.toContain("SLACK_TOKEN")
    expect(secretNames).not.toContain("CF_AI_SEARCH_SERVICE_TOKEN_ID")
    expect(secretNames).toContain("BETTER_AUTH_SECRET")
  })

  it("rejects stages without an explicit config mapping", () => {
    expect(() => s0ConfigFileNameForStage("staging")).toThrow("Invalid stage 'staging'")
  })

  it("fails before deployment when the selected config file is missing", () => {
    expect(() => loadS0ConfigFile(resolve(repoRoot, "tests/fixtures"), "prod")).toThrow(
      "Missing s0 configuration file for stage 'prod'",
    )
  })

  it("publishes an editor-compatible JSON Schema document", () => {
    const schema = parse(readFileSync(resolve(repoRoot, "config/s0.config.schema.json"), "utf8"))

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(schema.type).toBe("object")
    expect(schema.properties).toHaveProperty("auth")
    expect(schema.properties).not.toHaveProperty("profiles")
    expect(schema).not.toHaveProperty("dialect")
  })
})
