"use client"

import { ExternalLink } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  authClient,
  linkOAuthProvider,
  reconnectOkta,
  useAuthProviderConfig,
  useAuthSession,
} from "@/lib/auth-client"
import { copyToClipboard } from "@/lib/format"
import { getAppStageMetadata } from "@/lib/runtime-config"
import { appToastManager } from "@/lib/toast-manager"
import {
  OKTA_RECONNECT_SETTINGS_HASH,
  buildOktaReconnectSettingsPath,
  formatOktaReconnectError,
  type OktaReconnectStatus,
} from "./okta-reconnect"
import {
  buildSlackLinkSettingsPath,
  formatSlackLinkError,
  normalizeSlackUserId,
  type SlackLinkStatus,
} from "./slack-linking"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const ACCOUNT_TOC_ITEMS = [
  { id: "account-authentication", label: "Authentication" },
  { id: "connected-auth-providers", label: "Connected Providers", depth: 1 },
  { id: OKTA_RECONNECT_SETTINGS_HASH, label: "Context Forge OAuth", depth: 1 },
  { id: "github-app", label: "GitHub App", depth: 1 },
  { id: "account-credentials", label: "Credentials" },
  { id: "contextforge-api-token", label: "ContextForge API Token", depth: 1 },
  { id: "api-keys", label: "API Keys", depth: 1 },
  { id: "slack-accounts", label: "Slack" },
] as const

interface ApiKeyItem {
  keyId: string
  label: string | null
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

interface LinkedAccountItem {
  id: string
  providerId: string
  accountId: string
  createdAt?: string
  updatedAt?: string
  scopes?: string[]
}

interface GitHubProfileData {
  login?: string
  html_url?: string
}

interface GitHubAccountInfo {
  data?: GitHubProfileData
}

interface SessionTransferPayload {
  redeemUrl?: string
  expiresAt?: string
  error?: string
}

interface ContextForgeTokenSettings {
  configured: boolean
  contextForgeUrl?: string
  contextForgeApiKeysUrl?: string
  tokenAuthServerCount: number
  error?: string
}

interface ApiAccessSettingsProps {
  oktaReconnect?: OktaReconnectStatus
  oktaReconnectError?: string
  slackUserId?: string
  slackLink?: SlackLinkStatus
  slackLinkError?: string
}

const BETTER_AUTH_SESSION_TRANSFER_ENABLED =
  getAppStageMetadata().app.betterAuthSessionTransferEnabled

function formatTimestamp(value: number | null): string {
  if (!value) {
    return "Never"
  }
  return new Date(value).toLocaleString()
}

function formatAccountTimestamp(value: string | undefined): string {
  if (!value) {
    return "Unknown"
  }
  return new Date(value).toLocaleString()
}

function normalizeAccounts(value: unknown): LinkedAccountItem[] {
  if (Array.isArray(value)) {
    return value as LinkedAccountItem[]
  }
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) {
      return data as LinkedAccountItem[]
    }
  }
  return []
}

