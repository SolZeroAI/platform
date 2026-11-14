export const SOLZERO_OUTER_PATH =
  "M376 188V377C376 480.76 291.76 565 188 565C84.24 565 0 480.76 0 377V188C0 84.24 84.24 0 188 0C291.76 0 376 84.24 376 188Z"

export const SOLZERO_STAR_PATH =
  "M188 94.5C188 197.634 272.866 282.5 376 282.5C272.866 282.5 188 367.366 188 470.5C188 367.366 103.134 282.5 0 282.5C103.134 282.5 188 197.634 188 94.5Z"

export const SOLZERO_MARK_PATH = `${SOLZERO_OUTER_PATH}${SOLZERO_STAR_PATH}`

export const LOADER_CYCLE_SECONDS = 2.8

export const LOADER_ASSEMBLY_START = LOADER_CYCLE_SECONDS * 0.12

export const LOADER_ASSEMBLY_DURATION = LOADER_CYCLE_SECONDS * 0.28

export const LOADER_DEPARTURE_START = LOADER_CYCLE_SECONDS * 0.64

export const LOADER_DEPARTURE_DURATION = LOADER_CYCLE_SECONDS * 0.14

export const LOADER_PIECE_STAGGER = LOADER_CYCLE_SECONDS * 0.06

export const LOADER_PIECES = [
  { name: "north-west", height: 282.5, offsetX: -34, offsetY: -26, width: 188, x: 0, y: 0 },
  { name: "north-east", height: 282.5, offsetX: 34, offsetY: -26, width: 188, x: 188, y: 0 },
  {
    name: "south-east",
    height: 282.5,
    offsetX: 34,
    offsetY: 26,
    width: 188,
    x: 188,
    y: 282.5,
  },
  { name: "south-west", height: 282.5, offsetX: -34, offsetY: 26, width: 188, x: 0, y: 282.5 },
] as const

export type LoaderPiece = (typeof LOADER_PIECES)[number]
