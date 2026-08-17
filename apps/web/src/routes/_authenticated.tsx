import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { Input } from "@cloudflare/kumo/components/input"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { CircleHelp, Info, LogIn } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import type { PublicAuthProvider, PublicAuthProviderRegistry } from "@solzero/shared"
import { S0AnimatedIcon } from "@/components/s0-animated-icon"
import { S0Loader } from "@/components/s0-loader"
import {
  authClient,
  AuthProviderConfigProvider,
  AuthSessionProvider,
  signInWithOAuth,
  signInWithSocial,
  useAuthSession,
} from "@/lib/auth-client"
import { loadAuthenticatedShellForRoute } from "@/lib/authenticated-shell.functions"
import { getS0Brand } from "@/lib/brand"
import { manrope } from "@/lib/fonts"
import { showErrorToast } from "@/lib/toast-manager"
import { ProviderSettingsProvider } from "@/hooks/use-provider-settings"

export const Route = createFileRoute("/_authenticated")({
  loader: () => loadAuthenticatedShellForRoute(),
  component: AuthenticatedRoute,
})

function AuthenticatedRoute() {
  const { authSession, authProviderConfig, providerSettings } = Route.useLoaderData()

  return (
    <AuthProviderConfigProvider config={authProviderConfig}>
      <AuthSessionProvider initialSession={authSession}>
        <ProviderSettingsProvider initialData={providerSettings}>
          <AuthenticatedOutlet authProviderConfig={authProviderConfig} />
        </ProviderSettingsProvider>
      </AuthSessionProvider>
    </AuthProviderConfigProvider>
  )
}

function AuthenticatedOutlet({
  authProviderConfig,
}: {
  authProviderConfig: PublicAuthProviderRegistry
}) {
  const { data: session, status } = useAuthSession()

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <S0Loader size={32} />
      </div>
    )
  }

  if (!session) {
    return <SignInPage authProviderConfig={authProviderConfig} />
  }

  return <Outlet />
}

export function SignInPage({
  authProviderConfig,
}: {
  authProviderConfig: PublicAuthProviderRegistry
}) {
  const brand = getS0Brand()
  const [pending, setPending] = useState(false)
  const signInProviders = [...authProviderConfig.providers]
    .filter((provider) => provider.capabilities.signIn)
    .sort((left, right) =>
      left.id === authProviderConfig.defaultSignInProviderId
        ? -1
        : right.id === authProviderConfig.defaultSignInProviderId
          ? 1
          : left.displayName.localeCompare(right.displayName),
    )
  const credentialProvider = signInProviders.find((provider) => provider.kind === "credential")
  const externalProviders = signInProviders.filter((provider) => provider.kind !== "credential")

  const handleCredentialSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    setPending(true)
    try {
      const callbackURL = getCurrentAuthCallback()
      const result = await authClient.signIn.email({ email, password, callbackURL })
      if (result.error) showErrorToast(result.error.message ?? "Sign-in failed")
    } catch (errorValue) {
      showErrorToast(errorValue instanceof Error ? errorValue.message : "Sign-in failed")
    } finally {
      setPending(false)
    }
  }

  const handleExternalSignIn = async (provider: PublicAuthProvider) => {
    setPending(true)
    try {
      const callbackURL = getCurrentAuthCallback()
      const result = await (provider.kind === "social"
        ? signInWithSocial(provider.id, callbackURL)
        : signInWithOAuth(provider.id, callbackURL))
      if (result.error) {
        showErrorToast(result.error.message ?? "Sign-in failed")
        setPending(false)
      }
    } catch (errorValue) {
      showErrorToast(errorValue instanceof Error ? errorValue.message : "Sign-in failed")
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-kumo-canvas px-6">
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
        <div className="text-center">
          <S0AnimatedIcon size={96} className="mx-auto mb-4" />
          <h1 className={`text-3xl ${manrope.className}`}>Welcome to {brand.name}</h1>
          <p className="mt-2 max-w-md text-kumo-subtle">Give your work an agent</p>
        </div>
        {credentialProvider ? (
          <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={handleCredentialSignIn}>
            <div className="grid gap-2">
              <SignInFieldLabel
                htmlFor="admin-email"
                content={
                  <>
                    Set admin emails in <code>{authProviderConfig.configurationFile}</code> under{" "}
                    <code>admins.adminEmails</code>.
                  </>
                }
              >
                Email
              </SignInFieldLabel>
              <Input
                id="admin-email"
                aria-labelledby="admin-email-label"
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <SignInFieldLabel
                htmlFor="admin-password"
                content={
                  <>
                    Retrieve the generated password with{" "}
                    <code>nub run auth:admin-password -- &lt;stage&gt;</code>, or set it with{" "}
                    <code>S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD</code>.
                  </>
                }
              >
                Password
              </SignInFieldLabel>
              <Input
                id="admin-password"
                aria-labelledby="admin-password-label"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
              />
            </div>
            <Button type="submit" size="lg" className="self-center" disabled={pending}>
              Sign In
            </Button>
          </form>
        ) : null}
        {externalProviders.map((provider) => (
          <Button
            key={provider.id}
            onClick={() => void handleExternalSignIn(provider)}
            disabled={pending}
            size="lg"
            variant="secondary"
            icon={<LogIn className="h-5 w-5" aria-hidden />}
          >
            Sign in with {provider.displayName}
          </Button>
        ))}
        {signInProviders.length === 0 ? (
          <p className="text-sm text-kumo-subtle">Sign-in is not configured for this deployment.</p>
        ) : null}
      </div>
      {credentialProvider ? (
        <Banner
          className="mb-4 w-full max-w-sm"
          icon={<Info className="h-5 w-5" aria-hidden />}
          description={
            <>
              You are using the default sign-in method—we recommend updating to a social or OIDC
              sign-in method via <code className="">{authProviderConfig.configurationFile}</code>{" "}
              for more features.
            </>
          }
        />
      ) : null}
    </div>
  )
}

function SignInFieldLabel({
  children,
  content,
  htmlFor,
}: {
  children: string
  content: ReactNode
  htmlFor: string
}) {
  return (
    <div className="flex h-5 items-center justify-between">
      <label
        id={`${htmlFor}-label`}
        htmlFor={htmlFor}
        className="m-0 select-none text-base font-medium text-kumo-default"
      >
        {children}
      </label>
      <Tooltip
        content={content}
        delay={250}
        side="right"
        render={
          <button
            type="button"
            aria-label={`${children} help`}
            className="relative inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-kumo-subtle outline-none transition-[background-color,color,transform] before:absolute before:-inset-2.5 before:content-[''] hover:bg-kumo-tint hover:text-kumo-default focus-visible:bg-kumo-tint focus-visible:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-brand/60 active:scale-[0.96]"
          />
        }
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </Tooltip>
    </div>
  )
}

function getCurrentAuthCallback(): string {
  if (typeof window === "undefined") return "/"

  const callback = `${window.location.pathname}${window.location.search}${window.location.hash}`
  return callback || "/"
}
