"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Select } from "@cloudflare/kumo/components/select"
import type { RuntimeModelCategory, RuntimeProviderModelOption } from "@solzero/shared"
import { Link } from "@tanstack/react-router"
import { Check, ChevronRight, Search, ShieldCheck, UserRound, X } from "lucide-react"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react"
import { Dialog } from "@/components/ui/dialog"
import { getDialogSelectPortalRoot } from "@/lib/dialog-select-portal"
import { recessedInputGroupClassName } from "@/lib/recessed-field"

const ALL_PROVIDERS_FILTER = "__all_providers__"
const MODEL_SCROLL_ANIMATION_MS = 260

type OpenRow = "models" | "thinking"

export function ModelThinkingDialog({
  modelOptions,
  selectedModel,
  selectedModelOption,
  reasoningEffort,
  showThinking = true,
  showDefaultModelHint = false,
  isAdmin = false,
  onModelSelect,
  onReasoningSelect,
  onClose,
}: {
  modelOptions: RuntimeModelCategory[]
  selectedModel: string
  selectedModelOption: RuntimeProviderModelOption | null
  reasoningEffort: string | undefined
  showThinking?: boolean
  showDefaultModelHint?: boolean
  isAdmin?: boolean
  onModelSelect: (value: string) => void
  onReasoningSelect: (value: string | undefined) => void
  onClose: () => void
}) {
  const [openRow, setOpenRow] = useState<OpenRow>("models")
  const [modelSearch, setModelSearch] = useState("")
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS_FILTER)
  const [selectPortalContainer, setSelectPortalContainer] = useState<HTMLElement | null>(null)
  const modelListScrollRef = useRef<HTMLDivElement | null>(null)
  const selectedModelCardRef = useRef<HTMLButtonElement | null>(null)
  const modelScrollAnimationFrameRef = useRef<number | null>(null)
  const modelScrollScheduleRef = useRef<{ frame: number | null; timeout: number | null }>({
    frame: null,
    timeout: null,
  })
  const previousSelectedModelRef = useRef<string | null>(null)
  const reasoningConfig = selectedModelOption?.reasoning
  const selectedReasoning = reasoningEffort ?? reasoningConfig?.default
  const selectedReasoningLabel =
    reasoningConfig && selectedReasoning ? formatReasoningEffortLabel(selectedReasoning) : "Default"
  const allModels = useMemo(() => modelOptions.flatMap((group) => group.models), [modelOptions])
  const providerOptions = useMemo(() => {
    const seenProviderIds = new Set<string>()
    return modelOptions.flatMap((group) => {
      if (seenProviderIds.has(group.providerId) || group.models.length === 0) {
        return []
      }
      seenProviderIds.add(group.providerId)
      return [{ id: group.providerId, name: group.category }]
    })
  }, [modelOptions])
  const filteredModels = useMemo(() => {
    const search = modelSearch.trim().toLowerCase()
    return allModels.filter((model) => {
      if (providerFilter !== ALL_PROVIDERS_FILTER && model.providerId !== providerFilter) {
        return false
      }
      if (!search) {
        return true
      }
      return getModelSearchText(model).includes(search)
    })
  }, [allModels, modelSearch, providerFilter])
  const modelSummary = selectedModelOption
    ? `${selectedModelOption.name} - ${selectedModelOption.providerName}`
    : selectedModel || "No model selected"
  const thinkingSummary = reasoningConfig
    ? `${selectedReasoningLabel} thinking`
    : "Provider default"

  useLayoutEffect(() => {
    setSelectPortalContainer(getDialogSelectPortalRoot())
  }, [])

  useLayoutEffect(() => {
    const previousSelectedModel = previousSelectedModelRef.current
    previousSelectedModelRef.current = selectedModel

    cancelScheduledScroll(modelScrollScheduleRef)

    if (openRow !== "models") {
      cancelScrollAnimation(modelScrollAnimationFrameRef)
      return
    }

    const selectedModelChanged =
      previousSelectedModel !== null && previousSelectedModel !== selectedModel
    const animateScroll = selectedModelChanged && !prefersReducedMotion()

    cancelScrollAnimation(modelScrollAnimationFrameRef)

    const scrollSelectedModelToCenter = (animated: boolean) => {
      const scrollContainer = modelListScrollRef.current
      const selectedCard = selectedModelCardRef.current
      if (!scrollContainer || !selectedCard || scrollContainer.clientHeight === 0) {
        return
      }

      const containerRect = scrollContainer.getBoundingClientRect()
      const selectedRect = selectedCard.getBoundingClientRect()
      const targetTop =
        scrollContainer.scrollTop +
        selectedRect.top -
        containerRect.top -
        (scrollContainer.clientHeight - selectedRect.height) / 2
      const boundedTargetTop = getBoundedScrollTop(scrollContainer, targetTop)

      if (animated) {
        animateScrollTop(scrollContainer, boundedTargetTop, modelScrollAnimationFrameRef)
        return
      }

      scrollContainer.scrollTo({ top: boundedTargetTop, behavior: "auto" })
    }

    modelScrollScheduleRef.current.frame = window.requestAnimationFrame(() => {
      modelScrollScheduleRef.current.frame = null
      scrollSelectedModelToCenter(animateScroll)

      if (!selectedModelChanged) {
        modelScrollScheduleRef.current.timeout = window.setTimeout(() => {
          modelScrollScheduleRef.current.timeout = null
          scrollSelectedModelToCenter(false)
        }, 220)
      }
    })
  }, [filteredModels, openRow, selectedModel])

  useEffect(() => {
    return () => {
      cancelScheduledScroll(modelScrollScheduleRef)
      cancelScrollAnimation(modelScrollAnimationFrameRef)
    }
  }, [])

  useEffect(() => {
    if (providerFilter === ALL_PROVIDERS_FILTER) {
      return
    }
    if (!providerOptions.some((provider) => provider.id === providerFilter)) {
      setProviderFilter(ALL_PROVIDERS_FILTER)
    }
  }, [providerFilter, providerOptions])

  return (
    <Dialog.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <Dialog className="flex max-h-[88dvh] w-full max-w-5xl flex-col bg-kumo-canvas p-0">
        <div className="flex items-center justify-between border-b border-kumo-hairline px-4 py-3">
          <Dialog.Title>{showThinking ? "Model and thinking" : "Model"}</Dialog.Title>
          <Button
            type="button"
            onClick={onClose}
            shape="circle"
            variant="ghost"
            aria-label={showThinking ? "Close model and thinking dialog" : "Close model dialog"}
            icon={<X className="h-4 w-4" aria-hidden />}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <section className="border-b border-kumo-hairline">
            <PickerRowHeader
              id="model-picker-models"
              title="Model"
              summary={modelSummary}
              meta={formatModelCount(filteredModels.length)}
              open={openRow === "models"}
              onToggle={() => setOpenRow("models")}
            />
            <PickerRowContent id="model-picker-models" open={openRow === "models"}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <InputGroup size="sm" className={`min-w-0 flex-1 ${recessedInputGroupClassName}`}>
                  <InputGroup.Addon>
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  </InputGroup.Addon>
                  <InputGroup.Input
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder="Search models"
                    aria-label="Search models by name"
                    passwordManagerIgnore
                  />
                </InputGroup>
                <Select
                  size="sm"
                  value={providerFilter}
                  onValueChange={(value) =>
                    setProviderFilter(String(value ?? ALL_PROVIDERS_FILTER))
                  }
                  renderValue={(value) => formatProviderFilterValue(value, providerOptions)}
                  aria-label="Filter models by AI Provider"
                  container={selectPortalContainer ?? undefined}
                  className="w-full sm:w-56"
                >
                  <Select.Option value={ALL_PROVIDERS_FILTER}>All providers</Select.Option>
                  {providerOptions.map((provider) => (
                    <Select.Option key={provider.id} value={provider.id}>
                      {provider.name}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div
                ref={modelListScrollRef}
                className="transparent-scrollbar mt-3 max-h-[52dvh] overflow-y-auto pr-1"
              >
                {filteredModels.length > 0 || showDefaultModelHint ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {showDefaultModelHint ? (
                      <>
                        <DefaultModelActionCard
                          kind="personal"
                          title="Set personal default"
                          description="Preselect your model for new agents."
                          to="/settings"
                          search={{ category: "providers" }}
                          onNavigate={onClose}
                        />
                        {isAdmin ? (
                          <DefaultModelActionCard
                            kind="admin"
                            title="Set global default"
                            description="Set the default model for all users."
                            to="/admin/integrations"
                            search={{ tab: "ai-providers" }}
                            onNavigate={onClose}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {filteredModels.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        selected={selectedModel === model.id}
                        cardRef={selectedModel === model.id ? selectedModelCardRef : undefined}
                        onSelect={() => onModelSelect(model.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-kumo-hairline bg-kumo-elevated/70 px-4 py-8 text-center text-sm text-kumo-subtle">
                    No models match the current filters.
                  </div>
                )}
              </div>
            </PickerRowContent>
          </section>

          {showThinking ? (
            <section>
              <PickerRowHeader
                id="model-picker-thinking"
                title="Thinking"
                summary={thinkingSummary}
                meta={reasoningConfig ? formatReasoningCount(reasoningConfig.efforts.length) : ""}
                open={openRow === "thinking"}
                onToggle={() => setOpenRow("thinking")}
              />
              <PickerRowContent id="model-picker-thinking" open={openRow === "thinking"}>
                {reasoningConfig ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {reasoningConfig.efforts.map((effort) => (
                      <ReasoningCard
                        key={effort}
                        effort={effort}
                        selected={selectedReasoning === effort}
                        onSelect={() => onReasoningSelect(effort)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-kumo-hairline bg-kumo-elevated/70 px-4 py-6 text-sm text-kumo-subtle">
                    This model does not expose a thinking control.
                  </div>
                )}
              </PickerRowContent>
            </section>
          ) : null}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function PickerRowHeader({
  id,
  title,
  summary,
  meta,
  open,
  onToggle,
}: {
  id: string
  title: string
  summary: string
  meta: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none transition hover:bg-kumo-tint/60 focus-visible:bg-kumo-tint"
    >
      <ChevronRight
        className={`h-4 w-4 shrink-0 text-kumo-subtle transition-transform ${open ? "rotate-90" : ""}`}
        aria-hidden
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium text-kumo-default">{title}</span>
        <span className="truncate text-xs text-kumo-subtle">{summary}</span>
      </span>
      {meta ? <HeaderBadge>{meta}</HeaderBadge> : null}
    </button>
  )
}

function PickerRowContent({
  id,
  open,
  children,
}: {
  id: string
  open: boolean
  children: ReactNode
}) {
  return (
    <div
      id={id}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-kumo-hairline p-4">{children}</div>
      </div>
    </div>
  )
}

function HeaderBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-kumo-tint px-2 py-0.5 text-[11px] font-medium leading-5 text-kumo-subtle ring-1 ring-kumo-hairline">
      {children}
    </span>
  )
}

function DefaultModelActionCard({
  kind,
  title,
  description,
  to,
  search,
  onNavigate,
}: {
  kind: "personal" | "admin"
  title: string
  description: string
  to: "/settings" | "/admin/integrations"
  search: { category: "providers" } | { tab: "ai-providers" }
  onNavigate: () => void
}) {
  const Icon = kind === "personal" ? UserRound : ShieldCheck
  const className =
    kind === "personal"
      ? "border-sky-500/35 bg-sky-500/10 text-kumo-default hover:border-sky-400/60 hover:bg-sky-500/15"
      : "border-emerald-500/35 bg-emerald-500/10 text-kumo-default hover:border-emerald-400/60 hover:bg-emerald-500/15"
  const iconClassName = kind === "personal" ? "text-sky-400" : "text-emerald-400"

  return (
    <Link
      to={to}
      search={search}
      onClick={onNavigate}
      className={`group flex min-h-24 w-full flex-col justify-between rounded-lg border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] active:scale-[0.99] ${className}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium leading-snug">{title}</span>
        <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden />
      </span>
      <span className="mt-3 text-xs leading-snug text-kumo-subtle">{description}</span>
    </Link>
  )
}

function ModelCard({
  model,
  selected,
  cardRef,
  onSelect,
}: {
  model: RuntimeProviderModelOption
  selected: boolean
  cardRef?: Ref<HTMLButtonElement>
  onSelect: () => void
}) {
  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex min-h-24 w-full flex-col justify-between rounded-lg border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] active:scale-[0.99] ${
        selected
          ? "border-kumo-brand bg-kumo-tint text-kumo-default shadow-sm"
          : "border-kumo-hairline bg-kumo-elevated text-kumo-default hover:border-kumo-line hover:bg-kumo-tint/70"
      }`}
    >
      <span className="min-w-0">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words text-sm font-medium leading-snug">{model.name}</span>
          {selected ? <Check className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden /> : null}
        </span>
      </span>

      <span className="mt-3 flex flex-wrap gap-1.5">
        <ModelBadge title={model.providerName}>{model.providerName}</ModelBadge>
      </span>
    </button>
  )
}

function ModelBadge({ children, title }: { children: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center rounded-full bg-kumo-tint px-2 py-0.5 text-[11px] font-medium leading-5 text-kumo-subtle ring-1 ring-kumo-hairline"
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

function ReasoningCard({
  effort,
  selected,
  onSelect,
}: {
  effort: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${formatReasoningEffortLabel(effort)}: ${getReasoningEffortDescription(effort)}`}
      className={`flex min-h-24 w-full flex-col rounded-lg border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] active:scale-[0.99] ${
        selected
          ? "border-kumo-brand bg-kumo-tint text-kumo-default shadow-sm"
          : "border-kumo-hairline bg-kumo-elevated text-kumo-default hover:border-kumo-line hover:bg-kumo-tint/70"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{formatReasoningEffortLabel(effort)}</span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-kumo-brand" aria-hidden /> : null}
      </span>
      <span className="mt-1 text-xs leading-snug text-kumo-subtle">
        {getReasoningEffortDescription(effort)}
      </span>
    </button>
  )
}

export function formatReasoningEffortLabel(effort: string): string {
  switch (effort) {
    case "xhigh":
      return "Xhigh"
    case "max":
      return "Max"
    default:
      return effort.charAt(0).toUpperCase() + effort.slice(1)
  }
}

export function getSelectedReasoningLabel(
  selectedModelOption: RuntimeProviderModelOption | null,
  reasoningEffort: string | undefined,
): string {
  const resolvedReasoning = reasoningEffort ?? selectedModelOption?.reasoning?.default

  if (selectedModelOption?.reasoning && resolvedReasoning) {
    return resolvedReasoning
  }

  return "default"
}

function getModelSearchText(model: RuntimeProviderModelOption): string {
  return [model.name, model.modelId, model.id].join(" ").toLowerCase()
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function getBoundedScrollTop(scrollContainer: HTMLElement, targetTop: number): number {
  const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
  return Math.min(maxScrollTop, Math.max(0, targetTop))
}

function animateScrollTop(
  scrollContainer: HTMLElement,
  targetTop: number,
  animationFrameRef: { current: number | null },
) {
  const startTop = scrollContainer.scrollTop
  const distance = targetTop - startTop

  if (Math.abs(distance) < 1) {
    scrollContainer.scrollTop = targetTop
    return
  }

  const startTime = window.performance.now()

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / MODEL_SCROLL_ANIMATION_MS)
    const easedProgress = 1 - Math.pow(1 - progress, 3)

    scrollContainer.scrollTop = startTop + distance * easedProgress

    if (progress < 1) {
      animationFrameRef.current = window.requestAnimationFrame(step)
      return
    }

    scrollContainer.scrollTop = targetTop
    animationFrameRef.current = null
  }

  animationFrameRef.current = window.requestAnimationFrame(step)
}

function cancelScrollAnimation(animationFrameRef: { current: number | null }) {
  if (animationFrameRef.current === null) {
    return
  }

  window.cancelAnimationFrame(animationFrameRef.current)
  animationFrameRef.current = null
}

function cancelScheduledScroll(scheduleRef: {
  current: { frame: number | null; timeout: number | null }
}) {
  if (scheduleRef.current.frame !== null) {
    window.cancelAnimationFrame(scheduleRef.current.frame)
    scheduleRef.current.frame = null
  }

  if (scheduleRef.current.timeout !== null) {
    window.clearTimeout(scheduleRef.current.timeout)
    scheduleRef.current.timeout = null
  }
}

function formatModelCount(count: number): string {
  return count === 1 ? "1 model" : `${count} models`
}

function formatReasoningCount(count: number): string {
  return count === 1 ? "1 level" : `${count} levels`
}

function formatProviderFilterValue(
  value: unknown,
  providers: ReadonlyArray<{ id: string; name: string }>,
): string {
  const selected = String(value ?? ALL_PROVIDERS_FILTER)
  if (selected === ALL_PROVIDERS_FILTER) {
    return "All providers"
  }
  return providers.find((provider) => provider.id === selected)?.name ?? "All providers"
}

function getReasoningEffortDescription(effort: string): string {
  switch (effort) {
    case "none":
      return "Fastest responses with no explicit reasoning budget."
    case "minimal":
      return "Very light reasoning for quick, simple tasks."
    case "low":
      return "Light reasoning for straightforward work."
    case "medium":
      return "Balanced thinking for everyday tasks."
    case "high":
      return "More thinking for complex implementation or debugging."
    case "xhigh":
    case "max":
      return "Maximum thinking for the hardest problems."
    default:
      return "Use the provider default for this model."
  }
}
