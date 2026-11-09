import {
  LOADER_ASSEMBLY_DURATION,
  LOADER_DEPARTURE_DURATION,
  LOADER_PIECE_STAGGER,
  LOADER_PIECES,
} from "@/components/s0-loader-motion"
import { OG_HOLD } from "./frame"

export const MARK_SIZE = 460

/** The loader's path offsets are sized for a small icon. This scale keeps the same vectors readable at OG size. */
export const MARK_TRAVEL_SCALE = 2.4

export interface MarkOffset {
  readonly offsetX: number
  readonly offsetY: number
}

export function markOffsets(svg: string): readonly MarkOffset[] {
  const pixelsPerPathUnit = (markScale(svg) * MARK_SIZE * MARK_TRAVEL_SCALE) / squareViewBox(svg)

  return LOADER_PIECES.map((piece) => ({
    offsetX: piece.offsetX * pixelsPerPathUnit,
    offsetY: piece.offsetY * pixelsPerPathUnit,
  }))
}

export function markMotionCss(pieces: readonly MarkOffset[]): string {
  const staggerRatio = LOADER_PIECE_STAGGER / LOADER_DEPARTURE_DURATION
  const assembleRatio = LOADER_ASSEMBLY_DURATION / LOADER_DEPARTURE_DURATION
  const departSpan = 8

  return pieces
    .map((piece, index) => {
      const departStart = 10 + index * staggerRatio * departSpan
      const departEnd = departStart + departSpan
      const assembleStart = 48 + index * staggerRatio * departSpan
      const assembleEnd = assembleStart + assembleRatio * departSpan
      const away = `translate(${piece.offsetX.toFixed(1)}px, ${piece.offsetY.toFixed(1)}px)`

      return `
        @keyframes mark-piece-${index} {
          ${OG_HOLD} { transform: translate(0px, 0px); opacity: 1; }
          ${departStart.toFixed(2)}% { transform: translate(0px, 0px); opacity: 1; animation-timing-function: ease-in; }
          ${departEnd.toFixed(2)}% { transform: ${away}; opacity: 1; animation-timing-function: linear; }
          ${assembleStart.toFixed(2)}% { transform: ${away}; opacity: 1; animation-timing-function: ease-out; }
          ${assembleEnd.toFixed(2)}% { transform: translate(0px, 0px); opacity: 1; }
        }
      `
    })
    .join("\n")
}

function squareViewBox(svg: string): number {
  const match = svg.match(/viewBox="0 0 ([0-9.]+) \1"/)
  const size = match?.[1] ? Number(match[1]) : Number.NaN

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("solzero-logo.svg has no square viewBox.")
  }

  return size
}

function markScale(svg: string): number {
  const scales = [...svg.matchAll(/matrix\(([-\d.]+),0,0,\1,/g)].map((match) => Number(match[1]))
  const scale = scales.find((value) => value !== 1 && Number.isFinite(value))

  if (!scale) throw new Error("solzero-logo.svg has no mark scale.")

  return scale
}
