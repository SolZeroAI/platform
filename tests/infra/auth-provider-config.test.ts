import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "jsonc-parser"
import { describe, expect, it } from "vitest"
import {
  normalizeAuthProviderRegistry,
  publicAuthProviderRegistry,
} from "../../packages/shared/src/auth"
import { resolveC0Config } from "../../packages/shared/src/c0-config"

const repoRoot = resolve(import.meta.dirname, "../..")

describe("auth provider configuration", () => {
  it("loads the checked-in OSS default as managed admin credential sign-in", () => {
    const config = resolveC0Config(
      parse(readFileSync(resolve(repoRoot, "config/example.config.jsonc"), "utf8")),
    )

    expect(config.auth).toMatchObject({
      defaultSignInProviderId: "credential",
      providers: {
        credential: {
          kind: "credential",
          enabled: true,
          capabilities: { signIn: true, provisionUsers: true, link: false },
          provisioning: { scope: "configured-admins" },
        },
      },
    })
    expect(Object.keys(config.auth.providers)).toEqual(["credential"])
  })

  it("rejects a link-only provider as the default sign-in provider", () => {
    expect(() =>
      normalizeAuthProviderRegistry({
        defaultSignInProviderId: "github",
        providers: {
          github: {
            kind: "social",
            enabled: true,
            displayName: "GitHub",
            clientId: "client-id",
            clientSecret: { env: "GITHUB_OAUTH_CLIENT_SECRET" },
            capabilities: { signIn: false, provisionUsers: false, link: true },
          },
        },
      }),
    ).toThrow("at least one provider must allow sign-in")
  })

  it("publishes only UI capabilities and not provider credentials", () => {
    const registry = normalizeAuthProviderRegistry({
      defaultSignInProviderId: "company-oidc",
      providers: {
        "company-oidc": {
          kind: "oidc",
          enabled: true,
          displayName: "Company SSO",
          issuer: "https://id.example.test",
          clientId: "sensitive-client-id",
          clientSecret: { env: "COMPANY_OIDC_CLIENT_SECRET" },
          capabilities: { signIn: true, provisionUsers: false, link: true },
        },
      },
    })

    const publicConfig = publicAuthProviderRegistry(registry, "config/dev.config.jsonc")
    expect(publicConfig.providers).toEqual([
      {
        id: "company-oidc",
        kind: "oidc",
        displayName: "Company SSO",
        capabilities: { signIn: true, link: true },
      },
    ])
    expect(publicConfig.configurationFile).toBe("config/dev.config.jsonc")
    expect(JSON.stringify(publicConfig)).not.toContain("sensitive-client-id")
  })

  it("preserves explicit provider secret references without deriving magic names", () => {
    const registry = normalizeAuthProviderRegistry({
      defaultSignInProviderId: "foo-bar",
      providers: {
        "foo-bar": {
          kind: "social",
          enabled: true,
          displayName: "Foo Bar",
          clientId: "foo-bar-client",
          clientSecret: { env: "FOO_BAR_SECRET" },
          capabilities: { signIn: true, provisionUsers: true, link: true },
        },
      },
    })
    expect(registry.providers["foo-bar"].clientSecret).toEqual({ env: "FOO_BAR_SECRET" })
  })
})
