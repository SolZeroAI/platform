"use client"

import { useEffect, useRef, useState } from "react"
import { S0Loader } from "@/components/s0-loader"
import { S0AnimatedIcon } from "@/components/s0-animated-icon"
import { getS0Brand } from "@/lib/brand"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const LEARN_MORE_TOC_ITEMS = [
  { id: "theme-colors", label: "Theme colors" },
  { id: "brand-assets", label: "Assets" },
] as const

const KUMO_BACKGROUND_COLORS = [
  { name: "canvas", className: "bg-kumo-canvas" },
  { name: "elevated", className: "bg-kumo-elevated" },
  { name: "recessed", className: "bg-kumo-recessed" },
  { name: "base", className: "bg-kumo-base" },
  { name: "tint", className: "bg-kumo-tint" },
  { name: "contrast", className: "bg-kumo-contrast" },
  { name: "overlay", className: "bg-kumo-overlay" },
  { name: "control", className: "bg-kumo-control" },
  { name: "interact", className: "bg-kumo-interact" },
  { name: "fill", className: "bg-kumo-fill" },
  { name: "fill-hover", className: "bg-kumo-fill-hover" },
  { name: "brand", className: "bg-kumo-brand" },
  { name: "brand-hover", className: "bg-kumo-brand-hover" },
  { name: "line", className: "bg-kumo-line" },
  { name: "hairline", className: "bg-kumo-hairline" },
  { name: "focus", className: "bg-kumo-focus" },
  { name: "info-tint", className: "bg-kumo-info-tint" },
  { name: "info", className: "bg-kumo-info" },
  { name: "warning-tint", className: "bg-kumo-warning-tint" },
  { name: "warning", className: "bg-kumo-warning" },
  { name: "danger-tint", className: "bg-kumo-danger-tint" },
  { name: "danger", className: "bg-kumo-danger" },
  { name: "success-tint", className: "bg-kumo-success-tint" },
  { name: "success", className: "bg-kumo-success" },
  { name: "banner-info", className: "bg-kumo-banner-info" },
  { name: "banner-warning", className: "bg-kumo-banner-warning" },
] as const

function formatColorValue(color: string): string {
  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  if (!match) return color

  const [, red, green, blue, alpha] = match
  if (alpha !== undefined && Number(alpha) < 1) return color

  const toHex = (channel: string) => Number(channel).toString(16).padStart(2, "0")
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function readKumoBackgroundValue(className: string, swatch: HTMLDivElement | null): string {
  if (swatch) {
    const rendered = formatColorValue(getComputedStyle(swatch).backgroundColor)
    if (rendered) return rendered
  }

  const token = className.replace(/^bg-/, "")
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim()
}

function KumoBackgroundColorSwatch({
  className,
}: {
  className: (typeof KUMO_BACKGROUND_COLORS)[number]["className"]
}) {
  const swatchRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState("")

  useEffect(() => {
    const updateValue = () => {
      setValue(readKumoBackgroundValue(className, swatchRef.current))
    }

    updateValue()

    const observer = new MutationObserver(updateValue)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode", "data-theme"],
    })

    return () => observer.disconnect()
  }, [className])

  return (
    <div className="rounded-xl border border-kumo-line p-3">
      <div
        ref={swatchRef}
        className={`mb-2 h-10 rounded-lg ring-1 ring-inset ring-kumo-hairline ${className}`}
      />
      <div className="font-mono text-xs text-kumo-default">{className}</div>
      <div className="mt-0.5 font-mono text-xs text-kumo-subtle break-all">{value || "—"}</div>
    </div>
  )
}

export function LearnMoreSettings() {
  const brand = getS0Brand()
  return (
    <SettingsDocsLayout
      title="Learn More"
      titleId="settings-learn-more"
      description={`Visual assets for the ${brand.name} project.`}
      tocItems={LEARN_MORE_TOC_ITEMS}
    >
      <section className="space-y-4">
        <SettingsDocsSectionHeading id="theme-colors" level="h2" title="Theme colors">
          <p className="text-sm text-kumo-subtle">
            Kumo background tokens used across {brand.name}, with the active theme value for the
            current mode.
          </p>
        </SettingsDocsSectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {KUMO_BACKGROUND_COLORS.map((color) => (
            <KumoBackgroundColorSwatch key={color.name} className={color.className} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SettingsDocsSectionHeading id="brand-assets" level="h2" title="Assets">
          <p className="text-sm text-kumo-subtle">
            Core {brand.name} brand elements used across the product experience.
          </p>
        </SettingsDocsSectionHeading>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-kumo-line p-4">
            <div className="text-sm font-medium text-kumo-default mb-1">{brand.name} logo</div>
            <div className="text-xs text-kumo-subtle mb-4">
              {brand.name} logo used as the animated brand mark.
            </div>
            <div className="flex min-h-32 items-center justify-center rounded-lg bg-kumo-canvas">
              <S0AnimatedIcon size={96} />
            </div>
          </div>

          <div className="rounded-xl border border-kumo-line p-4">
            <div className="text-sm font-medium text-kumo-default mb-1">{brand.name} loader</div>
            <div className="text-xs text-kumo-subtle mb-4">
              The {brand.name} mark animated as a loading indicator.
            </div>
            <div className="flex min-h-32 items-center justify-center rounded-lg bg-kumo-canvas">
              <S0Loader size={96} />
            </div>
          </div>
        </div>
      </section>
    </SettingsDocsLayout>
  )
}
