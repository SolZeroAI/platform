"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { Check, Copy, Maximize2, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Dialog } from "@/components/ui/dialog"
import { copyToClipboard } from "@/lib/format"
import { CodeEditor } from "./code-editor"
import { formatJsonText, getCodeSurfaceActionLabel, type CodeLanguage } from "./code-utils"

export interface CodeSurfaceTriggerProps {
  actionLabel: ReturnType<typeof getCodeSurfaceActionLabel>
  ariaLabel: string
  expanded: boolean
  open: () => void
}

interface CodeSurfaceBaseProps {
  title: string
  description?: string
  value: string
  language: CodeLanguage
  className?: string
  previewMaxHeightClassName?: string
  previewMinHeightClassName?: string
  expandable?: boolean
  /** When false, renders a static preview without hover-to-open affordance. */
  previewInteractive?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: (props: CodeSurfaceTriggerProps) => ReactNode
}

interface ReadonlyCodeSurfaceProps extends CodeSurfaceBaseProps {
  mode?: "readonly"
  onSave?: never
}

interface EditableCodeSurfaceProps extends CodeSurfaceBaseProps {
  mode: "editable"
  onSave: (value: string) => void
}

export type CodeSurfaceProps = ReadonlyCodeSurfaceProps | EditableCodeSurfaceProps

export function CodeSurface({
  title,
  description,
  value,
  language,
  className,
  previewMaxHeightClassName = "max-h-48",
  previewMinHeightClassName = "min-h-32",
  expandable = true,
  previewInteractive = true,
  open: controlledOpen,
  onOpenChange,
  mode = "readonly",
  onSave,
  trigger,
}: CodeSurfaceProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [draft, setDraft] = useState(value)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dialogContentReady, setDialogContentReady] = useState(false)
  const actionLabel = getCodeSurfaceActionLabel(mode)
  const displayValue = mode === "editable" ? draft : value
  const dialogDescription = description ?? (mode === "editable" ? actionLabel : undefined)
  const ariaLabel = `${dialogDescription ?? actionLabel}: ${title}`
  const openDialog = () => setOpen(true)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(value)
    setFormatError(null)
    setCopied(false)
  }, [open, value])

  useEffect(() => {
    if (!open) {
      setDialogContentReady(false)
      return
    }

    let nextFrameId: number | null = null
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => setDialogContentReady(true))
    })
    return () => {
      window.cancelAnimationFrame(frameId)
      if (nextFrameId !== null) {
        window.cancelAnimationFrame(nextFrameId)
      }
    }
  }, [open])

  const previewClassName = [
    previewMinHeightClassName,
    "overflow-hidden rounded-xl border border-kumo-line bg-kumo-tint text-[11px] text-kumo-default",
    previewMaxHeightClassName,
  ].join(" ")

  const staticPreviewClassName = [
    previewMinHeightClassName,
    "overflow-auto rounded-xl border border-kumo-line bg-kumo-tint text-[11px] text-kumo-default",
    previewMaxHeightClassName,
  ].join(" ")

  const handleCopy = async () => {
    const success = await copyToClipboard(displayValue)
    if (!success) {
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const handleFormatJson = () => {
    const result = formatJsonText(draft)
    if (!result.ok) {
      setFormatError(result.error)
      return
    }
    setDraft(result.value)
    setFormatError(null)
  }

  const handleSave = () => {
    if (mode !== "editable" || !onSave) {
      return
    }
    onSave(draft)
    setOpen(false)
  }

  return (
    <>
      {!expandable ? (
        <div className={className}>
          <div className={staticPreviewClassName}>
            <CodeEditor
              value={value}
              language={language}
              readOnly
              autoFocus={false}
              className={`${previewMinHeightClassName} [&_.cm-editor]:!h-auto`}
            />
          </div>
        </div>
      ) : trigger ? (
        trigger({ actionLabel, ariaLabel, expanded: open, open: openDialog })
      ) : !previewInteractive ? (
        <div className={className}>
          <div className={staticPreviewClassName}>
            <CodeEditor
              value={value}
              language={language}
              readOnly
              autoFocus={false}
              className={`${previewMinHeightClassName} [&_.cm-editor]:!h-auto`}
            />
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={openDialog}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              openDialog()
            }
          }}
          className={`group relative block w-full overflow-hidden rounded-xl text-left ${className ?? ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <div
            className={`select-none transition-[filter,opacity] duration-150 group-hover:blur-[0.5px] group-hover:opacity-80 group-focus-visible:blur-[0.5px] group-focus-visible:opacity-80 ${previewClassName}`}
          >
            <CodeEditor
              value={value}
              language={language}
              readOnly
              autoFocus={false}
              className="pointer-events-none h-full min-h-32"
            />
          </div>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-kumo-base/25 opacity-0 transition-[opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm font-medium text-kumo-default shadow-lg">
              <Maximize2 className="h-4 w-4" aria-hidden />
              {actionLabel}
            </span>
          </span>
        </div>
      )}

      {expandable ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog size="near-full" className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-4 py-3">
              <div className="min-w-0">
                <Dialog.Title className="truncate text-sm font-medium text-kumo-default">
                  {title}
                </Dialog.Title>
                {dialogDescription ? (
                  <Dialog.Description className="mt-1 text-xs text-kumo-subtle">
                    {dialogDescription}
                  </Dialog.Description>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {mode === "readonly" ? (
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-kumo-line px-2.5 py-1.5 text-xs font-medium text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                ) : null}
                {mode === "editable" && language === "json" ? (
                  <button
                    type="button"
                    onClick={handleFormatJson}
                    className="inline-flex min-h-9 items-center rounded-lg border border-kumo-line px-2.5 py-1.5 text-xs font-medium text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"
                  >
                    Format JSON
                  </button>
                ) : null}
                {mode === "readonly" ? (
                  <Button
                    type="button"
                    onClick={() => setOpen(false)}
                    shape="circle"
                    variant="ghost"
                    aria-label="Close code dialog"
                    icon={<X className="h-4 w-4" aria-hidden />}
                  />
                ) : null}
              </div>
            </div>

            {formatError ? (
              <div className="border-b border-kumo-danger/30 bg-kumo-danger-tint/10 px-4 py-2 text-xs text-kumo-danger">
                {formatError}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 bg-kumo-control">
              {!dialogContentReady ? (
                <div className="flex h-full items-center justify-center text-xs text-kumo-subtle">
                  Loading code view
                </div>
              ) : mode === "editable" ? (
                <CodeEditor
                  value={draft}
                  language={language}
                  onChange={(nextValue) => {
                    setDraft(nextValue)
                    if (formatError) {
                      setFormatError(null)
                    }
                  }}
                  className="h-full"
                />
              ) : (
                <CodeEditor
                  value={value}
                  language={language}
                  readOnly
                  autoFocus={false}
                  className="h-full"
                />
              )}
            </div>

            {mode === "editable" ? (
              <div className="flex items-center justify-end gap-2 border-t border-kumo-hairline px-4 py-3">
                <Button type="button" onClick={() => setOpen(false)} variant="ghost">
                  Cancel
                </Button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="min-h-9 rounded-lg bg-kumo-brand px-3 py-1.5 text-sm font-medium text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96]"
                >
                  Save
                </button>
              </div>
            ) : null}
          </Dialog>
        </Dialog.Root>
      ) : null}
    </>
  )
}
