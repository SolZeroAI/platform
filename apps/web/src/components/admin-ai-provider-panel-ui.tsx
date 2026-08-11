"use client"

import type { AdminCronRunRecord, AdminLitellmModel } from "@solzero/api"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@/components/ui/dialog"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Select as KumoSelect } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Link as LinkIcon,
  Lock,
  XCircle,
} from "lucide-react"
import { useState, type ReactNode } from "react"

const EMPTY_SELECT_VALUE = "__s0_admin_empty__"

const ADAPTER_OPTIONS = [
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai-compatible",
] as const

function scrollAdminSectionIntoView(sectionSelector: string) {
  window.requestAnimationFrame(() => {
    resetAdminDocumentScroll()

    const section = document.querySelector(sectionSelector)
    if (!section) {
      return
    }

    const scrollContainer = findNearestScrollableAncestor(section)
    if (!scrollContainer) {
      section.scrollIntoView({ behavior: "smooth", block: "start" })
      scheduleAdminDocumentScrollReset()
      return
    }

    const sectionRect = section.getBoundingClientRect()
    const containerRect = scrollContainer.getBoundingClientRect()
    const sectionScrollMarginTop = parseFloat(getComputedStyle(section).scrollMarginTop) || 0
    const nextScrollTop =
      scrollContainer.scrollTop + sectionRect.top - containerRect.top - sectionScrollMarginTop

    scrollContainer.scrollTo({ top: Math.max(0, nextScrollTop), behavior: "smooth" })
    scheduleAdminDocumentScrollReset()
  })
}

function findNearestScrollableAncestor(element: Element): HTMLElement | null {
  let current = element.parentElement
  while (current && current !== document.body) {
    const style = getComputedStyle(current)
    if (current.scrollHeight > current.clientHeight + 1 && isScrollableOverflow(style.overflowY)) {
      return current
    }
    current = current.parentElement
  }
  return null
}

function isScrollableOverflow(value: string) {
  return value === "auto" || value === "scroll" || value === "overlay"
}

function scheduleAdminDocumentScrollReset() {
  window.requestAnimationFrame(resetAdminDocumentScroll)
  window.setTimeout(resetAdminDocumentScroll, 0)
  window.setTimeout(resetAdminDocumentScroll, 100)
}

