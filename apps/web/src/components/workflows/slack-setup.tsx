import { Button } from "@cloudflare/kumo/components/button"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { type Node } from "@xyflow/react"
import {
  AlertTriangle,
  Bot,
  Check,
  CircleHelp,
  Copy,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Save,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { S0Loader } from "@/components/s0-loader"
import { CodeSurface } from "@/components/code"
import { copyToClipboard } from "@/lib/format"
import {
  WorkflowSlackAppSetup,
  WorkflowSlackManifestValidation,
  WorkflowSlackTriggerRegistrationSummary,
  WorkflowSummary,
} from "./types"
import { WorkflowDialogFrame } from "./detail-chrome"
import { formatSlackRegistrationMatch } from "./save-utils"
import { getErrorMessage, requestJson } from "./run-utils"
import { formatJson } from "./header-utils"

export function WorkflowSlackAppSetupModal({
  workflowId,
  workflowName,
  workflowStatus,
  onClose,
}: {
  workflowId: string
  workflowName: string
  workflowStatus: WorkflowSummary["status"]
  onClose: () => void
}) {
  const [setup, setSetup] = useState<WorkflowSlackAppSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const [botToken, setBotToken] = useState("")
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [credentialsError, setCredentialsError] = useState("")
  const [credentialsSaved, setCredentialsSaved] = useState(false)

  const loadSetup = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const data = await requestJson<{ slackApp: WorkflowSlackAppSetup }>(
        `/api/workflows/${encodeURIComponent(workflowId)}/slack-app`,
      )
      setSetup(data.slackApp)
    } catch (errorValue) {
      setLoadError(getErrorMessage(errorValue))
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    void loadSetup()
  }, [loadSetup])

  const saveCredentials = async () => {
    setCredentialsError("")
    setCredentialsSaved(false)
    const payload: { signingSecret?: string; botToken?: string } = {}
    if (signingSecret.trim()) {
      payload.signingSecret = signingSecret.trim()
    }
    if (botToken.trim()) {
      payload.botToken = botToken.trim()
    }
    if (!payload.signingSecret && !payload.botToken) {
      setCredentialsError("Enter a signing secret or bot token before saving.")
      return
    }

    setSavingCredentials(true)
    try {
      const data = await requestJson<{ slackApp: WorkflowSlackAppSetup }>(
        `/api/workflows/${encodeURIComponent(workflowId)}/slack-app/credentials`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      setSetup(data.slackApp)
      setSigningSecret("")
      setBotToken("")
      setCredentialsSaved(true)
    } catch (errorValue) {
      setCredentialsError(getErrorMessage(errorValue))
    } finally {
      setSavingCredentials(false)
    }
  }

  const commandUrls = setup ? Object.entries(setup.requestUrls.commands) : []
  const ready = Boolean(setup?.status.hasSigningSecret && setup.status.hasBotToken)

  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="xl"
      className="flex max-h-[85vh] w-full max-w-4xl flex-col p-0"
      title="Slack app setup"
      description={workflowName}
      closeLabel="Close Slack app setup dialog"
      headerLeading={
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-kumo-subtle ring-1 ring-kumo-hairline">
          <MessageSquare className="h-4 w-4" aria-hidden />
        </span>
      }
      headerActions={
        <Button
          type="button"
          onClick={() => void loadSetup()}
          disabled={loading}
          shape="circle"
          variant="ghost"
          aria-label="Refresh Slack app setup"
          title="Refresh setup"
          icon={<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />}
        />
      }
      bodyClassName="min-h-0 flex-1 overflow-y-auto px-5 py-4"
    >
      {loading && !setup ? (
        <div className="flex min-h-48 items-center justify-center text-kumo-subtle">
          <S0Loader size={16} />
        </div>
      ) : loadError ? (
        <div className="rounded-lg bg-kumo-danger-tint/10 p-3 text-sm text-kumo-danger ring-1 ring-kumo-danger/30">
          {loadError}
        </div>
      ) : setup ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <WorkflowSlackStatusTile label="Slack app" value={setup.appName} />
            <WorkflowSlackStatusTile label="App ID" value={setup.id} mono />
            <WorkflowSlackStatusTile
              label="Signing secret"
              value={setup.status.hasSigningSecret ? "Stored" : "Missing"}
              ok={setup.status.hasSigningSecret}
            />
            <WorkflowSlackStatusTile
              label="Bot token"
              value={setup.status.hasBotToken ? "Stored" : "Missing"}
              ok={setup.status.hasBotToken}
            />
          </div>

          {workflowStatus === "disabled" ? (
            <div className="flex items-start gap-2 rounded-lg bg-kumo-warning-tint/10 p-3 text-sm text-kumo-warning ring-1 ring-kumo-warning/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Enable this workflow before Slack deliveries can start runs.</span>
            </div>
          ) : !ready ? (
            <div className="flex items-start gap-2 rounded-lg bg-kumo-warning-tint/10 p-3 text-sm text-kumo-warning ring-1 ring-kumo-warning/30">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Store the Slack signing secret and bot token after installing the app.</span>
            </div>
          ) : null}

          <WorkflowSlackManifestValidationNotice validation={setup.validation} />

          <LayerCard className="overflow-hidden rounded-xl">
            <LayerCard.Secondary className="my-0 flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs font-medium">Request URLs</span>
            </LayerCard.Secondary>
            <LayerCard.Primary className="gap-0 overflow-hidden rounded-lg p-0">
              <div className="divide-y divide-kumo-hairline">
                <WorkflowSlackUrlRow
                  label="Events"
                  value={setup.requestUrls.events}
                  helpText="Copy this URL into Slack app settings under Event Subscriptions > Request URL, then enable events. Slack uses it to deliver app_mention, message, and channel lifecycle events."
                />
                <WorkflowSlackUrlRow
                  label="Interactions"
                  value={setup.requestUrls.interactions}
                  helpText="Copy this URL into Slack app settings under Interactivity & Shortcuts > Request URL. Slack uses it for interactive payloads like button clicks, shortcuts, and modal submissions."
                />
                {commandUrls.length > 0 ? (
                  commandUrls.map(([nodeId, url]) => (
                    <WorkflowSlackUrlRow key={nodeId} label={`Command ${nodeId}`} value={url} />
                  ))
                ) : (
                  <div className="px-3 py-3 text-sm text-kumo-subtle">
                    No slash command triggers in this workflow.
                  </div>
                )}
              </div>
            </LayerCard.Primary>
          </LayerCard>

          <section className="grid gap-4">
            <LayerCard className="min-w-0 overflow-hidden rounded-xl">
              <LayerCard.Secondary className="my-0 flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs font-medium">Slack manifest</span>
                <WorkflowSlackCopyButton
                  value={formatJson(setup.manifest)}
                  label="Copy"
                  disabled={!setup.validation.valid}
                  title={
                    setup.validation.valid
                      ? undefined
                      : "Fix local manifest validation errors before copying"
                  }
                />
              </LayerCard.Secondary>
              <LayerCard.Primary className="gap-0 overflow-hidden rounded-lg p-0">
                <CodeSurface
                  title="Slack app manifest"
                  value={formatJson(setup.manifest)}
                  language="json"
                  previewMaxHeightClassName="max-h-80"
                  expandable={false}
                />
              </LayerCard.Primary>
            </LayerCard>

            <LayerCard className="overflow-hidden rounded-xl">
              <LayerCard.Secondary className="my-0 px-3 py-2">
                <span className="text-xs font-medium">Credentials</span>
              </LayerCard.Secondary>
              <LayerCard.Primary className="space-y-3 rounded-lg p-3">
                <WorkflowSlackSecretInput
                  label="Signing secret"
                  value={signingSecret}
                  onChange={setSigningSecret}
                  placeholder={
                    setup.status.hasSigningSecret ? "Stored; paste to replace" : "Required"
                  }
                />
                <WorkflowSlackSecretInput
                  label="Bot token"
                  value={botToken}
                  onChange={setBotToken}
                  placeholder={setup.status.hasBotToken ? "Stored; paste to replace" : "xoxb-"}
                  helpText="In Slack app settings, open OAuth & Permissions, install or reinstall the app, then copy the Bot User OAuth Token. It starts with xoxb-."
                />
                {credentialsError ? (
                  <div className="rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint/10 p-2 text-xs text-kumo-danger">
                    {credentialsError}
                  </div>
                ) : credentialsSaved ? (
                  <div className="rounded-lg border border-kumo-success/30 bg-kumo-success-tint/10 p-2 text-xs text-kumo-success">
                    Credentials saved.
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void saveCredentials()}
                  disabled={savingCredentials}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-kumo-brand px-3 py-2 text-sm font-medium text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] disabled:cursor-wait disabled:opacity-60"
                >
                  {savingCredentials ? <S0Loader size={16} /> : <Save className="h-4 w-4" />}
                  {savingCredentials ? "Saving" : "Save credentials"}
                </button>
              </LayerCard.Primary>
            </LayerCard>
          </section>

          <WorkflowSlackRegistrations registrations={setup.registrations} />
        </div>
      ) : null}
    </WorkflowDialogFrame>
  )
}

