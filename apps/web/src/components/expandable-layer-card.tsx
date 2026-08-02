import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { ChevronRight } from "lucide-react"
import { type ReactNode, useId, useState } from "react"

export function expandableLayerCardTransitionClass(open: boolean) {
  return `grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
    open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
  }`
}

export function AnimatedLayerCardPrimary({
  open,
  id,
  children,
  className,
}: {
  open: boolean
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div id={id} aria-hidden={!open} className={expandableLayerCardTransitionClass(open)}>
      <div className="min-w-0 overflow-hidden">
        <LayerCard.Primary className={className}>{children}</LayerCard.Primary>
      </div>
    </div>
  )
}

export function ExpandableLayerCard({
  title,
  subtitle,
  titleClassName = "text-xs font-medium",
  defaultOpen = true,
  children,
  className = "overflow-hidden rounded-xl",
  primaryClassName = "rounded-lg px-3 py-3 [&>*:first-child]:mt-0",
}: {
  title: string
  subtitle?: ReactNode
  titleClassName?: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  primaryClassName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <LayerCard className={className}>
      <LayerCard.Secondary className="my-0 p-0">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-kumo-subtle outline-none transition-colors hover:text-kumo-default focus-visible:text-kumo-default"
        >
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${titleClassName}`}>{title}</span>
            {subtitle ? <span className="mt-1 block">{subtitle}</span> : null}
          </span>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-current transition-transform duration-200 ${
              open ? "rotate-90" : ""
            }`}
            aria-hidden
          />
        </button>
      </LayerCard.Secondary>
      <AnimatedLayerCardPrimary open={open} id={contentId} className={primaryClassName}>
        {children}
      </AnimatedLayerCardPrimary>
    </LayerCard>
  )
}