export function ApiAccessSettings({
  oktaReconnect,
  oktaReconnectError,
  slackUserId,
  slackLink,
  slackLinkError,
}: ApiAccessSettingsProps) {
  const { data: session } = useAuthSession()
  const authProviderConfig = useAuthProviderConfig()
  const isAdmin = session?.isAdmin === true
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [accounts, setAccounts] = useState<LinkedAccountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [githubProfile, setGithubProfile] = useState<GitHubProfileData | null>(null)
  const [apiKeyLabel, setApiKeyLabel] = useState("")
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [contextForgeTokenSettings, setContextForgeTokenSettings] =
    useState<ContextForgeTokenSettings | null>(null)
  const [contextForgeToken, setContextForgeToken] = useState("")
  const [clearContextForgeToken, setClearContextForgeToken] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [linkingSlack, setLinkingSlack] = useState(false)
  const [reconnectingOkta, setReconnectingOkta] = useState(false)
  const [generatingSessionTransfer, setGeneratingSessionTransfer] = useState(false)
  const [sessionTransferUrl, setSessionTransferUrl] = useState<string | null>(null)
  const [sessionTransferExpiresAt, setSessionTransferExpiresAt] = useState<string | null>(null)
  const autoSlackLinkAttemptRef = useRef<string | null>(null)

  const activeApiKeys = useMemo(() => apiKeys.filter((item) => !item.revokedAt), [apiKeys])
  const githubAccount = useMemo(
    () => accounts.find((account) => account.providerId === "github") ?? null,
    [accounts],
  )
  const slackAccounts = useMemo(
    () => accounts.filter((account) => account.providerId === "slack"),
    [accounts],
  )
  const requestedSlackUserId = normalizeSlackUserId(slackUserId)
  const requestedSlackAccount = useMemo(
    () =>
      requestedSlackUserId
        ? (slackAccounts.find((account) => account.accountId === requestedSlackUserId) ?? null)
        : null,
    [requestedSlackUserId, slackAccounts],
  )
  const oktaAccount = useMemo(
    () => accounts.find((account) => account.providerId === "okta") ?? null,
    [accounts],
  )
  const configuredLinkProviders = useMemo(
    () =>
      authProviderConfig.providers.filter(
        (provider) => provider.kind !== "credential" && provider.capabilities.link,
      ),
    [authProviderConfig.providers],
  )
  const genericLinkProviders = useMemo(
    () =>
      configuredLinkProviders.filter(
        (provider) => !new Set(["github", "slack", "okta"]).has(provider.id),
      ),
    [configuredLinkProviders],
  )
  const providerCanLink = useCallback(
    (providerId: string) => configuredLinkProviders.some((provider) => provider.id === providerId),
    [configuredLinkProviders],
  )
  const sessionTransferAvailable = BETTER_AUTH_SESSION_TRANSFER_ENABLED && isAdmin
  const fpUrl = useMemo(() => "/api/reference", [])

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const [keysResponse, accountsResult, contextForgeTokenResponse] = await Promise.all([
        fetch("/api/auth/api-keys"),
        authClient.listAccounts(),
        fetch("/api/sessions/mcpcf/contextforge-token"),
      ])

      if (!keysResponse.ok) {
        throw new Error("Failed to load API keys")
      }
      if (!contextForgeTokenResponse.ok) {
        throw new Error("Failed to load ContextForge token settings")
      }

      const keysData = (await keysResponse.json()) as { keys?: ApiKeyItem[] }
      const contextForgeTokenData =
        (await contextForgeTokenResponse.json()) as ContextForgeTokenSettings

      setApiKeys(keysData.keys ?? [])
      setAccounts(normalizeAccounts(accountsResult))
      setContextForgeTokenSettings(contextForgeTokenData)
      setContextForgeToken("")
      setClearContextForgeToken(false)
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!githubAccount) {
      setGithubProfile(null)
      return
    }

    let cancelled = false

    const loadGithubProfile = async () => {
      try {
        const response = await fetch(
          `/api/auth/account-info?accountId=${encodeURIComponent(githubAccount.accountId)}`,
        )
        if (!response.ok) {
          throw new Error("Failed to load GitHub profile")
        }

        const payload = (await response.json()) as GitHubAccountInfo
        if (!cancelled) {
          setGithubProfile(payload.data ?? null)
        }
      } catch (errorValue) {
        console.error("Failed to load GitHub profile:", errorValue)
        if (!cancelled) {
          setGithubProfile(null)
        }
      }
    }

    void loadGithubProfile()

    return () => {
      cancelled = true
    }
  }, [githubAccount])

  const linkSlackAccount = useCallback(async (expectedSlackUserId?: string | null) => {
    const callbackURL = expectedSlackUserId
      ? buildSlackLinkSettingsPath(expectedSlackUserId, "complete")
      : "/settings"
    const errorCallbackURL = expectedSlackUserId
      ? buildSlackLinkSettingsPath(expectedSlackUserId, "error")
      : "/settings"

    setLinkingSlack(true)
    try {
      await authClient.linkSocial({
        provider: "slack",
        callbackURL,
        errorCallbackURL,
      })
    } finally {
      setLinkingSlack(false)
    }
  }, [])

  useEffect(() => {
    if (!requestedSlackUserId || loading) {
      return
    }

    if (requestedSlackAccount) {
      setErrorMessage(null)
      setStatusMessage(`Slack account ${requestedSlackUserId} is linked.`)
      return
    }

    if (slackLink === "error") {
      setStatusMessage(null)
      setErrorMessage(formatSlackLinkError(slackLinkError))
      return
    }

    if (slackLink === "complete") {
      setStatusMessage(null)
      setErrorMessage(
        `Slack authorization completed, but Slack user ${requestedSlackUserId} was not linked.`,
      )
      return
    }

    if (autoSlackLinkAttemptRef.current === requestedSlackUserId) {
      return
    }

    autoSlackLinkAttemptRef.current = requestedSlackUserId
    setStatusMessage(`Connecting Slack account ${requestedSlackUserId}...`)
    setErrorMessage(null)

    void linkSlackAccount(requestedSlackUserId).catch((errorValue) => {
      autoSlackLinkAttemptRef.current = null
      setStatusMessage(null)
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    })
  }, [
    linkSlackAccount,
    loading,
    requestedSlackAccount,
    requestedSlackUserId,
    slackLink,
    slackLinkError,
  ])

  useEffect(() => {
    if (oktaReconnect) {
      document.getElementById(OKTA_RECONNECT_SETTINGS_HASH)?.scrollIntoView({ block: "start" })
    }

    if (oktaReconnect === "1") {
      setErrorMessage(null)
      setStatusMessage("Authenticate with Okta to refresh MCP Context Forge access.")
      return
    }
    if (oktaReconnect === "complete") {
      setErrorMessage(null)
      setStatusMessage(
        "Okta authentication complete. MCP Context Forge tools can use your refreshed account.",
      )
      void load()
      return
    }
    if (oktaReconnect === "error") {
      setStatusMessage(null)
      setErrorMessage(formatOktaReconnectError(oktaReconnectError))
    }
  }, [load, oktaReconnect, oktaReconnectError])

  const handleLinkGithub = async () => {
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      await authClient.linkSocial({
        provider: "github",
        callbackURL: "/settings",
      })
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    }
  }

  const handleLinkConfiguredProvider = async (
    provider: (typeof configuredLinkProviders)[number],
  ) => {
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      if (provider.kind === "social") {
        await authClient.linkSocial({ provider: provider.id, callbackURL: "/settings" })
      } else {
        await linkOAuthProvider(provider.id, "/settings", "/settings")
      }
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    }
  }

  const handleLinkSlack = async () => {
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      await linkSlackAccount(requestedSlackUserId)
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    }
  }

  const handleReconnectOkta = async () => {
    setStatusMessage(null)
    setErrorMessage(null)

    setReconnectingOkta(true)
    try {
      await reconnectOkta(
        buildOktaReconnectSettingsPath("complete", { hash: false }),
        buildOktaReconnectSettingsPath("error", { hash: false }),
      )
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    } finally {
      setReconnectingOkta(false)
    }
  }

  const handleGenerateSessionTransferUrl = async () => {
    setStatusMessage(null)
    setErrorMessage(null)
    setGeneratingSessionTransfer(true)

    try {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const params = new URLSearchParams({ redirect })
      const response = await fetch(`/api/auth/session-transfer?${params.toString()}`, {
        headers: { accept: "application/json" },
      })
      const payload = (await response.json().catch(() => ({}))) as SessionTransferPayload

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate session transfer URL")
      }
      if (!payload.redeemUrl) {
        throw new Error("Session transfer response did not include a URL")
      }

      setSessionTransferUrl(payload.redeemUrl)
      setSessionTransferExpiresAt(payload.expiresAt ?? null)

      const copied = await copyToClipboard(payload.redeemUrl)
      setStatusMessage(
        copied ? "Session transfer URL copied to clipboard." : "Session transfer URL generated.",
      )
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    } finally {
      setGeneratingSessionTransfer(false)
    }
  }

  const handleCopySessionTransferUrl = async () => {
    if (!sessionTransferUrl) {
      return
    }

    const copied = await copyToClipboard(sessionTransferUrl)
    if (copied) {
      setStatusMessage("Session transfer URL copied to clipboard.")
    }
  }

  const handleCreateApiKey = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatusMessage(null)
    setErrorMessage(null)
    setNewApiKey(null)

    const response = await fetch("/api/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: apiKeyLabel.trim() || undefined }),
    })
    const payload = (await response.json()) as {
      error?: string
      key?: string
    }
    if (!response.ok) {
      setErrorMessage(payload.error ?? "Failed to create API key")
      return
    }

    setApiKeyLabel("")
    setNewApiKey(payload.key ?? null)
    setStatusMessage("API key created.")
    await load()
  }

  const handleRevokeApiKey = async (keyId: string) => {
    setStatusMessage(null)
    setErrorMessage(null)
    const response = await fetch(`/api/auth/api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    })
    const payload = (await response.json()) as { error?: string }
    if (!response.ok) {
      setErrorMessage(payload.error ?? "Failed to revoke API key")
      return
    }

    setStatusMessage("API key revoked.")
    await load()
  }

  const handleSaveContextForgeToken = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatusMessage(null)
    setErrorMessage(null)

    const response = await fetch("/api/sessions/mcpcf/contextforge-token", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: contextForgeToken.trim() || undefined,
        clearToken: clearContextForgeToken,
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as ContextForgeTokenSettings
    if (!response.ok) {
      setErrorMessage(payload.error ?? "Failed to save ContextForge API token")
      return
    }

    setContextForgeTokenSettings(payload)
    setContextForgeToken("")
    setClearContextForgeToken(false)
    appToastManager.add({
      title: payload.configured
        ? "ContextForge API token saved."
        : "ContextForge API token cleared.",
      timeout: 5000,
    })
  }

  const handleUnlinkAccount = async (providerId: string, accountId?: string) => {
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      await authClient.unlinkAccount({
        providerId,
        ...(accountId ? { accountId } : {}),
      })
      setStatusMessage(`${providerId} account unlinked.`)
      await load()
    } catch (errorValue) {
      setErrorMessage(errorValue instanceof Error ? errorValue.message : String(errorValue))
    }
  }

  return (
    <SettingsDocsLayout
      title="Accounts"
      titleId="settings-accounts"
      description="Manage linked identities and per-user API keys."
      tocItems={ACCOUNT_TOC_ITEMS}
    >
      {statusMessage && (
        <div className="mb-4 rounded-lg border border-kumo-success bg-kumo-success-tint px-3 py-2 text-sm text-kumo-success">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 rounded-lg border border-kumo-danger bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">
          {errorMessage}
        </div>
      )}

      <section className="space-y-8">
        <SettingsDocsSectionHeading id="account-authentication" level="h2" title="Authentication" />

        {genericLinkProviders.length > 0 ? (
          <section className="space-y-3">
            <SettingsDocsSectionHeading
              id="connected-auth-providers"
              level="h3"
              title="Connected Providers"
            >
              <p className="text-sm text-kumo-subtle">
                Link an identity explicitly. Matching email addresses never merge accounts.
              </p>
            </SettingsDocsSectionHeading>
            {genericLinkProviders.map((provider) => {
              const account = accounts.find((item) => item.providerId === provider.id)
              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-kumo-line p-3"
                >
                  <div>
                    <div className="text-sm text-kumo-default">{provider.displayName}</div>
                    <div className="text-xs text-kumo-subtle">
                      {account
                        ? `Linked: ${formatAccountTimestamp(account.createdAt)}`
                        : "Not linked"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      account
                        ? handleUnlinkAccount(provider.id, account.accountId)
                        : void handleLinkConfiguredProvider(provider)
                    }
                    className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint"
                  >
                    {account ? "Unlink" : "Link"}
                  </button>
                </div>
              )
            })}
          </section>
        ) : null}

        {providerCanLink("okta") || oktaAccount ? (
          <section className="space-y-3">
            <SettingsDocsSectionHeading
              id={OKTA_RECONNECT_SETTINGS_HASH}
              level="h3"
              title="MCP Context Forge OAuth"
            >
              <p className="text-sm text-kumo-subtle">
                Authenticate with the configured Okta integration again to refresh the stored scopes
                used by MCP Context Forge tools. This integration is independent of the deployment's
                default sign-in provider.
              </p>
            </SettingsDocsSectionHeading>
            <div className="flex flex-col gap-4 rounded-xl border border-kumo-line p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-kumo-default">
                  {oktaAccount
                    ? `Signed in with Okta account ${oktaAccount.accountId}.`
                    : "Signed in with Okta."}
                </div>
                <div className="text-xs text-kumo-subtle">
                  {oktaAccount
                    ? `Linked: ${formatAccountTimestamp(oktaAccount.createdAt)}`
                    : "Authenticate with Okta to update the linked account."}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-44">
                <button
                  type="button"
                  onClick={handleReconnectOkta}
                  disabled={reconnectingOkta}
                  className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reconnectingOkta ? "Connecting..." : "Authenticate with Okta"}
                </button>
                {sessionTransferAvailable && (
                  <button
                    type="button"
                    onClick={handleGenerateSessionTransferUrl}
                    disabled={generatingSessionTransfer}
                    className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {generatingSessionTransfer ? "Generating..." : "Share Session"}
                  </button>
                )}
              </div>
            </div>
            {sessionTransferAvailable && sessionTransferUrl && (
              <div className="mt-2 rounded-xl border border-kumo-line bg-kumo-tint px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-kumo-subtle mb-1">
                      Codex sign-in URL
                    </div>
                    <code className="block break-all text-xs text-kumo-default">
                      {sessionTransferUrl}
                    </code>
                    {sessionTransferExpiresAt && (
                      <div className="mt-1 text-xs text-kumo-subtle">
                        Expires: {formatAccountTimestamp(sessionTransferExpiresAt)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopySessionTransferUrl()}
                    className="shrink-0 rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className="space-y-3">
          <SettingsDocsSectionHeading id="github-app" level="h3" title="GitHub App">
            <p className="text-sm text-kumo-subtle">
              GitHub is optional for repo-less chats, but required for repository discovery and
              repo-backed sandbox agents that clone, push branches, and open pull requests.
            </p>
          </SettingsDocsSectionHeading>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-kumo-line p-3">
            <div className="min-w-0">
              <div className="text-sm text-kumo-default">
                {githubAccount && githubProfile?.login ? (
                  <a
                    href={githubProfile.html_url ?? `https://github.com/${githubProfile.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    @{githubProfile.login}
                  </a>
                ) : githubAccount ? (
                  "GitHub account linked"
                ) : (
                  "No GitHub account linked"
                )}
              </div>
              <div className="text-xs text-kumo-subtle">
                {githubAccount
                  ? `Linked: ${formatAccountTimestamp(githubAccount.createdAt)}`
                  : "Link a GitHub account to enable repo-backed agents."}
              </div>
            </div>
            {githubAccount ? (
              <button
                type="button"
                onClick={() => handleUnlinkAccount("github", githubAccount.accountId)}
                className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint"
              >
                Unlink
              </button>
            ) : providerCanLink("github") ? (
              <button
                type="button"
                onClick={handleLinkGithub}
                className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint"
              >
                Link GitHub
              </button>
            ) : (
              <span className="text-xs text-kumo-subtle">Not enabled in the stage config</span>
            )}
          </div>
        </section>
      </section>

      <section className="space-y-8">
        <SettingsDocsSectionHeading id="account-credentials" level="h2" title="Credentials" />

        <section className="space-y-3">
          <SettingsDocsSectionHeading
            id="contextforge-api-token"
            level="h3"
            title="ContextForge API Token"
          >
            <p className="text-sm text-kumo-subtle">
              This token is used for every token-based MCP Context Forge server selected in your
              sessions.
            </p>
          </SettingsDocsSectionHeading>
          <form
            className="rounded-xl border border-kumo-line p-3"
            onSubmit={(event) => void handleSaveContextForgeToken(event)}
          >
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-kumo-default">
                  {contextForgeTokenSettings?.configured
                    ? "ContextForge API token configured."
                    : "No ContextForge API token configured."}
                </div>
                <div className="text-xs text-kumo-subtle">
                  {contextForgeTokenSettings
                    ? `${contextForgeTokenSettings.tokenAuthServerCount} token-based MCPs use this credential.`
                    : "Loading ContextForge token settings..."}
                </div>
              </div>
              {contextForgeTokenSettings?.contextForgeApiKeysUrl ||
              contextForgeTokenSettings?.contextForgeUrl ? (
                <a
                  href={
                    contextForgeTokenSettings.contextForgeApiKeysUrl ??
                    contextForgeTokenSettings.contextForgeUrl
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm text-kumo-default hover:underline"
                >
                  Open ContextForge API keys
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={contextForgeToken}
                onChange={(event) => {
                  setContextForgeToken(event.target.value)
                  setClearContextForgeToken(false)
                }}
                placeholder={
                  contextForgeTokenSettings?.configured
                    ? "Leave blank to keep token"
                    : "ContextForge API token"
                }
                className="h-10 min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-control px-3 text-sm text-kumo-default outline-none focus:ring-1 focus:ring-kumo-brand"
              />
              {contextForgeTokenSettings?.configured ? (
                <label className="flex h-10 items-center gap-2 rounded-lg border border-kumo-line px-3 text-sm text-kumo-subtle">
                  <input
                    type="checkbox"
                    checked={clearContextForgeToken}
                    onChange={(event) => {
                      setClearContextForgeToken(event.target.checked)
                      setContextForgeToken((current) => (event.target.checked ? "" : current))
                    }}
                  />
                  Clear
                </label>
              ) : null}
              <button
                type="submit"
                disabled={!contextForgeToken.trim() && !clearContextForgeToken}
                className="h-10 rounded-lg border border-kumo-line px-3 text-sm transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </form>
        </section>

        <section className="space-y-3">
          <SettingsDocsSectionHeading id="api-keys" level="h3" title="API Keys">
            <p className="text-sm text-kumo-subtle">
              Use an API key to programmatically access{" "}
              <a
                href={fpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-kumo-default hover:underline"
              >
                {fpUrl}
              </a>
              .
            </p>
          </SettingsDocsSectionHeading>
          <form className="flex gap-2 mb-3" onSubmit={handleCreateApiKey}>
            <input
              value={apiKeyLabel}
              onChange={(event) => setApiKeyLabel(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-kumo-line bg-kumo-control px-3 py-2 text-sm"
              placeholder="Optional label (e.g. CI key)"
            />
            <button
              type="submit"
              className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint"
            >
              Create
            </button>
          </form>

          {newApiKey && (
            <div className="mb-3 break-all rounded-lg border border-kumo-warning bg-kumo-warning-tint px-3 py-2 text-sm text-kumo-warning">
              New API key (shown once): <code>{newApiKey}</code>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-kumo-subtle">Loading API keys...</p>
          ) : activeApiKeys.length === 0 ? (
            <p className="text-sm text-kumo-subtle">No active API keys.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-kumo-line">
              {activeApiKeys.map((item) => (
                <div key={item.keyId} className="px-3 py-2 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-kumo-default truncate">
                      {item.label || item.keyId}
                    </div>
                    <div className="text-xs text-kumo-subtle">
                      last used: {formatTimestamp(item.lastUsedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeApiKey(item.keyId)}
                    className="rounded-lg border border-kumo-line px-2 py-1 text-xs transition hover:bg-kumo-tint"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <SettingsDocsSectionHeading id="slack-accounts" level="h2" title="Slack">
            <p className="text-sm text-kumo-subtle">
              Link your Slack identity so Slack-triggered sessions can resolve back to your GitHub
              access.
            </p>
          </SettingsDocsSectionHeading>
          <button
            type="button"
            onClick={handleLinkSlack}
            disabled={linkingSlack || !providerCanLink("slack")}
            className="rounded-lg border border-kumo-line px-3 py-2 text-sm transition hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60"
          >
            {linkingSlack
              ? "Connecting..."
              : providerCanLink("slack")
                ? "Link Slack"
                : "Slack linking disabled"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-kumo-subtle">Loading Slack accounts...</p>
        ) : slackAccounts.length === 0 ? (
          <p className="text-sm text-kumo-subtle">No Slack accounts linked yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-kumo-line">
            {slackAccounts.map((account) => (
              <div key={account.id} className="px-3 py-2 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-kumo-default truncate">{account.accountId}</div>
                  <div className="text-xs text-kumo-subtle">
                    Linked: {formatAccountTimestamp(account.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnlinkAccount("slack", account.accountId)}
                  className="rounded-lg border border-kumo-line px-2 py-1 text-xs transition hover:bg-kumo-tint"
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </SettingsDocsLayout>
  )
}
