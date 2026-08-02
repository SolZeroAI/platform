import { describe, expect, it } from "vitest"
import { createBetterAuth } from "../../packages/api/src/server/lib/better-auth"
import type { ResolvedAuthProviderRegistry } from "../../packages/api/src/server/background/db/auth-config"
import type { ApiEnv } from "../../packages/infra/src/types/env"
import { getAppStageMetadataSync } from "../../packages/shared/src/stageMetadata"

const env = {
  STAGE: "test",
  BETTER_AUTH_SECRET: "sR9vK2xP7mQ4nL8tY6bC3dF5gH1jW0za",
} as ApiEnv
const adminEmail = "admin@example.test"
const devEnv = {
  ...env,
  STAGE: "dev",
  C0_CONFIG_ADMIN: { adminEmails: [adminEmail], adminDomains: [] },
} as ApiEnv
const authRegistry = {
  defaultSignInProviderId: "github",
  providers: {
    github: {
      kind: "social",
      enabled: true,
      displayName: "GitHub",
      clientId: "github-client",
      clientSecret: "github-secret",
      capabilities: { signIn: true, provisionUsers: true, link: true },
    },
    slack: {
      kind: "social",
      enabled: true,
      displayName: "Slack",
      clientId: "slack-client",
      clientSecret: "slack-secret",
      capabilities: { signIn: false, provisionUsers: false, link: true },
    },
  },
} satisfies ResolvedAuthProviderRegistry

const githubLinkOnlyRegistry = {
  defaultSignInProviderId: "credential",
  providers: {
    credential: {
      kind: "credential",
      enabled: true,
      displayName: "Administrator",
      capabilities: { signIn: true, provisionUsers: true, link: false },
      provisioning: { scope: "configured-admins" },
    },
    github: {
      kind: "social",
      enabled: true,
      displayName: "GitHub",
      clientId: "github-app-client-id",
      clientSecret: "github-app-client-secret",
      capabilities: { signIn: false, provisionUsers: false, link: true },
    },
  },
} satisfies ResolvedAuthProviderRegistry

async function signSessionCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  return `${value}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`
}

async function createSessionCookie(auth: ReturnType<typeof createBetterAuth>, email: string) {
  const context = await auth.$context
  const user = await context.internalAdapter.createUser({
    id: email.replace(/[^a-z0-9]/gi, "-"),
    name: "Transfer User",
    email,
    emailVerified: true,
  })
  const session = await context.internalAdapter.createSession(user.id)
  const signedSessionToken = await signSessionCookieValue(session.token, context.secret)
  const cookie = `${context.authCookies.sessionToken.name}=${signedSessionToken}`

  return { context, cookie }
}

