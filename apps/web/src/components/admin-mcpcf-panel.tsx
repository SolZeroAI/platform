"use client"

import type {
  AdminMcpcfConfigPayload,
  AdminMcpcfRefreshResponse,
  AdminMcpcfResponse,
  AdminMcpcfServer,
} from "@c0/api"
import { Badge, type BadgeVariant } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { InputArea } from "@cloudflare/kumo/components/input"
import { Select as KumoSelect } from "@cloudflare/kumo/components/select"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { TableOfContents } from "@cloudflare/kumo/components/table-of-contents"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { useBlocker } from "@tanstack/react-router"
import { FileCode2, MoreVertical, RefreshCw, RotateCcw, Save, X } from "lucide-react"
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"
import {
  DocsSectionHeading,
  EnvLockIcon,
  Field,
  getPendingAdminSectionHash,
  navigateToAdminSection,
} from "@/components/admin-ai-provider-panel-ui"
import { C0Loader, TableCellState } from "@/components/c0-loader"
import { CodeSurface } from "@/components/code"
import { McpcfResetConfigDialog } from "@/components/admin-mcpcf-reset-config-dialog"
import { Dialog } from "@/components/ui/dialog"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { getStickySelectPortalRoot } from "@/lib/sticky-select-portal"

const DEFAULT_TOC_SECTION = "#mcpcf-provider"
const TOC_SECTION_VALUES = ["#mcpcf-provider", "#mcpcf-settings", "#mcpcf-server-registry"] as const

type TocSectionValue = (typeof TOC_SECTION_VALUES)[number]

export type McpcfRefreshState = {
  open: boolean
  phase: "validating" | "fetching" | "applying" | "complete" | "failed"
  result: AdminMcpcfRefreshResponse | null
  error: string
}

