/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactElement } from "react"
import { OG_HEIGHT, OG_WIDTH } from "./frame"

const THUMB_WIDTH = 300
const THUMB_HEIGHT = Math.round((THUMB_WIDTH * OG_HEIGHT) / OG_WIDTH)
const GAP = 18
const PAD = 28

export function sheetSize(count: number) {
  return {
    width: PAD * 2 + count * THUMB_WIDTH + (count - 1) * GAP,
    height: PAD * 2 + THUMB_HEIGHT + 44,
  }
}

export function OgContactSheet({
  names,
  themeCss,
}: {
  readonly names: readonly string[]
  readonly themeCss: string
}): ReactElement {
  const size = sheetSize(names.length)

  return (
    <div
      style={{
        width: size.width,
        height: size.height,
        display: "flex",
        boxSizing: "border-box",
        gap: GAP,
        padding: PAD,
        backgroundColor: "var(--color-kumo-canvas)",
        color: "var(--text-color-kumo-default)",
        fontFamily: "Manrope",
      }}
    >
      <style>{themeCss}</style>
      {names.map((name, index) => (
        <div
          key={name}
          style={{ display: "flex", flexDirection: "column", gap: 10, width: THUMB_WIDTH }}
        >
          <img src={`still-${index}`} width={THUMB_WIDTH} height={THUMB_HEIGHT} />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{name}</span>
        </div>
      ))}
    </div>
  )
}
