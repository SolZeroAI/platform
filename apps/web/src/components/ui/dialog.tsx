"use client"

import {
  Dialog as KumoDialog,
  type DialogProps as KumoDialogProps,
} from "@cloudflare/kumo/components/dialog"
import { cn } from "@cloudflare/kumo/utils"

/**
 * Near-fullscreen dialog panel preset.
 *
 * Kumo's panel is `w-full max-w-[calc(100vw-2rem)]` plus the default size
 * variant `sm:w-96`. A bare `w-[95vw]` loses to that `sm:` width on desktop.
 * This preset sets `sm:w-[95vw]` too, and uses `dvh` so the panel isn't
 * clipped by mobile browser chrome.
 */
export const NEAR_FULL_DIALOG_CLASS_NAME =
  "flex h-[95dvh] max-h-[95dvh] w-[95vw] sm:w-[95vw] max-w-[calc(100vw-2rem)] flex-col p-0"

type KumoDialogSize = NonNullable<KumoDialogProps["size"]>

/** Kumo's native width sizes plus our `near-full` panel preset. */
export type DialogSize = KumoDialogSize | "near-full"

export type DialogProps = Omit<KumoDialogProps, "size"> & {
  size?: DialogSize
}

/**
 * Drop-in replacement for Kumo's `Dialog` panel. Behaves identically to Kumo for
 * every native size, and adds a `near-full` size that fills almost the entire
 * viewport. Provided `className` is merged last, so callers can still fine-tune.
 */
function DialogContent({ size, className, ...props }: DialogProps) {
  if (size === "near-full") {
    return <KumoDialog className={cn(NEAR_FULL_DIALOG_CLASS_NAME, className)} {...props} />
  }

  return <KumoDialog size={size} className={className} {...props} />
}

export const Dialog = Object.assign(DialogContent, {
  Root: KumoDialog.Root,
  Trigger: KumoDialog.Trigger,
  Title: KumoDialog.Title,
  Description: KumoDialog.Description,
  Close: KumoDialog.Close,
})
