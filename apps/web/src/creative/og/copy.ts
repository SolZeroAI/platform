import { formatAgentRuntimeLabel } from "@solzero/shared"
import { WORKFLOW_NODE_CATALOG } from "@solzero/shared/workflow-nodes/definitions"
import {
  homeComposerPlaceholder,
  homePreparingAgentLabel,
  homeStartNewAgentLabel,
  homeWelcomeHeading,
} from "@/components/home-hero-copy"
import { primaryNavLabels } from "@/components/primary-nav-labels"
import { solzeroGemSmokeColors } from "@/components/s0-gem-smoke"

export interface OgCopy {
  readonly beats: readonly [string, string, string]
  readonly brandName: string
  readonly placeholder: string
  readonly preparingAgent: string
  readonly previousSessions: string
  readonly smokeColors: readonly [string, string, string]
  readonly startNewAgent: string
  readonly stops: readonly [string, string, string, string]
  readonly surfaces: readonly [string, string, string]
  readonly tagline: string
  readonly welcome: string
  readonly workflowTitle: string
}

export function createOgCopy(input: {
  readonly brandName: string
  readonly tagline: string
}): OgCopy {
  return {
    beats: beatsFromPlaceholder(homeComposerPlaceholder),
    brandName: input.brandName,
    placeholder: homeComposerPlaceholder,
    preparingAgent: homePreparingAgentLabel(formatAgentRuntimeLabel("isolate")),
    previousSessions: primaryNavLabels.previousSessions,
    smokeColors: solzeroGemSmokeColors,
    startNewAgent: homeStartNewAgentLabel,
    stops: [
      catalogLabel("webhook-trigger"),
      catalogLabel("isolate-session"),
      catalogLabel("user-approval"),
      catalogLabel("email-notification"),
    ],
    surfaces: [primaryNavLabels.agents, primaryNavLabels.workflows, primaryNavLabels.bots],
    tagline: input.tagline,
    welcome: homeWelcomeHeading(input.brandName),
    workflowTitle: primaryNavLabels.workflows,
  }
}

export function productTagline(readme: string): string {
  let sawHeading = false

  for (const raw of readme.split("\n")) {
    const line = raw.trim()

    if (line.startsWith("# ")) {
      sawHeading = true
      continue
    }

    if (!sawHeading || line.length === 0 || line.startsWith("!") || line.startsWith("#")) continue

    return line
  }

  throw new Error("README.md has no tagline under the title.")
}

function beatsFromPlaceholder(placeholder: string): readonly [string, string, string] {
  const leadWord = placeholder.match(/^\s*([A-Za-z]+)/)?.[1]
  const build = placeholder.match(/\bbuild\b/i)?.[0]
  const automate = placeholder.match(/\bautomate\b/i)?.[0]

  if (!leadWord || !build || !automate) {
    throw new Error(
      "The home composer placeholder no longer contains the Chat, build, and automate line.",
    )
  }

  return [titleWord(leadWord), titleWord(build), titleWord(automate)]
}

function catalogLabel(type: string): string {
  const node = WORKFLOW_NODE_CATALOG.find((item) => item.type === type)

  if (!node) throw new Error(`Workflow catalog is missing ${type}.`)

  return node.label
}

function titleWord(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()
}