export function resetAdminDocumentScroll() {
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

const PENDING_SECTION_SETTLE_MS = 200

let pendingSectionHash: string | null = null
let pendingSectionSettleTimer = 0

function clearPendingAdminSectionHash() {
  window.clearTimeout(pendingSectionSettleTimer)
  window.removeEventListener("scroll", extendPendingAdminSectionHash, true)
  pendingSectionHash = null
}

function extendPendingAdminSectionHash() {
  window.clearTimeout(pendingSectionSettleTimer)
  pendingSectionSettleTimer = window.setTimeout(
    clearPendingAdminSectionHash,
    PENDING_SECTION_SETTLE_MS,
  )
}

/**
 * Section targeted by an in-flight TOC navigation. Scroll-position trackers
 * should keep this section active instead of recomputing from headings, so a
 * click on a short trailing section (which can never reach the top of the
 * scrollport) is not overridden while the smooth scroll plays out.
 */
export function getPendingAdminSectionHash(): string | null {
  return pendingSectionHash
}

/**
 * Admin pages lock html/body overflow and keep document scroll pinned, so
 * default hash navigation cannot be trusted to scroll the inner content pane.
 * Route in-page section links through the scroll-container-aware path instead.
 */
export function navigateToAdminSection(sectionHash: string) {
  pendingSectionHash = sectionHash
  window.addEventListener("scroll", extendPendingAdminSectionHash, true)
  extendPendingAdminSectionHash()
  scrollAdminSectionIntoView(sectionHash)
  window.history.replaceState(null, "", sectionHash)
}

export function DocsSectionHeading({
  children,
  id,
  level,
  title,
  trailing,
}: {
  children?: ReactNode
  id: string
  level: "h2" | "h3"
  title: string
  trailing?: ReactNode
}) {
  const className =
    level === "h2"
      ? "group relative scroll-mt-24 tracking-tight text-2xl font-semibold text-kumo-default"
      : "group relative scroll-mt-24 tracking-tight text-xl font-semibold text-kumo-default"
  const content = (
    <a
      href={`#${id}`}
      className="no-underline hover:underline"
      aria-label={`Link to section: ${title}`}
      onClick={(event) => {
        event.preventDefault()
        navigateToAdminSection(`#${id}`)
      }}
    >
      <span
        className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-hidden="true"
      >
        <LinkIcon className="size-4 text-kumo-subtle" />
      </span>
      {title}
    </a>
  )

  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-3 ${trailing ? "justify-between" : ""}`}>
        {level === "h2" ? (
          <h2 id={id} className={className}>
            {content}
          </h2>
        ) : (
          <h3 id={id} className={className}>
            {content}
          </h3>
        )}
        {trailing}
      </div>
      {children}
    </div>
  )
}

export function ModelAdapterRow({
  model,
  adapter,
  overridden,
  disabled,
  onChange,
  onReset,
}: {
  model: AdminLitellmModel
  adapter: string
  overridden: boolean
  disabled: boolean
  onChange: (adapter: string) => void
  onReset: () => void
}) {
  const reasoningLabel =
    model.reasoningEfforts.length > 0 ? model.reasoningEfforts.join(", ") : "none"
  const reasoningNeedsEllipsis = reasoningLabel.length > 24

  return (
    <KumoTable.Row>
      <KumoTable.Cell className="align-top">
        <div className="max-w-[320px] truncate font-medium text-kumo-default">{model.id}</div>
        <div className="max-w-[320px] truncate text-xs text-kumo-subtle">
          {model.provider ?? "unknown"} · {model.upstreamModel ?? "no upstream id"}
        </div>
      </KumoTable.Cell>
      <KumoTable.Cell className="align-top text-kumo-subtle">
        <Tooltip
          content={reasoningLabel}
          delay={250}
          render={<span />}
          className="relative block h-10 max-w-[12rem] overflow-hidden pr-5 leading-5"
        >
          <span>{reasoningLabel}</span>
          {reasoningNeedsEllipsis ? (
            <span className="pointer-events-none absolute bottom-0 right-0" aria-hidden>
              ...
            </span>
          ) : null}
        </Tooltip>
      </KumoTable.Cell>
      <KumoTable.Cell className="align-top">
        <div className="flex flex-wrap items-center gap-2">
          <KumoSelect
            value={adapter}
            onValueChange={(value) => onChange(String(value ?? ""))}
            size="sm"
            aria-label={`Adapter for ${model.id}`}
            className="min-w-[220px]"
            disabled={disabled}
          >
            {ADAPTER_OPTIONS.map((option) => (
              <KumoSelect.Option key={option} value={option}>
                {option}
              </KumoSelect.Option>
            ))}
          </KumoSelect>
          {overridden ? (
            <Button type="button" onClick={onReset} variant="ghost" size="xs" disabled={disabled}>
              Reset
            </Button>
          ) : null}
        </div>
      </KumoTable.Cell>
    </KumoTable.Row>
  )
}

type LitellmSyncOutcome =
  | { kind: "failure"; run: AdminCronRunRecord }
  | { kind: "success"; run: AdminCronRunRecord }

/**
 * Scheduled runs outside the 9 AM America/New_York window are recorded as
 * "skipped" and often become the newest row, so fall back to the most recent
 * success/failure outcome instead of hiding the indicator.
 */
function resolveLitellmSyncOutcome({
  latestFailure,
  latestRun,
  latestSuccess,
}: {
  latestFailure: AdminCronRunRecord | null | undefined
  latestRun: AdminCronRunRecord | null | undefined
  latestSuccess: AdminCronRunRecord | null | undefined
}): LitellmSyncOutcome | null {
  if (latestRun?.status === "failure") {
    return { kind: "failure", run: latestFailure ?? latestRun }
  }
  if (latestRun?.status === "success") {
    return { kind: "success", run: latestSuccess ?? latestRun }
  }
  if (latestFailure && (!latestSuccess || latestFailure.finishedAt > latestSuccess.finishedAt)) {
    return { kind: "failure", run: latestFailure }
  }
  if (latestSuccess) {
    return { kind: "success", run: latestSuccess }
  }
  return null
}

export function LitellmSyncStatusIndicator({
  latestFailure,
  latestRun,
  latestSuccess,
}: {
  latestFailure: AdminCronRunRecord | null | undefined
  latestRun: AdminCronRunRecord | null | undefined
  latestSuccess: AdminCronRunRecord | null | undefined
}) {
  const [failureDialogOpen, setFailureDialogOpen] = useState(false)
  const outcome = resolveLitellmSyncOutcome({ latestFailure, latestRun, latestSuccess })

  if (!outcome) {
    return null
  }

  if (outcome.kind === "failure") {
    const failure = outcome.run
    const errorMessage = failure.errorMessage ?? "No error message was recorded for this sync run."
    return (
      <>
        <Tooltip content={`Latest sync failed ${formatRelativeRunTime(failure)}.`} delay={250}>
          <Button
            type="button"
            variant="ghost"
            shape="square"
            size="sm"
            onClick={() => setFailureDialogOpen(true)}
            aria-label="View latest LiteLLM sync failure"
            aria-haspopup="dialog"
            aria-expanded={failureDialogOpen}
            className="text-kumo-danger! not-disabled:hover:bg-kumo-danger-tint/10"
            icon={<XCircle className="h-4 w-4" aria-hidden />}
          />
        </Tooltip>
        <Dialog.Root open={failureDialogOpen} onOpenChange={setFailureDialogOpen}>
          <Dialog size="lg" className="flex max-h-[85vh] w-full max-w-2xl flex-col p-0">
            <div className="border-b border-kumo-hairline px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-kumo-default">
                LiteLLM model sync failed
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                Latest failure {formatRelativeRunTime(failure)}.
              </Dialog.Description>
            </div>
            <div className="transparent-scrollbar max-h-[60vh] overflow-y-auto px-5 py-4">
              <div className="rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint/10 p-3 text-sm text-kumo-danger">
                <pre className="whitespace-pre-wrap break-words font-mono">{errorMessage}</pre>
              </div>
            </div>
            <div className="flex justify-end border-t border-kumo-hairline px-5 py-4">
              <Button type="button" onClick={() => setFailureDialogOpen(false)} variant="ghost">
                Close
              </Button>
            </div>
          </Dialog>
        </Dialog.Root>
      </>
    )
  }

  const success = outcome.run
  return (
    <Tooltip content={`Last successful sync ${formatRelativeRunTime(success)}.`} delay={250}>
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-kumo-success"
        aria-label="Latest LiteLLM model sync succeeded"
        role="img"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      </span>
    </Tooltip>
  )
}

export function EnvLockIcon({
  envVarName,
  envVarNames,
}: {
  envVarName?: string | null
  envVarNames?: Array<string | null | undefined>
}) {
  const envVars = envVarNames ? uniqueEnvVars(envVarNames) : uniqueEnvVars([envVarName])
  if (envVars.length === 0) {
    return null
  }
  const configurationSourceLabel = envVars.join(", ")
  const plural = envVars.length > 1
  return (
    <Tooltip
      content={`Managed by ${configurationSourceLabel}. Remove ${
        plural ? "those fields" : "that field"
      } from deployment configuration and redeploy to edit ${
        plural ? "these values" : "this value"
      } in Admin.`}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-sm text-kumo-subtle hover:text-kumo-default"
      delay={250}
    >
      <span className="sr-only">Controlled by {configurationSourceLabel}</span>
      <Lock className="h-3.5 w-3.5" aria-hidden />
    </Tooltip>
  )
}

export function Field({
  label,
  helpText,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  disabledEnvVarName,
  error,
  required,
}: {
  label: string
  helpText?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  disabledEnvVarName?: string | null
  error?: string
  required?: boolean
}) {
  const envVarName = disabled ? disabledEnvVarName : null
  const labelNode = <LockedLabel label={label} helpText={helpText} envVarName={envVarName} />
  const hasExternalLabel = Boolean(helpText || envVarName)
  const inputGroup = (
    <InputGroup
      label={hasExternalLabel ? undefined : labelNode}
      disabled={disabled}
      required={required || undefined}
      error={error ? { message: error, match: true } : undefined}
      className="w-full"
    >
      <InputGroup.Input
        aria-label={label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        passwordManagerIgnore
        readOnly={disabled}
        tabIndex={disabled ? -1 : undefined}
      />
    </InputGroup>
  )

  if (!hasExternalLabel) {
    return inputGroup
  }

  return (
    <div className="grid w-full gap-2">
      {labelNode}
      {inputGroup}
      {error ? <p className="text-sm leading-snug text-kumo-danger">{error}</p> : null}
    </div>
  )
}

export function SelectField({
  label,
  helpText,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  disabledEnvVarName,
  error,
  portalContainer,
}: {
  label: string
  helpText?: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  disabledEnvVarName?: string | null
  error?: string
  portalContainer?: HTMLElement | null
}) {
  const selectedValue = value || EMPTY_SELECT_VALUE
  const envVarName = disabled ? disabledEnvVarName : null
  const labelNode = <LockedLabel label={label} helpText={helpText} envVarName={envVarName} />
  const hasExternalLabel = Boolean(helpText || envVarName)
  const select = (
    <KumoSelect
      label={hasExternalLabel ? undefined : labelNode}
      aria-label={hasExternalLabel ? label : undefined}
      value={selectedValue}
      onValueChange={(nextValue) =>
        onChange(nextValue === EMPTY_SELECT_VALUE ? "" : String(nextValue ?? ""))
      }
      renderValue={(nextValue) => {
        if (nextValue === EMPTY_SELECT_VALUE) {
          return placeholder
        }
        return options.find((option) => option.value === nextValue)?.label ?? String(nextValue)
      }}
      disabled={disabled}
      placeholder={placeholder}
      error={error ? { message: error, match: true } : undefined}
      container={portalContainer ?? undefined}
      className="w-full"
    >
      <KumoSelect.Option value={EMPTY_SELECT_VALUE}>{placeholder}</KumoSelect.Option>
      {options.map((option) => (
        <KumoSelect.Option key={option.value} value={option.value}>
          {option.label}
        </KumoSelect.Option>
      ))}
    </KumoSelect>
  )

  if (!hasExternalLabel) {
    return select
  }

  return (
    <div className="grid w-full gap-2">
      {labelNode}
      {select}
      {error ? <p className="text-sm leading-snug text-kumo-danger">{error}</p> : null}
    </div>
  )
}

export function ModelThinkingField({
  label,
  modelLabel,
  reasoningLabel,
  placeholder,
  disabled,
  disabledEnvVarName,
  error,
  onClick,
}: {
  label: string
  modelLabel: string
  reasoningLabel?: string
  placeholder: string
  disabled?: boolean
  disabledEnvVarName?: string | null
  error?: string
  onClick: () => void
}) {
  const hasValue = Boolean(modelLabel)
  const displayValue =
    hasValue && reasoningLabel ? `${modelLabel} — ${reasoningLabel}` : modelLabel || placeholder
  return (
    <div className="grid gap-1.5">
      <LockedLabel label={label} envVarName={disabled ? disabledEnvVarName : null} />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border bg-kumo-control px-3 py-2 text-left text-sm transition hover:border-kumo-line hover:bg-kumo-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-kumo-danger" : "border-kumo-hairline"
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${hasValue ? "text-kumo-default" : "text-kumo-placeholder"}`}
        >
          {displayValue}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden />
      </button>
      {error ? <p className="text-xs text-kumo-danger">{error}</p> : null}
    </div>
  )
}

function LockedLabel({
  label,
  helpText,
  envVarName,
}: {
  label: string
  helpText?: string
  envVarName?: string | null
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 text-sm font-medium text-kumo-default">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <HelpTooltip content={helpText} />
        <EnvLockIcon envVarName={envVarName} />
      </span>
    </div>
  )
}

function HelpTooltip({ content }: { content?: string }) {
  if (!content) {
    return null
  }
  return (
    <Tooltip
      content={content}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-sm text-kumo-subtle hover:text-kumo-default"
      delay={250}
    >
      <span className="sr-only">{content}</span>
      <CircleHelp className="h-3.5 w-3.5" aria-hidden />
    </Tooltip>
  )
}

function formatRelativeRunTime(run: AdminCronRunRecord): string {
  return `at ${formatTime(run.finishedAt)}`
}

function uniqueEnvVars(envVarNames: Array<string | null | undefined>): string[] {
  return Array.from(new Set(envVarNames.filter((value): value is string => Boolean(value))))
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
