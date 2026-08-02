"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { Link } from "@tanstack/react-router"
import { TriangleAlert, X } from "lucide-react"
import { useState } from "react"
import { C0Loader } from "@/components/c0-loader"
import { Dialog } from "@/components/ui/dialog"

export function AiProviderRequiredButton({
  isAdmin,
  disabled = false,
  variant = "toolbar",
}: {
  isAdmin: boolean
  disabled?: boolean
  variant?: "toolbar" | "field"
}) {
  const [open, setOpen] = useState(false)
  const label = "AI Provider required"

  return (
    <>
      {variant === "field" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-kumo-warning/40 bg-kumo-warning-tint/10 px-3 py-2 text-left text-sm text-kumo-warning transition hover:bg-kumo-warning-tint/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label={label}
          title={label}
          className="home-model-control group flex min-h-9 items-center rounded-lg px-2.5 py-1 text-kumo-warning transition-[background-color,color,opacity,transform] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      )}
      {open ? <AiProviderRequiredDialog isAdmin={isAdmin} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function AiProviderLoadingButton({
  variant = "toolbar",
}: {
  variant?: "toolbar" | "field"
}) {
  if (variant === "field") {
    return (
      <div
        aria-label="Loading AI Provider models"
        className="mt-3 flex h-10 w-full items-center rounded-lg border border-kumo-hairline bg-kumo-tint/40 px-3"
      >
        <C0Loader size={22} className="text-kumo-subtle" />
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled
      aria-label="Loading AI Provider models"
      title="Loading AI Provider models"
      className="home-model-control group flex min-h-9 items-center rounded-lg px-2.5 py-1 text-kumo-subtle opacity-70"
    >
      <C0Loader size={22} className="text-kumo-subtle" />
    </button>
  )
}

function AiProviderRequiredDialog({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const title = "AI Provider required"

  return (
    <Dialog.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <Dialog className="flex w-full max-w-md flex-col p-0">
        <div className="flex items-center justify-between border-b border-kumo-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <TriangleAlert className="h-5 w-5 shrink-0 text-kumo-warning" aria-hidden />
            <Dialog.Title>{title}</Dialog.Title>
          </div>
          <Button
            type="button"
            onClick={onClose}
            shape="circle"
            variant="ghost"
            aria-label={`Close ${title} dialog`}
            icon={<X className="h-4 w-4" aria-hidden />}
          />
        </div>
        <div className="space-y-4 px-4 py-4 text-sm leading-6 text-kumo-subtle">
          <p>An admin needs to set up an AI Provider before agents or workflows can run.</p>
          {isAdmin ? (
            <Link
              to="/admin/integrations"
              search={{ tab: "ai-providers" }}
              onClick={onClose}
              className="inline-flex items-center rounded-lg bg-kumo-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Open admin AI Providers
            </Link>
          ) : null}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
