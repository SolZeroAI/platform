"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@/components/ui/dialog"

export function LitellmResetConfigDialog({
  confirmDisabled,
  open,
  resetting,
  onCancel,
  onConfirm,
  onOpenChange,
}: {
  confirmDisabled: boolean
  open: boolean
  resetting: boolean
  onCancel: () => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog.Root open={open} role="alertdialog" onOpenChange={onOpenChange}>
      <Dialog className="flex w-full max-w-md flex-col p-0">
        <div className="border-b border-kumo-hairline px-5 py-4">
          <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
            Reset LiteLLM config?
          </Dialog.Title>
        </div>
        <Dialog.Description className="px-5 py-4 text-sm leading-5 text-kumo-subtle">
          This removes the KV-backed LiteLLM config, API key, and model registry. Environment
          variables are not changed.
        </Dialog.Description>
        <div className="flex justify-end gap-2 border-t border-kumo-hairline px-5 py-4">
          <Button type="button" onClick={onCancel} disabled={resetting} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            loading={resetting}
            variant="secondary-destructive"
          >
            Reset config
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
