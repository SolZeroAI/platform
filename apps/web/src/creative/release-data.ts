import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  ReleaseBulletSchema,
  ReleaseDescriptionSchema,
  ReleaseCardInputSchema,
  ReleaseTitleSchema,
  ReleaseWorkTypeSchema,
  type ReleaseCardInput,
  type ReleaseCardLayout,
  type ReleaseHighlight,
  type ReleaseWorkType,
} from "./release-card"

const CREATIVE_DIRECTIVE = /<!--\s*creative:\s*(\{[\s\S]*?})\s*-->/i

export const ReleaseSocialCopySchema = Schema.Struct({
  title: Schema.optionalKey(ReleaseTitleSchema),
  description: Schema.optionalKey(ReleaseDescriptionSchema),
  bullets: Schema.optionalKey(
    Schema.Array(ReleaseBulletSchema).check(Schema.isLengthBetween(1, 3)),
  ),
  workType: Schema.optionalKey(ReleaseWorkTypeSchema),
})

export type ReleaseSocialCopy = typeof ReleaseSocialCopySchema.Type

export class ReleaseCardDataError extends Schema.TaggedErrorClass<ReleaseCardDataError>()(
  "ReleaseCardDataError",
  {
    operation: Schema.Literals(["parse-entry", "create-input", "decode-input"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

const decodeReleaseSocialCopy = Schema.decodeUnknownSync(
  Schema.fromJsonString(ReleaseSocialCopySchema),
  { onExcessProperty: "error" },
)

export interface ReleaseSection {
  readonly title: string
  readonly content: string
  readonly social?: ReleaseSocialCopy
}

export interface ReleaseEntry {
  readonly sections: readonly ReleaseSection[]
}

export interface CreateReleaseCardInputOptions {
  readonly version: string
  readonly entries: readonly ReleaseEntry[]
  readonly layout?: ReleaseCardLayout
  readonly title?: string
}

function createReleaseSection(title: string, content: string): ReleaseSection {
  const match = CREATIVE_DIRECTIVE.exec(content)
  if (!match) return { title, content }

  return {
    title,
    content: content.replace(match[0], "").trim(),
    social: decodeReleaseSocialCopy(match[1] ?? ""),
  }
}

function parseTegamiReleaseEntryUnsafe(markdown: string): ReleaseEntry {
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

export const parseTegamiReleaseEntry = Effect.fn("releaseCard.parseTegamiEntry")(
  (markdown: string) =>
    Effect.try({
      try: () => parseTegamiReleaseEntryUnsafe(markdown),
      catch: (cause) =>
        new ReleaseCardDataError({
          operation: "parse-entry",
          message: "The Tegami release entry contains invalid creative data.",
          cause,
        }),
    }),
)

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

function createReleaseCardInputUnsafe(options: CreateReleaseCardInputOptions): ReleaseCardInput {
  const sections = options.entries
    .flatMap((entry) => entry.sections)
    .map((section) =>
      section.social ? section : createReleaseSection(section.title, section.content),
    )
  const highlights: ReleaseHighlight[] = sections.map((section) => {
    const title = section.social?.title ?? plainText(section.title)
    const fallbackBullets = releaseBullets(section.content)
    const bullets =
      section.social?.bullets ??
      (section.social?.description ? [section.social.description] : fallbackBullets)
    const description = section.social?.description ?? firstSentences(bullets.join(" "))
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

export const createReleaseCardInput = Effect.fn("releaseCard.createInput")((
  options: CreateReleaseCardInputOptions,
) => {
  const input = Effect.try({
    try: () => createReleaseCardInputUnsafe(options),
    catch: (cause) => cause,
  })
  return input.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(ReleaseCardInputSchema, { onExcessProperty: "error" }),
    ),
    Effect.mapError(
      (cause) =>
        new ReleaseCardDataError({
          operation: "create-input",
          message: "The release card input could not be created.",
          cause,
        }),
    ),
  )
})

export const decodeReleaseCardInputJson = Effect.fn("releaseCard.decodeInputJson")((json: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseCardInputSchema), {
    onExcessProperty: "error",
  })(json).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCardDataError({
          operation: "decode-input",
          message: "The release card JSON input is invalid.",
          cause,
        }),
    ),
  ),
)
