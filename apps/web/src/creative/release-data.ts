import {
  isReleaseWorkType,
  releaseWorkTypes,
  type ReleaseCardInput,
  type ReleaseCardLayout,
  type ReleaseHighlight,
  type ReleaseWorkType,
} from "./release-card"

const CREATIVE_DIRECTIVE = /<!--\s*creative:\s*(\{[\s\S]*?})\s*-->/i

export interface ReleaseSocialCopy {
  readonly title?: string
  readonly description?: string
  readonly bullets?: readonly string[]
  readonly workType?: ReleaseWorkType
}

function optionalBulletFields(value: Record<string, unknown>): readonly string[] | undefined {
  const raw = value.bullets
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    throw new Error("The creative bullets field must contain one to three strings.")
  }
  return raw.map((bullet) => {
    if (typeof bullet !== "string" || !bullet.trim()) {
      throw new Error("Each creative bullet must be a non-empty string.")
    }
    const copy = bullet.trim()
    if (copy.length > 120) {
      throw new Error("Each creative bullet must be 120 characters or fewer.")
    }
    return copy
  })
}

export interface ReleaseSection {
  readonly title: string
  readonly content: string
  readonly social?: ReleaseSocialCopy
}

export interface ReleaseEntry {
  readonly sections: readonly ReleaseSection[]
}

function optionalCopyField(
  value: Record<string, unknown>,
  field: "title" | "description",
  maximumLength: number,
): string | undefined {
  const raw = value[field]
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`The creative ${field} must be a non-empty string.`)
  }
  const copy = raw.trim()
  if (copy.length > maximumLength) {
    throw new Error(`The creative ${field} must be ${maximumLength} characters or fewer.`)
  }
  return copy
}

export function createReleaseSection(title: string, content: string): ReleaseSection {
  const match = CREATIVE_DIRECTIVE.exec(content)
  if (!match) return { title, content }

  let value: unknown
  try {
    value = JSON.parse(match[1] ?? "")
  } catch (error) {
    throw new Error("The creative release directive must contain valid JSON.", { cause: error })
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The creative release directive must contain a JSON object.")
  }

  const fields = value as Record<string, unknown>
  const unknownFields = Object.keys(fields).filter(
    (field) =>
      field !== "title" && field !== "description" && field !== "bullets" && field !== "workType",
  )
  if (unknownFields.length > 0) {
    throw new Error(`Unknown creative release field: ${unknownFields.join(", ")}.`)
  }

  const workType = fields.workType
  if (workType !== undefined && (typeof workType !== "string" || !isReleaseWorkType(workType))) {
    throw new Error(`The creative workType must be one of: ${releaseWorkTypes.join(", ")}.`)
  }

  return {
    title,
    content: content.replace(match[0], "").trim(),
    social: {
      title: optionalCopyField(fields, "title", 64),
      description: optionalCopyField(fields, "description", 180),
      bullets: optionalBulletFields(fields),
      workType,
    },
  }
}

export function parseTegamiReleaseEntry(markdown: string): ReleaseEntry {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, "")
  const matches = [...body.matchAll(/^##\s+(.+)$/gm)]
  return {
    sections: matches.map((match, index) => {
      const contentStart = (match.index ?? 0) + match[0].length
      const contentEnd = matches[index + 1]?.index ?? body.length
      return createReleaseSection(
        match[1]?.trim() ?? "Release update",
        body.slice(contentStart, contentEnd).trim(),
      )
    }),
  }
}

function plainText(markdown: string): string {
  return markdown
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replaceAll(/^[-*+]\s+/gm, "")
    .replaceAll(/\s+/g, " ")
    .trim()
}

function firstSentences(markdown: string, maximumLength = 180): string {
  const text = plainText(markdown)
  if (text.length <= maximumLength) return text
  const boundary = text.lastIndexOf(" ", maximumLength - 1)
  return `${text.slice(0, boundary > 80 ? boundary : maximumLength - 1).trim()}…`
}

function releaseBullets(markdown: string): readonly string[] {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => firstSentences(paragraph, 120))
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs.slice(0, 2) : ["See the full GitHub release notes."]
}

function inferWorkType(markdown: string): ReleaseWorkType {
  const text = plainText(markdown).toLocaleLowerCase()
  if (/\b(breaking|incompatible|migration required)\b/.test(text)) return "breaking"
  if (/\b(security|vulnerability|cve|credential|permission)\b/.test(text)) return "security"
  if (/\b(bug|fix|fixed|correct|resolve|resolved|regression)\b/.test(text)) return "bug"
  if (/\b(performance|latency|faster|speed|memory|optimi[sz])\b/.test(text)) return "performance"
  if (/\b(documentation|docs|guide|readme)\b/.test(text)) return "docs"
  if (/\b(ktlo|maintenance|dependency|dependencies|upgrade|operator)\b/.test(text)) return "ktlo"
  if (/\b(ux|ui|visual|motion|animation|interface)\b/.test(text)) return "ux"
  return "feature"
}

export function createReleaseCardInput(options: {
  readonly version: string
  readonly entries: readonly ReleaseEntry[]
  readonly layout?: ReleaseCardLayout
  readonly title?: string
}): ReleaseCardInput {
  const sections = options.entries
    .flatMap((entry) => entry.sections)
    .map((section) =>
      section.social ? section : createReleaseSection(section.title, section.content),
    )
  const highlights: ReleaseHighlight[] = sections.map((section) => {
    const title = section.social?.title ?? plainText(section.title)
    const fallbackBullets = releaseBullets(section.content)
    const description =
      section.social?.description ?? section.social?.bullets?.join(" ") ?? fallbackBullets.join(" ")
    const bullets =
      section.social?.bullets ??
      (section.social?.description ? [section.social.description] : fallbackBullets)
    return {
      title: plainText(title),
      description: plainText(description),
      bullets: bullets.map(plainText),
      workType: section.social?.workType ?? inferWorkType(`${section.title} ${section.content}`),
    }
  })
  const title = options.title?.trim() || highlights[0]?.title || `SolZero ${options.version}`
  const summary =
    highlights.length > 1
      ? `${highlights.length} fresh updates for your SolZero workspace.`
      : "A fresh SolZero update is ready."

  return {
    version: options.version.replace(/^v/, ""),
    title,
    summary,
    highlights,
    layout: options.layout ?? "light-features",
  }
}