describe("Better Auth session route", () => {
  it("requires BETTER_AUTH_SECRET outside local development", () => {
    expect(() => createBetterAuth({ STAGE: "test" } as ApiEnv)).toThrow(
      "BETTER_AUTH_SECRET is required outside local development",
    )
  })

  it("accepts the trailing slash emitted by the local React session client", async () => {
    const response = await createBetterAuth(env).handler(
      new Request("http://localhost:3000/api/auth/get-session/", {
        headers: {
          origin: "http://localhost:3000",
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it.each(["slack", "unknown"])(
    "rejects sign-in through non-authoritative provider '%s'",
    async (provider) => {
      const response = await createBetterAuth(env, authRegistry).handler(
        new Request("http://localhost:3000/api/auth/sign-in/social", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ provider, callbackURL: "/" }),
        }),
      )

      expect(response.status).toBe(403)
    },
  )

  it("registers GitHub for explicit linking without granting sign-in authority", async () => {
    const auth = createBetterAuth(env, githubLinkOnlyRegistry)
    const context = await auth.$context
    const { cookie } = await createSessionCookie(auth, "github-linker@example.test")
    const linkResponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/link-social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ provider: "github", callbackURL: "/settings" }),
      }),
    )
    const signInResponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ provider: "github", callbackURL: "/" }),
      }),
    )

    expect(context.socialProviders.map((provider) => provider.id)).toContain("github")
    expect(context.options.account?.accountLinking?.trustedProviders).toContain("github")
    expect(linkResponse.status).toBe(200)
    expect(await linkResponse.json()).toMatchObject({ redirect: true })
    expect(signInResponse.status).toBe(403)
  })

  it("rejects sign-in through a link-only generic OIDC provider", async () => {
    const oidcRegistry = {
      defaultSignInProviderId: "github",
      providers: {
        ...authRegistry.providers,
        "company-oidc": {
          kind: "oidc",
          enabled: true,
          displayName: "Company SSO",
          issuer: "https://identity.example.test",
          clientId: "oidc-client",
          clientSecret: "oidc-secret",
          capabilities: { signIn: false, provisionUsers: false, link: true },
        },
      },
    } satisfies ResolvedAuthProviderRegistry
    const response = await createBetterAuth(env, oidcRegistry).handler(
      new Request("http://localhost:3000/api/auth/sign-in/oauth2", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ providerId: "company-oidc", callbackURL: "/" }),
      }),
    )

    expect(response.status).toBe(403)
  })

  it("disables implicit linking while allowing different emails only for explicit linking", async () => {
    const context = await createBetterAuth(env, authRegistry).$context
    expect(context.options.account?.accountLinking).toMatchObject({
      disableImplicitLinking: true,
      allowDifferentEmails: true,
      trustedProviders: ["github", "slack"],
    })
  })

  it("rejects public credential signup and password lifecycle routes", async () => {
    const credentialRegistry = {
      defaultSignInProviderId: "credential",
      providers: {
        credential: {
          kind: "credential",
          enabled: true,
          displayName: "Administrator",
          capabilities: { signIn: true, provisionUsers: true, link: false },
          provisioning: { scope: "configured-admins" },
        },
      },
    } satisfies ResolvedAuthProviderRegistry

    for (const path of ["sign-up/email", "change-password", "request-password-reset"]) {
      const response = await createBetterAuth(env, credentialRegistry).handler(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: "{}",
        }),
      )
      expect(response.status).toBe(403)
    }
  })

  it("rejects session transfer URL generation for non-admins", async () => {
    const auth = createBetterAuth(env)
    const { cookie } = await createSessionCookie(auth, "user@example.com")

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/session-transfer", {
        headers: {
          cookie,
        },
      }),
    )

    expect(response.status).toBe(403)
  })

  it("gates the session transfer bridge through stage metadata", () => {
    expect(getAppStageMetadataSync("dev").app.betterAuthSessionTransferEnabled).toBe(true)
    expect(getAppStageMetadataSync("test").app.betterAuthSessionTransferEnabled).toBe(true)
    expect(getAppStageMetadataSync("pre").app.betterAuthSessionTransferEnabled).toBe(true)
    expect(getAppStageMetadataSync("prod").app.betterAuthSessionTransferEnabled).toBe(true)
    expect(
      getAppStageMetadataSync({ STAGE: "pre-branch" }).app.betterAuthSessionTransferEnabled,
    ).toBe(true)
  })

  it("generates and redeems an admin-only one-time session transfer URL", async () => {
    const auth = createBetterAuth(devEnv)
    const { context, cookie } = await createSessionCookie(auth, adminEmail)

    const generateResponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/session-transfer?redirect=/workflows", {
        headers: {
          accept: "application/json",
          cookie,
        },
      }),
    )

    expect(generateResponse.status).toBe(200)
    const transfer = (await generateResponse.json()) as { redeemUrl: string; expiresAt: string }
    expect(transfer.redeemUrl).toContain("/api/auth/session-transfer/redeem?token=")
    expect(transfer.redeemUrl).toContain("redirect=%2Fworkflows")

    const redeemResponse = await auth.handler(new Request(transfer.redeemUrl))
    expect(redeemResponse.status).toBe(302)
    expect(redeemResponse.headers.get("location")).toBe("/workflows")

    const setCookie = redeemResponse.headers.getSetCookie?.() ?? [
      redeemResponse.headers.get("set-cookie") ?? "",
    ]
    expect(
      setCookie.some((value) => value.startsWith(`${context.authCookies.sessionToken.name}=`)),
    ).toBe(true)

    const transferredCookie = setCookie
      .map((value) => value.split(";")[0])
      .filter(Boolean)
      .join("; ")
    const sessionResponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: {
          cookie: transferredCookie,
        },
      }),
    )
    const transferredSession = (await sessionResponse.json()) as {
      user?: { email?: string }
    } | null
    expect(transferredSession?.user?.email).toBe(adminEmail)

    const replayResponse = await auth.handler(new Request(transfer.redeemUrl))
    expect(replayResponse.status).toBe(400)
  })

  it("keeps the legacy dev session transfer route as an alias", async () => {
    const auth = createBetterAuth(devEnv)
    const { cookie } = await createSessionCookie(auth, adminEmail)

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/dev-session-transfer", {
        headers: {
          accept: "application/json",
          cookie,
        },
      }),
    )

    expect(response.status).toBe(200)
    const transfer = (await response.json()) as { redeemUrl: string }
    expect(transfer.redeemUrl).toContain("/api/auth/dev-session-transfer/redeem?token=")
  })
})
