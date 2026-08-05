"use client"

import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import {
  AlertCircle,
  FileText,
  Folder,
  Globe,
  ListChecks,
  Package,
  Pencil,
  Plug,
  Plus,
  Search,
  Terminal,
  Variable,
  Wrench,
} from "lucide-react"
import { useState, type ReactNode } from "react"
import type { SandboxEvent } from "@solzero/shared"
import {
  CodeSurface,
  getCodeLanguageForValue,
  getCodeTextForValue,
  type CodeLanguage,
} from "@/components/code"
import { Dialog } from "@/components/ui/dialog"
import type { McpDiscoveryErrorEvent } from "@/lib/session-events"
import { formatToolCall } from "@/lib/tool-formatters"

const TOOL_CALL_ACTION_BUTTON_PROPS = {
  type: "button" as const,
  size: "sm" as const,
  shape: "square" as const,
  variant: "secondary" as const,
}

const TOOL_CALL_OUTPUT_BUTTON_CLASS =
  "bg-kumo-success-tint/10 text-kumo-success! ring-1 !ring-kumo-success/30 not-disabled:hover:bg-kumo-success-tint/20"

const TOOL_CALL_ERROR_BUTTON_CLASS = "!text-kumo-danger"

interface ToolCallBannerProps {
  event: SandboxEvent
  discoveryError?: McpDiscoveryErrorEvent
}

function formatToolErrorText(
  executionError: string | undefined,
  discoveryError: McpDiscoveryErrorEvent | undefined,
): string | undefined {
  const parts: string[] = []

  if (discoveryError) {
    parts.push(
      `MCP server: ${discoveryError.serverName ?? "MCP"}`,
      "",
      discoveryError.error ?? "Discovery failed",
    )
  }

  if (executionError) {
    if (parts.length > 0) {
      parts.push("", "---", "")
    }
    parts.push(executionError)
  }

  return parts.length > 0 ? parts.join("\n") : undefined
}

export function ToolIcon({ name }: { name: string | null }) {
  if (!name) return null

  const iconClass = "h-4 w-4 shrink-0 text-kumo-warning"

  switch (name) {
    case "file":
      return <FileText className={iconClass} aria-hidden />
    case "pencil":
      return <Pencil className={iconClass} aria-hidden />
    case "plus":
      return <Plus className={iconClass} aria-hidden />
    case "terminal":
      return <Terminal className={iconClass} aria-hidden />
    case "search":
      return <Search className={iconClass} aria-hidden />
    case "folder":
      return <Folder className={iconClass} aria-hidden />
    case "box":
      return <Package className={iconClass} aria-hidden />
    case "globe":
      return <Globe className={iconClass} aria-hidden />
    case "plug":
      return <Plug className={iconClass} aria-hidden />
    case "tool":
      return <Wrench className={iconClass} aria-hidden />
    default:
      return null
  }
}

function ToolCallDetailButton({
  title,
  description,
  value,
  language,
  icon,
  tooltip,
  className,
}: {
  title: string
  description: string
  value: string
  language: CodeLanguage
  icon: ReactNode
  tooltip: string
  className?: string
}) {
  return (
    <CodeSurface
      title={title}
      description={description}
      value={value}
      language={language}
      trigger={({ ariaLabel, expanded, open }) => (
        <Button
          {...TOOL_CALL_ACTION_BUTTON_PROPS}
          icon={icon}
          title={tooltip}
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={ariaLabel}
          className={className}
        />
      )}
    />
  )
}

function ToolCallErrorButton({
  title,
  description,
  errorText,
  className,
}: {
  title: string
  description: string
  errorText: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        {...TOOL_CALL_ACTION_BUTTON_PROPS}
        icon={<AlertCircle className="h-4 w-4" aria-hidden />}
        title="Error"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${description}: ${title}`}
        className={className}
      />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog size="lg" className="flex max-h-[85vh] w-full max-w-2xl flex-col p-0">
          <div className="border-b border-kumo-hairline px-5 py-4">
            <Dialog.Title className="truncate text-base font-semibold text-kumo-default">
              {title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
              {description}
            </Dialog.Description>
          </div>
          <div className="transparent-scrollbar max-h-[60vh] overflow-y-auto px-5 py-4">
            <Banner
              variant="error"
              icon={<AlertCircle className="h-4 w-4 shrink-0" aria-hidden />}
              description={<span className="whitespace-pre-wrap">{errorText}</span>}
            />
          </div>
          <div className="flex justify-end border-t border-kumo-hairline px-5 py-4">
            <Button type="button" onClick={() => setOpen(false)} variant="ghost">
              Close
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </>
  )
}

export function ToolCallBanner({ event, discoveryError }: ToolCallBannerProps) {
  const formatted = formatToolCall(event)
  const { args, output, metadata } = formatted.getDetails()
  const hasArgs = Boolean(args && Object.keys(args).length > 0)
  const hasOutput = Boolean(output)
  const errorText = formatToolErrorText(event.error, discoveryError)
  const hasError = Boolean(errorText)
  const title = formatted.mcpLabels ? formatted.mcpLabels.server : formatted.toolName
  const detailDescription = (detail: "arguments" | "output" | "error") =>
    formatted.mcpLabels ? `${formatted.mcpLabels.tool} ${detail}` : detail
  const description = formatted.mcpLabels
    ? `Tool: ${formatted.mcpLabels.tool}`
    : formatted.summary ||
      metadata?.map((item) => `${item.label}: ${item.value}`).join(" · ") ||
      undefined

  return (
    <Banner
      variant="secondary"
      className="min-h-16"
      icon={<ToolIcon name={formatted.icon} />}
      title={title}
      description={description}
      action={
        hasArgs || hasOutput || hasError ? (
          <>
            {hasArgs ? (
              <ToolCallDetailButton
                title={title}
                description={detailDescription("arguments")}
                value={getCodeTextForValue(args, "json")}
                language="json"
                tooltip="Arguments"
                icon={<Variable className="h-4 w-4" aria-hidden />}
              />
            ) : null}
            {hasOutput ? (
              <ToolCallDetailButton
                title={title}
                description={detailDescription("output")}
                value={getCodeTextForValue(output)}
                language={getCodeLanguageForValue(output)}
                tooltip="Output"
                icon={<ListChecks className="h-4 w-4" aria-hidden />}
                className={TOOL_CALL_OUTPUT_BUTTON_CLASS}
              />
            ) : null}
            {hasError ? (
              <ToolCallErrorButton
                title={title}
                description={detailDescription("error")}
                errorText={errorText ?? ""}
                className={TOOL_CALL_ERROR_BUTTON_CLASS}
              />
            ) : null}
          </>
        ) : undefined
      }
    />
  )
}
