import type { CSSProperties, ReactElement } from "react"
import * as Schema from "effect/Schema"

export const RELEASE_CARD_WIDTH = 1200
export const RELEASE_CARD_HEIGHT = 675

export const ReleaseCardLayoutSchema = Schema.Literals(["dark-columns", "light-features"])

export type ReleaseCardLayout = typeof ReleaseCardLayoutSchema.Type

export const releaseWorkTypes = [
  "feature",
  "bug",
  "ktlo",
  "security",
  "performance",
  "ux",
  "docs",
  "breaking",
] as const

export const ReleaseWorkTypeSchema = Schema.Literals(releaseWorkTypes)

export type ReleaseWorkType = typeof ReleaseWorkTypeSchema.Type

export const ReleaseTitleSchema = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
)
export const ReleaseDescriptionSchema = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(180)),
)
export const ReleaseBulletSchema = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(120)),
)

export const ReleaseHighlightSchema = Schema.Struct({
  title: ReleaseTitleSchema,
  description: ReleaseDescriptionSchema,
  bullets: Schema.optionalKey(
    Schema.Array(ReleaseBulletSchema).check(Schema.isLengthBetween(1, 3)),
  ),
  label: Schema.optionalKey(ReleaseTitleSchema),
  workType: Schema.optionalKey(ReleaseWorkTypeSchema),
})

export type ReleaseHighlight = typeof ReleaseHighlightSchema.Type

export const ReleaseCardInputSchema = Schema.Struct({
  version: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(32))),
  title: ReleaseTitleSchema,
  summary: Schema.optionalKey(ReleaseDescriptionSchema),
  highlights: Schema.Array(ReleaseHighlightSchema).check(Schema.isNonEmpty()),
  also: Schema.optionalKey(Schema.Array(ReleaseTitleSchema).check(Schema.isMaxLength(5))),
  layout: Schema.optionalKey(ReleaseCardLayoutSchema),
})

export type ReleaseCardInput = typeof ReleaseCardInputSchema.Type

const palette = {
  brand: "#0078d7",
  brandBright: "#349cff",
  darkCanvas: "#000000",
  darkLine: "#3b3b3b",
  lightCanvas: "#ffffff",
  lightLine: "#e2e2e2",
  lightSubtle: "#727477",
} as const

const rootStyle: CSSProperties = {
  width: RELEASE_CARD_WIDTH,
  height: RELEASE_CARD_HEIGHT,
  display: "flex",
  boxSizing: "border-box",
  fontFamily: "Manrope",
  overflow: "hidden",
  position: "relative",
}

function LogoLockup(): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <img src="solzero-logo" width={44} height={44} />
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>SolZero</span>
    </div>
  )
}

function clampHighlights(
  highlights: readonly ReleaseHighlight[],
  count: number,
): readonly ReleaseHighlight[] {
  const normalized = highlights
    .filter((item) => item.title.trim() && item.description.trim())
    .slice(0, count)
  if (normalized.length > 0) return normalized
  return [
    {
      title: "Release update",
      description: "See the full GitHub release notes for this version.",
    },
  ]
}

function overflowTitles(input: ReleaseCardInput, capacity: number): readonly string[] {
  return [
    ...input.highlights.slice(capacity).map((highlight) => highlight.title),
    ...(input.also ?? []),
  ]
    .map((title) => title.trim())
    .filter((title, index, titles) => title && titles.indexOf(title) === index)
    .slice(0, 5)
}

const workTypePresentation: Record<
  ReleaseWorkType,
  { readonly label: string; readonly color: string; readonly background: string }
> = {
  feature: { label: "FEATURE", color: "#0069b9", background: "#e8f4fd" },
  bug: { label: "BUG", color: "#b42318", background: "#feeceb" },
  ktlo: { label: "KTLO", color: "#55585c", background: "#eceeef" },
  security: { label: "SECURITY", color: "#9a6700", background: "#fff4ce" },
  performance: { label: "PERFORMANCE", color: "#6941c6", background: "#f1ebff" },
  ux: { label: "UX", color: "#007f79", background: "#e0f5f3" },
  docs: { label: "DOCS", color: "#2d7d46", background: "#e6f4ea" },
  breaking: { label: "BREAKING", color: "#b54708", background: "#fff0e5" },
}

function WorkTypeBadge({
  type,
  inverse = false,
}: {
  readonly type: ReleaseWorkType
  readonly inverse?: boolean
}): ReactElement {
  const presentation = workTypePresentation[type]
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 9px",
        borderRadius: 99,
        color: inverse ? "#ffffff" : presentation.color,
        backgroundColor: inverse ? `${presentation.color}55` : presentation.background,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
      }}
    >
      {presentation.label}
    </span>
  )
}

function BulletList({
  highlight,
  inverse = false,
}: {
  readonly highlight: ReleaseHighlight
  readonly inverse?: boolean
}): ReactElement {
  const bullets = (
    highlight.bullets?.filter((bullet) => bullet.trim()) ?? [highlight.description]
  ).slice(0, 2)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {bullets.map((bullet, index) => (
        <div
          key={`${bullet}-${index}`}
          style={{ display: "flex", alignItems: "flex-start", gap: 9 }}
        >
          <span
            style={{
              marginTop: -1,
              flexShrink: 0,
              color: inverse ? "#ffffff" : "#202124",
              fontSize: 20,
              lineHeight: 1.2,
            }}
          >
            •
          </span>
          <span
            style={{
              color: inverse ? "#f0f1f2" : "#45484c",
              fontSize: inverse ? 17 : 16,
              fontWeight: 500,
              lineHeight: 1.45,
            }}
          >
            {bullet}
          </span>
        </div>
      ))}
    </div>
  )
}

