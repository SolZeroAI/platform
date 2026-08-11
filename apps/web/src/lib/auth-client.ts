"use client"

import { createContext, createElement, useContext, useMemo } from "react"
import type { PublicAuthProviderRegistry } from "@solzero/shared"
import { createAuthClient } from "better-auth/react"
import { genericOAuthClient } from "better-auth/client/plugins"
import { resolveAppSession, type AppSession } from "@/lib/auth-session-state"

export type { AppSession } from "@/lib/auth-session-state"

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
})

const InitialAuthSessionContext = createContext<AppSession | null | undefined>(undefined)
const AuthProviderConfigContext = createContext<PublicAuthProviderRegistry>({
  defaultSignInProviderId: "",
  providers: [],
  configurationFile: "config/dev.config.jsonc",
})

export function AuthProviderConfigProvider({
  children,
  config,
}: {
  children: React.ReactNode
  config: PublicAuthProviderRegistry
}) {
  return createElement(AuthProviderConfigContext.Provider, { value: config }, children)
}

export function useAuthProviderConfig() {
  return useContext(AuthProviderConfigContext)
}

export function AuthSessionProvider({
  children,
  initialSession,
}: {
  children: React.ReactNode
  initialSession: AppSession | null
}) {
  return createElement(InitialAuthSessionContext.Provider, { value: initialSession }, children)
}

export function useAuthSession() {
  const initialSession = useContext(InitialAuthSessionContext)
  const initialSessionLoaded = initialSession !== undefined
  const { data, error, isPending, isRefetching, refetch } = authClient.useSession()
  const sessionData = useMemo(
    () =>
      resolveAppSession({
        clientUser: data?.user ?? null,
        initialSession: initialSession ?? null,
        pending: isPending,
      }),
    [data, initialSession, isPending],
  )

  return {
    data: sessionData,
    status:
      isPending && !initialSessionLoaded
        ? "loading"
        : sessionData
          ? "authenticated"
          : "unauthenticated",
    error,
    isPending,
    isRefetching,
    refetch,
  }
}

export async function signInWithOAuth(providerId: string, callbackURL = "/") {
  return authClient.signIn.oauth2({
    providerId,
    callbackURL,
  })
}

export async function signInWithSocial(providerId: string, callbackURL = "/") {
  return authClient.signIn.social({
    provider: providerId,
    callbackURL,
  })
}

export async function linkOAuthProvider(
  providerId: string,
  callbackURL: string,
  errorCallbackURL: string,
  scopes?: string[],
) {
  return authClient.oauth2.link({ providerId, callbackURL, errorCallbackURL, scopes })
}

export async function reconnectOkta(callbackURL: string, errorCallbackURL: string) {
  return linkOAuthProvider("okta", callbackURL, errorCallbackURL, [
    "openid",
    "profile",
    "email",
    "offline_access",
  ])
}

export const signOut: typeof authClient.signOut = (...args) => authClient.signOut(...args)
