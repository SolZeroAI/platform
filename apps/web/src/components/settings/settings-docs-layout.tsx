"use client"

import { Select as KumoSelect } from "@cloudflare/kumo/components/select"
import { TableOfContents } from "@cloudflare/kumo/components/table-of-contents"
import { Link as LinkIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { getStickySelectPortalRoot } from "@/lib/sticky-select-portal"

export interface SettingsDocsTocItem {
  id: string
  label: string
  depth?: 0 | 1
}

interface SettingsDocsLayoutProps {
  title: string
  titleId: string
  description: string
  tocItems: readonly SettingsDocsTocItem[]
  children: ReactNode
}

interface TocGroup {
  parent: SettingsDocsTocItem
  children: SettingsDocsTocItem[]
}

function toTocValue(item: SettingsDocsTocItem): string {
  return `#${item.id}`
}

function groupTocItems(items: readonly SettingsDocsTocItem[]): TocGroup[] {
  const groups: TocGroup[] = []

  for (const item of items) {
    if (item.depth === 1 && groups.length > 0) {
      groups[groups.length - 1]?.children.push(item)
      continue
    }
    groups.push({ parent: { ...item, depth: 0 }, children: [] })
  }

  return groups
}

function getInitialTocValue(items: readonly SettingsDocsTocItem[]): string {
  const values = items.map(toTocValue)
  if (typeof window !== "undefined" && values.includes(window.location.hash)) {
    return window.location.hash
  }
  return values[0] ?? ""
}

export function SettingsDocsLayout({
  title,
  titleId,
  description,
  tocItems,
  children,
}: SettingsDocsLayoutProps) {
  const [selectedTocValue, setSelectedTocValue] = useState(() => getInitialTocValue(tocItems))
  const [stickySelectPortalContainer, setStickySelectPortalContainer] =
    useState<HTMLElement | null>(null)

  const tocValues = useMemo(() => tocItems.map(toTocValue), [tocItems])
  const tocGroups = useMemo(() => groupTocItems(tocItems), [tocItems])
  const selectedValue = tocValues.includes(selectedTocValue)
    ? selectedTocValue
    : (tocValues[0] ?? "")

  useLayoutEffect(() => {
    setStickySelectPortalContainer(getStickySelectPortalRoot())
  }, [])

  useEffect(() => {
    let animationFrame = 0

    const updateFromHash = () => {
      if (tocValues.includes(window.location.hash)) {
        setSelectedTocValue(window.location.hash)
      }
    }

    const updateFromScroll = () => {
      if (animationFrame) {
        return
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        let activeValue = tocValues[0] ?? ""
        for (const value of tocValues) {
          const section = document.getElementById(value.slice(1))
          if (section && section.getBoundingClientRect().top <= 128) {
            activeValue = value
          }
        }
        setSelectedTocValue(activeValue)
      })
    }

    updateFromHash()
    updateFromScroll()
    window.addEventListener("hashchange", updateFromHash)
    window.addEventListener("resize", updateFromScroll)
    window.addEventListener("scroll", updateFromScroll, true)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      window.removeEventListener("hashchange", updateFromHash)
      window.removeEventListener("resize", updateFromScroll)
      window.removeEventListener("scroll", updateFromScroll, true)
    }
  }, [tocValues])

  const navigateToSection = useCallback((value: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(value.slice(1))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
    window.history.replaceState(null, "", value)
  }, [])

  return (
    <div className="space-y-12">
      <div className="space-y-3">
        <SettingsDocsSectionHeading id={titleId} level="h1" title={title} />
        <p className="max-w-3xl text-lg text-kumo-strong">{description}</p>
      </div>

      <div className="sticky -top-8 z-30 -mx-12 border-b border-kumo-hairline bg-kumo-canvas/95 px-12 py-3 backdrop-blur xl:hidden">
        <KumoSelect
          aria-label={`${title} sections`}
          value={selectedValue}
          container={stickySelectPortalContainer ?? undefined}
          onValueChange={(value) => {
            const nextValue = String(value ?? "")
            if (tocValues.includes(nextValue)) {
              setSelectedTocValue(nextValue)
              navigateToSection(nextValue)
            }
          }}
          renderValue={(value) =>
            tocItems.find((item) => toTocValue(item) === value)?.label ?? tocItems[0]?.label ?? ""
          }
          className="w-full"
        >
          {tocItems.map((item) => (
            <KumoSelect.Option key={item.id} value={toTocValue(item)}>
              <span className={item.depth === 1 ? "block pl-4" : "block"}>{item.label}</span>
            </KumoSelect.Option>
          ))}
        </KumoSelect>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0 space-y-12">{children}</div>

        <TableOfContents className="hidden xl:sticky xl:top-4 xl:block xl:self-start xl:pl-6">
          <TableOfContents.Title>On this page</TableOfContents.Title>
          <TableOfContents.List>
            {tocGroups.map((group) => {
              const parentValue = toTocValue(group.parent)
              if (group.children.length > 0) {
                return (
                  <TableOfContents.Group
                    key={group.parent.id}
                    label={group.parent.label}
                    href={parentValue}
                    active={selectedValue === parentValue}
                  >
                    {group.children.map((child) => {
                      const childValue = toTocValue(child)
                      return (
                        <TableOfContents.Item
                          key={child.id}
                          href={childValue}
                          active={selectedValue === childValue}
                          onClick={() => setSelectedTocValue(childValue)}
                        >
                          {child.label}
                        </TableOfContents.Item>
                      )
                    })}
                  </TableOfContents.Group>
                )
              }

              return (
                <TableOfContents.Item
                  key={group.parent.id}
                  href={parentValue}
                  active={selectedValue === parentValue}
                  onClick={() => setSelectedTocValue(parentValue)}
                >
                  {group.parent.label}
                </TableOfContents.Item>
              )
            })}
          </TableOfContents.List>
        </TableOfContents>
      </div>
    </div>
  )
}

export function SettingsDocsSectionHeading({
  children,
  id,
  leading,
  level,
  title,
  trailing,
}: {
  children?: ReactNode
  id: string
  leading?: ReactNode
  level: "h1" | "h2" | "h3"
  title: string
  trailing?: ReactNode
}) {
  const className =
    level === "h1"
      ? "group relative scroll-mt-24 tracking-tight text-4xl font-bold text-kumo-default"
      : level === "h2"
        ? "group relative scroll-mt-24 tracking-tight text-2xl font-semibold text-kumo-default"
        : "group relative scroll-mt-24 tracking-tight text-xl font-semibold text-kumo-default"
  const content = (
    <a
      href={`#${id}`}
      className="inline-flex items-center gap-2 no-underline hover:underline"
      aria-label={`Link to section: ${title}`}
    >
      <span
        className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-hidden="true"
      >
        <LinkIcon className="size-4 text-kumo-subtle" />
      </span>
      {leading}
      <span>{title}</span>
    </a>
  )

  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-3 ${trailing ? "justify-between" : ""}`}>
        {level === "h1" ? (
          <h1 id={id} className={className}>
            {content}
          </h1>
        ) : level === "h2" ? (
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