function OverflowFooter({
  input,
  items,
  inverse = false,
}: {
  readonly input: ReleaseCardInput
  readonly items: readonly string[]
  readonly inverse?: boolean
}): ReactElement | null {
  if (items.length === 0) return null
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        marginTop: 13,
        color: inverse ? "#d2d3d4" : palette.lightSubtle,
        fontSize: 11,
      }}
    >
      <span style={{ flexShrink: 0, color: inverse ? "#ffffff" : "#202124", fontWeight: 700 }}>
        Also in v{input.version}
      </span>
      <div style={{ display: "flex", minWidth: 0, gap: 7, overflow: "hidden" }}>
        {items.map((item) => (
          <span
            key={item}
            style={{
              flexShrink: 0,
              padding: "5px 8px",
              borderRadius: 5,
              color: inverse ? "#d2d3d4" : "#55585c",
              backgroundColor: inverse ? "rgba(255,255,255,0.04)" : "#ffffff",
              border: `1px solid ${inverse ? "#484a4d" : palette.lightLine}`,
            }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function DarkColumnsCard({ input }: { readonly input: ReleaseCardInput }): ReactElement {
  const highlights = clampHighlights(input.highlights, 4)
  const also = overflowTitles(input, 4)
  return (
    <div
      style={{
        ...rootStyle,
        flexDirection: "column",
        padding: "52px 58px 48px",
        color: "#ffffff",
        backgroundColor: palette.darkCanvas,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 2,
        }}
      >
        <LogoLockup />
        <span style={{ fontSize: 14, letterSpacing: "0.22em", color: "#b9bbbd" }}>
          RELEASE NOTES
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 28,
          marginBottom: 24,
          zIndex: 2,
        }}
      >
        <span style={{ fontSize: 72, lineHeight: 0.94, fontWeight: 700, letterSpacing: "-0.04em" }}>
          v{input.version}
        </span>
        <span
          style={{
            maxWidth: 570,
            fontSize: 18,
            lineHeight: 1.35,
            color: "#d2d3d4",
            textAlign: "right",
          }}
        >
          {input.title}
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 14, zIndex: 2 }}>
        {highlights.map((highlight, index) => {
          return (
            <div
              key={`${highlight.title}-${index}`}
              style={{
                minWidth: 0,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                padding: "21px 18px",
                borderRadius: 16,
                backgroundColor: "rgba(31,31,31,0.78)",
                border: `1px solid ${palette.darkLine}`,
                boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span style={{ fontSize: 13, color: "#9a9c9e", letterSpacing: "0.16em" }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <WorkTypeBadge type={highlight.workType ?? "feature"} inverse />
              </div>
              <div
                style={{
                  width: 32,
                  height: 3,
                  marginTop: 10,
                  marginBottom: 20,
                  backgroundColor: palette.brandBright,
                  borderRadius: 99,
                }}
              />
              <span style={{ fontSize: 22, lineHeight: 1.18, fontWeight: 700 }}>
                {highlight.title}
              </span>
              <div style={{ marginTop: 20 }}>
                <BulletList highlight={highlight} inverse />
              </div>
            </div>
          )
        })}
      </div>
      <OverflowFooter input={input} items={also} inverse />
    </div>
  )
}

function LightFeaturesCard({ input }: { readonly input: ReleaseCardInput }): ReactElement {
  const highlights = clampHighlights(input.highlights, 3)
  const also = overflowTitles(input, 3)
  return (
    <div
      style={{
        ...rootStyle,
        flexDirection: "column",
        padding: "44px 48px 34px",
        color: "#202124",
        backgroundColor: palette.lightCanvas,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <LogoLockup />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: palette.lightSubtle, fontSize: 14 }}>RELEASE</span>
          <span
            style={{
              padding: "7px 11px",
              borderRadius: 99,
              color: palette.brand,
              backgroundColor: "#e8f4fd",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            v{input.version}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 20, marginBottom: 21 }}>
        <span
          style={{ fontSize: 42, lineHeight: 1.08, fontWeight: 700, letterSpacing: "-0.035em" }}
        >
          {input.title}
        </span>
        {input.summary ? (
          <span style={{ marginTop: 8, fontSize: 16, color: palette.lightSubtle }}>
            {input.summary}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flex: 1, gap: 22 }}>
        {highlights.map((highlight, index) => (
          <div
            key={`${highlight.title}-${index}`}
            style={{
              minWidth: 0,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "22px 20px",
              borderRadius: 16,
              backgroundColor: "#ffffff",
              border: `1px solid ${palette.lightLine}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <WorkTypeBadge type={highlight.workType ?? "feature"} />
              <span style={{ color: "#8a8c8f", fontSize: 12, letterSpacing: "0.12em" }}>
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <span style={{ marginTop: 13, fontSize: 21, lineHeight: 1.2, fontWeight: 700 }}>
              {highlight.title}
            </span>
            <div
              style={{
                height: 116,
                marginTop: 16,
                overflow: "hidden",
              }}
            >
              <BulletList highlight={highlight} />
            </div>
          </div>
        ))}
      </div>

      <OverflowFooter input={input} items={also} />
    </div>
  )
}

export function ReleaseNotesCard({ input }: { readonly input: ReleaseCardInput }): ReactElement {
  return input.layout === "dark-columns" ? (
    <DarkColumnsCard input={input} />
  ) : (
    <LightFeaturesCard input={input} />
  )
}