export function WorkflowSlackStatusTile({
  label,
  value,
  mono = false,
  ok,
}: {
  label: string
  value: string
  mono?: boolean
  ok?: boolean
}) {
  return (
    <div className="min-w-0 rounded-xl border border-kumo-hairline p-3">
      <div className="text-xs font-medium text-kumo-subtle">{label}</div>
      <div
        className={`mt-1 flex min-w-0 items-center gap-1.5 text-sm text-kumo-default ${
          mono ? "font-mono" : ""
        }`}
      >
        {typeof ok === "boolean" ? (
          ok ? (
            <Check className="h-4 w-4 shrink-0 text-kumo-success" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-kumo-warning" aria-hidden />
          )
        ) : null}
        <span className="min-w-0 truncate">{value}</span>
      </div>
    </div>
  )
}

export function WorkflowSlackInlineHelp({ label, helpText }: { label: string; helpText: string }) {
  const tooltipId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    left: number
    top: number
    side: "left" | "right"
  } | null>(null)

  const showTooltip = () => {
    if (!buttonRef.current) {
      return
    }

    const rect = buttonRef.current.getBoundingClientRect()
    const tooltipWidth = 320
    const rightFits = rect.right + 8 + tooltipWidth <= window.innerWidth - 16
    setTooltipAnchor({
      left: rightFits ? rect.right + 8 : rect.left - 8,
      top: rect.top + rect.height / 2,
      side: rightFits ? "right" : "left",
    })
  }

  const hideTooltip = () => {
    setTooltipAnchor(null)
  }

  useEffect(() => {
    if (!tooltipAnchor) {
      return
    }

    const dismiss = () => setTooltipAnchor(null)
    window.addEventListener("resize", dismiss)
    window.addEventListener("scroll", dismiss, true)
    return () => {
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("scroll", dismiss, true)
    }
  }, [tooltipAnchor])

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} help`}
        aria-describedby={tooltipId}
        onBlur={hideTooltip}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-kumo-subtle outline-none transition-[background-color,color,transform] before:absolute before:-inset-2 before:content-[''] hover:bg-kumo-tint hover:text-kumo-default focus-visible:bg-kumo-tint focus-visible:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-brand/60 active:scale-[0.96]"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>
      {tooltipAnchor
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              style={{
                left: tooltipAnchor.left,
                top: tooltipAnchor.top,
                transform:
                  tooltipAnchor.side === "right" ? "translateY(-50%)" : "translate(-100%, -50%)",
              }}
              className="pointer-events-none fixed z-[1000] w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-kumo-elevated px-3 py-2 text-xs leading-5 text-kumo-default shadow-xl ring-1 ring-kumo-line"
            >
              {helpText}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}

export function WorkflowSlackUrlRow({
  label,
  value,
  helpText,
}: {
  label: string
  value: string
  helpText?: string
}) {
  return (
    <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-1.5 text-xs font-medium text-kumo-subtle">
        <span>{label}</span>
        {helpText ? <WorkflowSlackInlineHelp label={label} helpText={helpText} /> : null}
      </div>
      <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-kumo-hairline bg-kumo-tint px-2 py-1.5 font-mono text-xs text-kumo-default">
        {value}
      </code>
      <WorkflowSlackCopyButton value={value} label="Copy URL" />
    </div>
  )
}

export function WorkflowSlackManifestValidationNotice({
  validation,
}: {
  validation: WorkflowSlackManifestValidation
}) {
  if (validation.valid && validation.warnings.length === 0) {
    return null
  }

  const messages = validation.valid ? validation.warnings : validation.errors
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        validation.valid
          ? "border-kumo-warning/30 bg-kumo-warning-tint/10 text-kumo-warning"
          : "border-kumo-danger/30 bg-kumo-danger-tint/10 text-kumo-danger"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {validation.valid ? "Manifest validation warnings" : "Manifest validation failed"}
      </div>
      <ul className="list-disc space-y-1 pl-5">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  )
}

export function WorkflowSlackCopyButton({
  value,
  label,
  disabled = false,
  title,
}: {
  value: string
  label: string
  disabled?: boolean
  title?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      disabled={disabled}
      title={title}
      onClick={async () => {
        if (disabled) {
          return
        }
        const success = await copyToClipboard(value)
        if (!success) {
          return
        }
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  )
}

export function WorkflowSlackSecretInput({
  label,
  value,
  onChange,
  placeholder,
  helpText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  helpText?: string
}) {
  const inputId = useId()
  return (
    <div className="block">
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="text-xs font-medium text-kumo-subtle">
          {label}
        </label>
        {helpText ? <WorkflowSlackInlineHelp label={label} helpText={helpText} /> : null}
      </div>
      <input
        id={inputId}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-1 min-h-9 w-full rounded-lg border border-kumo-hairline bg-kumo-tint px-2.5 py-2 font-mono text-xs text-kumo-default outline-none transition focus:border-kumo-brand"
      />
    </div>
  )
}

export function WorkflowSlackRegistrations({
  registrations,
}: {
  registrations: WorkflowSlackTriggerRegistrationSummary[]
}) {
  return (
    <LayerCard className="overflow-hidden rounded-xl">
      <LayerCard.Secondary className="my-0 flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs font-medium">Trigger registrations</span>
        <span className="rounded-full border border-kumo-line bg-kumo-tint px-1.5 py-0.5 font-mono text-[11px] text-kumo-subtle">
          {registrations.length}
        </span>
      </LayerCard.Secondary>
      <LayerCard.Primary className="gap-0 overflow-hidden rounded-lg p-0">
        {registrations.length > 0 ? (
          <div className="overflow-x-auto rounded-xl bg-kumo-elevated/80">
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
              <thead className="bg-kumo-tint text-kumo-subtle">
                <tr>
                  <th className="border-b border-kumo-hairline px-3 py-2 font-medium">Node</th>
                  <th className="border-b border-kumo-hairline px-3 py-2 font-medium">Surface</th>
                  <th className="border-b border-kumo-hairline px-3 py-2 font-medium">Match</th>
                  <th className="border-b border-kumo-hairline px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((registration) => (
                  <tr key={registration.id}>
                    <td className="border-b border-kumo-hairline px-3 py-2 font-mono text-kumo-default">
                      {registration.nodeId}
                    </td>
                    <td className="border-b border-kumo-hairline px-3 py-2 text-kumo-default">
                      {registration.surface}
                    </td>
                    <td className="max-w-sm border-b border-kumo-hairline px-3 py-2 text-kumo-subtle">
                      {formatSlackRegistrationMatch(registration)}
                    </td>
                    <td className="border-b border-kumo-hairline px-3 py-2">
                      <span
                        className={`inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-medium ${
                          registration.enabled
                            ? "border-kumo-success/30 bg-kumo-success-tint/10 text-kumo-success"
                            : "border-kumo-line bg-kumo-tint text-kumo-subtle"
                        }`}
                      >
                        {registration.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-3 py-4 text-sm text-kumo-subtle">
            No active Slack trigger registrations for the saved workflow version.
          </div>
        )}
      </LayerCard.Primary>
    </LayerCard>
  )
}
