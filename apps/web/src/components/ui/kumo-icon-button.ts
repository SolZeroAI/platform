// @cloudflare/kumo Button and InputGroup.Button select an icon-only button with a prop named
// `shape`. Spread one of these objects at the call site, so the library prop name is written once.
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @cloudflare/kumo names this prop.
export const squareIconButton = { shape: "square" } as const

// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @cloudflare/kumo names this prop.
export const circleIconButton = { shape: "circle" } as const