export function McpcfAdminPanel({
  data,
  loading,
  busy,
  onSave,
  onRefresh,
  onReset,
  onExport,
  onHeaderActionsChange,
}: {
  data: AdminMcpcfResponse | null
  loading: boolean
  busy: string | null
  onSave: (payload: AdminMcpcfConfigPayload) => Promise<boolean>
  onRefresh: () => void
  onReset: () => Promise<boolean>
  onExport: () => Promise<string | null>
  onHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const config = data?.config
  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")
  const [userOauthProviderId, setUserOauthProviderId] = useState("")
  const [expectedIssuer, setExpectedIssuer] = useState("")
  const [adminApiToken, setAdminApiToken] = useState("")
  const [authTypeAllowlist, setAuthTypeAllowlist] = useState("")
  const [serverBlacklist, setServerBlacklist] = useState("")
  const [savedFormState, setSavedFormState] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [selectedTocSection, setSelectedTocSection] = useState(getInitialTocSection)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDotenv, setExportDotenv] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [stickySelectPortalContainer, setStickySelectPortalContainer] =
    useState<HTMLElement | null>(null)
  const configLocked = config?.locked ?? false
  const configLockEnvVar = configLocked ? (config?.envVarName ?? null) : null
  const adminApiTokenLocked = config?.adminApiTokenLocked ?? false
  const adminApiTokenLockEnvVar = adminApiTokenLocked
    ? (config?.adminApiTokenEnvVarName ?? null)
    : null
  const registryLocked = data?.registryLocked ?? false
  const registryLockEnvVar = registryLocked ? (data?.registryEnvVarName ?? null) : null
  const adminApiTokenDisplayValue = adminApiTokenLocked
    ? "Configured from environment"
    : adminApiToken

  useEffect(() => {
    if (!config) {
      return
    }
    setEnabled(config.enabled)
    setBaseUrl(config.baseUrl)
    setUserOauthProviderId(config.userOauthProviderId)
    setExpectedIssuer(config.expectedIssuer ?? "")
    setAdminApiToken("")
    setAuthTypeAllowlist(config.authTypeAllowlist.join(", "))
    setServerBlacklist(config.serverBlacklist.join("\n"))
    setSavedFormState(
      serializeMcpcfConfigPayload(
        buildMcpcfConfigPayload({
          adminApiToken: "",
          authTypeAllowlist: config.authTypeAllowlist.join(", "),
          baseUrl: config.baseUrl,
          enabled: config.enabled,
          expectedIssuer: config.expectedIssuer ?? "",
          serverBlacklist: config.serverBlacklist.join("\n"),
          userOauthProviderId: config.userOauthProviderId,
        }),
      ),
    )
  }, [config])

  const currentPayload = useMemo(
    () =>
      buildMcpcfConfigPayload({
        adminApiToken,
        authTypeAllowlist,
        baseUrl,
        enabled,
        expectedIssuer,
        serverBlacklist,
        userOauthProviderId,
      }),
    [
      adminApiToken,
      authTypeAllowlist,
      baseUrl,
      enabled,
      expectedIssuer,
      serverBlacklist,
      userOauthProviderId,
    ],
  )
  const isDirty = useMemo(() => {
    if (!savedFormState || configLocked) {
      return false
    }
    return serializeMcpcfConfigPayload(currentPayload) !== savedFormState
  }, [configLocked, currentPayload, savedFormState])

  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  })

  const submit = useCallback(async (): Promise<boolean> => {
    const saved = await onSave(currentPayload)
    if (saved) {
      setSavedFormState(
        serializeMcpcfConfigPayload(
          buildMcpcfConfigPayload({
            adminApiToken: "",
            authTypeAllowlist,
            baseUrl,
            enabled,
            expectedIssuer,
            serverBlacklist,
            userOauthProviderId,
          }),
        ),
      )
      setAdminApiToken("")
    }
    return saved
  }, [
    authTypeAllowlist,
    baseUrl,
    currentPayload,
    enabled,
    expectedIssuer,
    onSave,
    serverBlacklist,
    userOauthProviderId,
  ])

  const saveBeforeNavigation = useCallback(async () => {
    if (navigationBlocker.status !== "blocked") {
      return
    }

    setSavingBeforeNavigation(true)
    try {
      const saved = await submit()
      if (saved) {
        navigationBlocker.proceed()
      }
    } finally {
      setSavingBeforeNavigation(false)
    }
  }, [navigationBlocker, submit])

  const handleExportConfig = useCallback(async () => {
    setActionsMenuOpen(false)
    const dotenv = await onExport()
    if (dotenv === null) {
      return
    }
    setExportDotenv(dotenv)
    setExportDialogOpen(true)
  }, [onExport])

  const handleResetConfig = useCallback(() => {
    setActionsMenuOpen(false)
    setResetConfirmOpen(true)
  }, [])

  const handleConfirmResetConfig = useCallback(async () => {
    const reset = await onReset()
    if (reset) {
      setResetConfirmOpen(false)
      setExportDialogOpen(false)
      setExportDotenv(null)
    }
  }, [onReset])

  useEffect(() => {
    if (!onHeaderActionsChange) {
      return
    }

    onHeaderActionsChange(
      isDirty ? (
        <Button
          type="button"
          variant="primary"
          onClick={() => void submit()}
          disabled={busy !== null || loading}
          loading={busy === "mcpcf-save"}
          icon={<Save className="h-4 w-4" aria-hidden />}
        >
          Save
        </Button>
      ) : null,
    )
  }, [busy, isDirty, loading, onHeaderActionsChange, submit])

  useEffect(() => {
    return () => {
      onHeaderActionsChange?.(null)
    }
  }, [onHeaderActionsChange])

  useLayoutEffect(() => {
    setStickySelectPortalContainer(getStickySelectPortalRoot())
  }, [])

  const sectionOptions = useMemo<Array<{ value: TocSectionValue; label: string; depth: 0 | 1 }>>(
    () => [
      { value: "#mcpcf-provider", label: "MCP Context Forge", depth: 0 },
      { value: "#mcpcf-settings", label: "Settings", depth: 1 },
      { value: "#mcpcf-server-registry", label: "Server Registry", depth: 1 },
    ],
    [],
  )
  const selectedTocValue = sectionOptions.some((section) => section.value === selectedTocSection)
    ? selectedTocSection
    : DEFAULT_TOC_SECTION

  useEffect(() => {
    const sectionValues = sectionOptions.map((section) => section.value)
    let animationFrame = 0

    const isVisibleSection = (value: string): value is TocSectionValue =>
      sectionValues.includes(value as TocSectionValue)

    const updateFromHash = () => {
      const nextSection = window.location.hash
      if (isVisibleSection(nextSection)) {
        setSelectedTocSection(nextSection)
      }
    }

    const updateFromScroll = () => {
      if (animationFrame) {
        return
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        const pendingSection = getPendingAdminSectionHash()
        if (pendingSection) {
          if (isVisibleSection(pendingSection)) {
            setSelectedTocSection(pendingSection)
          }
          return
        }
        let activeSection = sectionValues[0] ?? DEFAULT_TOC_SECTION
        for (const sectionValue of sectionValues) {
          const section = document.getElementById(sectionValue.slice(1))
          if (section && section.getBoundingClientRect().top <= 128) {
            activeSection = sectionValue
          }
        }
        setSelectedTocSection(activeSection)
      })
    }

    updateFromHash()
    updateFromScroll()
    window.addEventListener("hashchange", updateFromHash)
    window.addEventListener("resize", updateFromScroll)
    window.addEventListener("scroll", updateFromScroll, true)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      window.removeEventListener("hashchange", updateFromHash)
      window.removeEventListener("resize", updateFromScroll)
      window.removeEventListener("scroll", updateFromScroll, true)
    }
  }, [sectionOptions])

  const navigateToSection = (value: TocSectionValue) => {
    setSelectedTocSection(value)
    navigateToAdminSection(value)
  }

  const tocItemClickHandler = (value: TocSectionValue) => (event: MouseEvent) => {
    event.preventDefault()
    navigateToSection(value)
  }

  // TableOfContents.Group spreads props onto its <li>, so clicks from nested
  // items bubble here too. Only navigate when the group link itself was hit.
  const tocGroupClickHandler = (value: TocSectionValue) => (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('a[data-kumo-part="group-link"]')) {
      return
    }
    event.preventDefault()
    navigateToSection(value)
  }

  return (
    <TooltipProvider>
      <div className="space-y-12">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-kumo-default">MCPs</h1>
          <p className="max-w-3xl text-lg text-kumo-strong">
            MCP Context Forge configuration and server registry for user tool calls.
          </p>
        </div>

        <div className="sticky top-0 z-20 -mx-12 border-b border-kumo-hairline bg-kumo-canvas/95 px-12 py-3 backdrop-blur xl:hidden">
          <KumoSelect
            aria-label="MCP sections"
            value={selectedTocValue}
            container={stickySelectPortalContainer ?? undefined}
            onValueChange={(value) => {
              const nextValue = String(value ?? "")
              if (isTocSectionValue(nextValue)) {
                navigateToSection(nextValue)
              }
            }}
            renderValue={(value) =>
              sectionOptions.find((section) => section.value === value)?.label ??
              "MCP Context Forge"
            }
            className="w-full"
          >
            {sectionOptions.map((section) => (
              <KumoSelect.Option key={section.value} value={section.value}>
                <span className={section.depth === 1 ? "block pl-4" : "block"}>
                  {section.label}
                </span>
              </KumoSelect.Option>
            ))}
          </KumoSelect>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0 space-y-12">
            <section className="space-y-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <DocsSectionHeading id="mcpcf-provider" level="h2" title="MCP Context Forge" />
                <div className="flex items-center gap-2">
                  <DropdownMenu open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
                    <DropdownMenu.Trigger>
                      <Button
                        type="button"
                        shape="circle"
                        variant="ghost"
                        disabled={busy !== null || loading}
                        loading={busy === "mcpcf-export" || busy === "mcpcf-reset"}
                        aria-label="MCP Context Forge configuration actions"
                        title="MCP Context Forge configuration actions"
                        icon={<MoreVertical className="h-4 w-4" aria-hidden />}
                      />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content side="bottom" align="end">
                      <DropdownMenu.Item
                        icon={<FileCode2 className="h-4 w-4 mr-2" aria-hidden />}
                        disabled={busy !== null || loading}
                        onClick={() => void handleExportConfig()}
                      >
                        Export config
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        icon={<RotateCcw className="h-4 w-4 mr-2" aria-hidden />}
                        variant="danger"
                        disabled={busy !== null || loading}
                        onClick={() => void handleResetConfig()}
                      >
                        Reset config
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu>
                  <EnvLockIcon envVarName={configLockEnvVar} />
                  <Switch
                    aria-label="Enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    size="sm"
                    disabled={configLocked}
                  />
                </div>
              </div>

              <div className="max-w-2xl space-y-5">
                <DocsSectionHeading id="mcpcf-settings" level="h3" title="Settings" />
                <div className="space-y-5">
                  <Field
                    label="Base URL"
                    value={baseUrl}
                    onChange={setBaseUrl}
                    disabled={configLocked}
                    disabledEnvVarName={configLockEnvVar}
                    required={enabled}
                  />
                  <Field
                    label="User OAuth provider ID"
                    value={userOauthProviderId}
                    onChange={setUserOauthProviderId}
                    placeholder="okta"
                    disabled={configLocked}
                    disabledEnvVarName={configLockEnvVar}
                  />
                  <Field
                    label="Expected issuer"
                    value={expectedIssuer}
                    onChange={setExpectedIssuer}
                    placeholder="Optional"
                    disabled={configLocked}
                    disabledEnvVarName={configLockEnvVar}
                  />
                  <Field
                    label={
                      adminApiTokenLocked
                        ? "Admin API token"
                        : config?.adminApiTokenConfigured
                          ? "Replace admin API token"
                          : "Admin API token"
                    }
                    value={adminApiTokenDisplayValue}
                    onChange={setAdminApiToken}
                    placeholder={
                      adminApiTokenLocked
                        ? "Configured from environment"
                        : config?.adminApiTokenConfigured
                          ? "Token configured"
                          : "Bearer token"
                    }
                    type={adminApiTokenLocked ? "text" : "password"}
                    disabled={configLocked || adminApiTokenLocked}
                    disabledEnvVarName={
                      adminApiTokenLocked ? adminApiTokenLockEnvVar : configLockEnvVar
                    }
                    required={enabled && !config?.adminApiTokenConfigured && !adminApiTokenLocked}
                  />
                  <Field
                    label="Auth type allowlist"
                    value={authTypeAllowlist}
                    onChange={setAuthTypeAllowlist}
                    placeholder="oauth, oidc"
                    disabled={configLocked}
                    disabledEnvVarName={configLockEnvVar}
                  />
                  <InputArea
                    label={<LockedLabel label="Server blacklist" envVarName={configLockEnvVar} />}
                    value={serverBlacklist}
                    onChange={(event) => setServerBlacklist(event.target.value)}
                    className="min-h-24 w-full"
                    placeholder="One exact server id or slug per line"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={configLocked}
                    readOnly={configLocked}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <DocsSectionHeading
                  id="mcpcf-server-registry"
                  level="h3"
                  title="Server Registry"
                  trailing={
                    <div className="flex items-center gap-2">
                      <EnvLockIcon envVarName={registryLockEnvVar} />
                      <Button
                        type="button"
                        onClick={onRefresh}
                        disabled={busy !== null || !config?.adminApiTokenConfigured}
                        loading={busy === "mcpcf-refresh"}
                        variant="secondary"
                        icon={<RefreshCw className="h-4 w-4" aria-hidden />}
                      >
                        Refresh Registry
                      </Button>
                    </div>
                  }
                />
                <div className="overflow-hidden rounded-lg bg-kumo-elevated/80 [container-type:inline-size]">
                  <KumoTable layout="fixed" className="w-full text-sm">
                    <colgroup>
                      <col className="w-[44%]" />
                      <col className="w-[14%]" />
                      <col className="w-[10%]" />
                      <col className="w-[18%]" />
                      <col />
                    </colgroup>
                    <KumoTable.Header variant="compact" className="text-kumo-subtle!">
                      <KumoTable.Row>
                        <KumoTable.Head>Server</KumoTable.Head>
                        <KumoTable.Head>Auth</KumoTable.Head>
                        <KumoTable.Head>Tools</KumoTable.Head>
                        <KumoTable.Head>Status</KumoTable.Head>
                        <KumoTable.Head>Seen</KumoTable.Head>
                      </KumoTable.Row>
                    </KumoTable.Header>
                    <KumoTable.Body>
                      {(data?.servers ?? []).length === 0 ? (
                        <KumoTable.Row>
                          <KumoTable.Cell colSpan={5} className="h-32 text-kumo-subtle">
                            <TableCellState className="h-full">
                              {loading ? (
                                <C0Loader size={32} />
                              ) : (
                                "No MCP Context Forge servers discovered."
                              )}
                            </TableCellState>
                          </KumoTable.Cell>
                        </KumoTable.Row>
                      ) : (
                        data!.servers.map((server) => (
                          <McpcfServerRow key={server.id} server={server} />
                        ))
                      )}
                    </KumoTable.Body>
                  </KumoTable>
                </div>
              </div>
            </section>
          </div>

          <TableOfContents className="hidden xl:sticky xl:top-4 xl:block xl:self-start xl:pl-6">
            <TableOfContents.Title>On this page</TableOfContents.Title>
            <TableOfContents.List>
              <TableOfContents.Group
                label="MCP Context Forge"
                href="#mcpcf-provider"
                active={selectedTocValue === "#mcpcf-provider"}
                onClick={tocGroupClickHandler("#mcpcf-provider")}
              >
                <TableOfContents.Item
                  href="#mcpcf-settings"
                  active={selectedTocValue === "#mcpcf-settings"}
                  onClick={tocItemClickHandler("#mcpcf-settings")}
                >
                  Settings
                </TableOfContents.Item>
                <TableOfContents.Item
                  href="#mcpcf-server-registry"
                  active={selectedTocValue === "#mcpcf-server-registry"}
                  onClick={tocItemClickHandler("#mcpcf-server-registry")}
                >
                  Server Registry
                </TableOfContents.Item>
              </TableOfContents.Group>
            </TableOfContents.List>
          </TableOfContents>
        </div>

        {exportDotenv !== null ? (
          <CodeSurface
            title="MCP Context Forge deployment configuration"
            description="Merge the JSONC fragment into the active stage config file and place any separate secret assignment in the stage environment."
            value={exportDotenv}
            language="text"
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            trigger={() => null}
          />
        ) : null}

        <McpcfResetConfigDialog
          open={resetConfirmOpen}
          resetting={busy === "mcpcf-reset"}
          confirmDisabled={busy !== null && busy !== "mcpcf-reset"}
          onOpenChange={(open) => {
            if (busy === "mcpcf-reset") {
              return
            }
            setResetConfirmOpen(open)
          }}
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={() => void handleConfirmResetConfig()}
        />

        {navigationBlocker.status === "blocked" ? (
          <UnsavedChangesModal
            saving={savingBeforeNavigation || busy === "mcpcf-save"}
            description="MCP Context Forge settings have unsaved changes. Save before leaving, or continue without saving."
            onSave={() => void saveBeforeNavigation()}
            onLeave={navigationBlocker.proceed}
            onCancel={navigationBlocker.reset}
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function buildMcpcfConfigPayload(input: {
  adminApiToken: string
  authTypeAllowlist: string
  baseUrl: string
  enabled: boolean
  expectedIssuer: string
  serverBlacklist: string
  userOauthProviderId: string
}): AdminMcpcfConfigPayload {
  return {
    enabled: input.enabled,
    baseUrl: input.baseUrl,
    userOauthProviderId: input.userOauthProviderId,
    expectedIssuer: input.expectedIssuer.trim() || null,
    authTypeAllowlist: splitList(input.authTypeAllowlist),
    serverBlacklist: splitList(input.serverBlacklist),
    ...(input.adminApiToken.trim() ? { adminApiToken: input.adminApiToken.trim() } : {}),
  }
}

function serializeMcpcfConfigPayload(payload: AdminMcpcfConfigPayload): string {
  return JSON.stringify(payload)
}

function LockedLabel({ label, envVarName }: { label: string; envVarName?: string | null }) {
  return (
    <div className="flex w-full items-center justify-between gap-3 text-sm font-medium text-kumo-default">
      <span className="min-w-0 truncate">{label}</span>
      <EnvLockIcon envVarName={envVarName} />
    </div>
  )
}

function getInitialTocSection(): TocSectionValue {
  if (typeof window === "undefined") {
    return DEFAULT_TOC_SECTION
  }
  return isTocSectionValue(window.location.hash) ? window.location.hash : DEFAULT_TOC_SECTION
}

function isTocSectionValue(value: string): value is TocSectionValue {
  return TOC_SECTION_VALUES.includes(value as TocSectionValue)
}

function McpcfServerRow({ server }: { server: AdminMcpcfServer }) {
  return (
    <KumoTable.Row className="bg-kumo-base transition hover:bg-kumo-tint/60">
      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-3 align-top">
        <IdentityCell title={server.label} subtitle={`${server.slug} · ${server.id}`} mono />
        {server.description ? (
          <div className="mt-1 max-w-xl break-words text-xs text-kumo-subtle">
            {server.description}
          </div>
        ) : null}
      </KumoTable.Cell>
      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-3 align-top text-kumo-subtle">
        {server.authType ?? "unknown"}
      </KumoTable.Cell>
      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-3 align-top tabular-nums text-kumo-subtle">
        {server.toolCount}
      </KumoTable.Cell>
      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-3 align-top">
        <StatusBadge
          status={server.sourceStatus}
          label={server.filterReason ? `${server.sourceStatus}: ${server.filterReason}` : undefined}
        />
      </KumoTable.Cell>
      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-3 align-top text-kumo-subtle">
        {formatTime(server.lastSeenAt)}
      </KumoTable.Cell>
    </KumoTable.Row>
  )
}

export function McpcfRefreshDialog({
  state,
  onClose,
}: {
  state: McpcfRefreshState
  onClose: () => void
}) {
  const phases = [
    { id: "validating", label: "Validating config" },
    { id: "fetching", label: "Fetching registry" },
    { id: "applying", label: "Applying changes" },
    { id: "complete", label: "Complete" },
  ] as const
  const activeIndex =
    state.phase === "failed"
      ? phases.findIndex((phase) => phase.id === "applying")
      : phases.findIndex((phase) => phase.id === state.phase)
  const progress =
    state.phase === "failed"
      ? 100
      : Math.round(((Math.max(activeIndex, 0) + 1) / phases.length) * 100)

  const canClose = state.phase === "complete" || state.phase === "failed"

  return (
    <Dialog.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && canClose) {
          onClose()
        }
      }}
    >
      <Dialog size="lg" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b border-kumo-hairline px-4 py-3">
          <div>
            <Dialog.Title className="text-sm font-medium">
              Refresh MCP Context Forge Registry
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-kumo-subtle">
              Registry changes apply immediately after refresh completes.
            </Dialog.Description>
          </div>
          <Button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            shape="circle"
            variant="ghost"
            title="Close"
            aria-label="Close"
            icon={<X className="h-4 w-4" aria-hidden />}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-kumo-tint">
              <div
                className={`h-full transition-[width] ${
                  state.phase === "failed" ? "bg-kumo-danger-tint" : "bg-kumo-contrast"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {phases.map((phase, index) => {
                const isComplete = state.phase === "complete" || index < activeIndex
                const isActive = phase.id === state.phase
                return (
                  <div
                    key={phase.id}
                    className={`rounded-lg border px-2 py-2 text-xs ${
                      isActive || isComplete
                        ? "border-kumo-contrast text-kumo-default"
                        : "border-kumo-line text-kumo-subtle"
                    }`}
                  >
                    {phase.label}
                  </div>
                )
              })}
            </div>
          </div>

          {state.phase === "failed" ? (
            <div className="rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint/10 px-3 py-2 text-sm text-kumo-danger">
              {state.error}
            </div>
          ) : null}

          {state.result ? <McpcfRefreshDiff result={state.result} /> : null}
        </div>
        <div className="flex justify-end border-t border-kumo-hairline px-4 py-3">
          <Button type="button" onClick={onClose} disabled={!canClose} variant="ghost">
            Close
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function McpcfRefreshDiff({ result }: { result: AdminMcpcfRefreshResponse }) {
  const sections: Array<[string, typeof result.added]> = [
    ["Added", result.added],
    ["Updated", result.updated],
    ["Newly filtered", result.filtered],
    ["Blacklisted", result.blacklisted],
    ["No longer discovered", result.missing],
    ["Unchanged", result.unchanged],
  ]

  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        {sections.map(([label, items]) => (
          <div key={label} className="rounded-lg border border-kumo-hairline px-2 py-2">
            <div className="text-kumo-subtle">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{items.length}</div>
          </div>
        ))}
      </div>
      <div className="max-h-72 overflow-auto rounded-xl bg-kumo-elevated/80">
        <KumoTable className="min-w-full text-left text-xs">
          <KumoTable.Header sticky className="bg-kumo-base text-kumo-subtle">
            <KumoTable.Row>
              <KumoTable.Head className="bg-kumo-base px-3 py-2 font-medium">Change</KumoTable.Head>
              <KumoTable.Head className="bg-kumo-base px-3 py-2 font-medium">Server</KumoTable.Head>
              <KumoTable.Head className="bg-kumo-base px-3 py-2 font-medium">Reason</KumoTable.Head>
            </KumoTable.Row>
          </KumoTable.Header>
          <KumoTable.Body>
            {sections.flatMap(([label, items]) =>
              items.map((item) => (
                <KumoTable.Row key={`${label}-${item.id}`} className="bg-kumo-base">
                  <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 text-kumo-subtle">
                    {label}
                  </KumoTable.Cell>
                  <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2">
                    <div className="font-medium text-kumo-default">{item.label}</div>
                    <div className="font-mono text-[11px] text-kumo-subtle">
                      {item.slug} · {item.id}
                    </div>
                  </KumoTable.Cell>
                  <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 text-kumo-subtle">
                    {item.reason ?? "discovered"}
                  </KumoTable.Cell>
                </KumoTable.Row>
              )),
            )}
            {result.failures.map((failure) => (
              <KumoTable.Row
                key={`failure-${failure.id ?? failure.label}`}
                className="bg-kumo-base"
              >
                <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 text-kumo-danger">
                  Failure
                </KumoTable.Cell>
                <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2">
                  <div className="font-medium text-kumo-default">{failure.label ?? failure.id}</div>
                  <div className="font-mono text-[11px] text-kumo-subtle">
                    {failure.id ?? "unknown"}
                  </div>
                </KumoTable.Cell>
                <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2 text-kumo-danger">
                  {failure.error}
                </KumoTable.Cell>
              </KumoTable.Row>
            ))}
            {sections.every(([, items]) => items.length === 0) && result.failures.length === 0 ? (
              <KumoTable.Row className="bg-kumo-base">
                <KumoTable.Cell colSpan={3} className="px-3 py-6 text-center text-kumo-subtle">
                  No registry changes.
                </KumoTable.Cell>
              </KumoTable.Row>
            ) : null}
          </KumoTable.Body>
        </KumoTable>
      </div>
    </div>
  )
}

function IdentityCell({
  title,
  subtitle,
  mono,
}: {
  title: string
  subtitle: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-kumo-default">{title}</div>
      <div className={`truncate text-xs text-kumo-subtle ${mono ? "font-mono" : ""}`}>
        {subtitle}
      </div>
    </div>
  )
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const normalized = status.toLowerCase()
  const variant: BadgeVariant =
    normalized === "completed" || normalized === "active" || normalized === "ready"
      ? "success"
      : normalized === "failed" || normalized === "deleted"
        ? "error"
        : normalized === "archived"
          ? "secondary"
          : "warning"
  return <Badge variant={variant}>{label ?? status}</Badge>
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
