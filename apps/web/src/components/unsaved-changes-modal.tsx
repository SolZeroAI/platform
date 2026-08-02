"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { Save } from "lucide-react"
import { Dialog } from "@/components/ui/dialog"

export function UnsavedChangesModal({
  saving,
  title = "Save changes?",
  description,
  onSave,
  onLeave,
  onCancel,
}: {
  saving: boolean
  title?: string
  description: string
  onSave: () => void
  onLeave: () => void
  onCancel: () => void
}) {
  return (
    <Dialog.Root
      open
      role="alertdialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) {
          onCancel()
        }
      }}
    >
      <Dialog className="flex max-h-[85vh] w-full max-w-md flex-col p-0">
        <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-5 py-4">
          <div className="min-w-0">
            <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
              {title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-5 text-kumo-subtle">
              {description}
            </Dialog.Description>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} disabled={saving} variant="ghost">
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={onLeave} disabled={saving} variant="secondary">
              Leave without saving
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={saving}
              loading={saving}
              variant="primary"
              className="text-white"
              icon={<Save className="h-4 w-4" aria-hidden />}
            >
              {saving ? "Saving" : "Save and leave"}
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
