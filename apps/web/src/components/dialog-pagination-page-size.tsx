"use client"

import { Select } from "@cloudflare/kumo/components/select"
import { useLayoutEffect, useState } from "react"
import { getDialogSelectPortalRoot } from "@/lib/dialog-select-portal"

type DialogPaginationPageSizeProps = {
  value: number
  onChange: (size: number) => void
  options: readonly number[]
  className?: string
  disabled?: boolean
}

/**
 * Page-size selector for pagination inside modal dialogs.
 *
 * Kumo's dialog panel uses CSS transforms, so select popups must not portal into
 * the panel. A dedicated body-level portal layer (see app.css) keeps menus above
 * the dialog overlay while preserving correct anchor positioning.
 */
export function DialogPaginationPageSize({
  value,
  onChange,
  options,
  className,
  disabled = false,
}: DialogPaginationPageSizeProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setPortalContainer(getDialogSelectPortalRoot())
  }, [])

  return (
    <div className={className ?? "flex items-center gap-2"} data-slot="pagination-page-size">
      <span className="text-sm text-kumo-subtle">Per page:</span>
      {portalContainer ? (
        <Select
          size="sm"
          aria-label="Page size"
          value={value}
          disabled={disabled}
          onValueChange={(nextValue) => onChange(Number(nextValue))}
          container={portalContainer}
        >
          {options.map((size) => (
            <Select.Option key={size} value={size}>
              {size}
            </Select.Option>
          ))}
        </Select>
      ) : (
        <div
          aria-hidden
          className="h-6.5 min-w-[3.5rem] rounded-md bg-kumo-tint ring-1 ring-kumo-line"
        />
      )}
    </div>
  )
}
