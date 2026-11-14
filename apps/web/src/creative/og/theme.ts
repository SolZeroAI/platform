const REQUIRED_TOKENS = [
  "--color-kumo-canvas",
  "--color-kumo-elevated",
  "--color-kumo-brand",
  "--color-kumo-line",
  "--color-kumo-success",
  "--text-color-kumo-default",
  "--text-color-kumo-subtle",
  "--text-color-kumo-strong",
] as const

export interface OgTheme {
  readonly css: string
  readonly logoFill: string
}

export function readOgTheme(kumoCss: string, appCss: string): OgTheme {
  const merged = new Map<string, string>()

  for (const block of blocksMatching(kumoCss, ':root[data-mode="dark"]')) {
    for (const [name, value] of readDeclarations(block)) merged.set(name, value)
  }

  for (const block of blocksMatching(appCss, ":root")) {
    for (const [name, value] of readDeclarations(block)) merged.set(name, value)
  }

  for (const block of blocksMatching(appCss, '[data-mode="dark"]')) {
    for (const [name, value] of readDeclarations(block)) merged.set(name, value)
  }

  const missing = REQUIRED_TOKENS.filter((token) => !merged.has(token))

  if (missing.length > 0) {
    throw new Error(`Kumo theme is missing ${missing.join(", ")}.`)
  }

  const logoFill = svgFill(merged.get("--text-color-kumo-strong") ?? "")
  const lines = [...merged].map(([name, value]) => `  ${name}: ${value};`)

  return {
    css: `:root {\n${lines.join("\n")}\n}`,
    logoFill,
  }
}

export function svgFill(value: string): string {
  const color = concreteColor(value)

  if (color.startsWith("#")) return color

  const oklch = color.match(/^oklch\(\s*([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)/i)
  const lightness = oklch?.[1]
  const chroma = oklch?.[2]
  const hue = oklch?.[3]

  if (!lightness || !chroma || !hue) {
    throw new Error(`SVG fill cannot use ${color}.`)
  }

  return oklchToHex(Number(lightness) / 100, Number(chroma), Number(hue))
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return `#${[red, green, blue].map((channel) => channelHex(channel)).join("")}`
}

function channelHex(channel: number): string {
  const linear = Math.min(1, Math.max(0, channel))
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055

  return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
    .toString(16)
    .padStart(2, "0")
}

export function concreteColor(value: string): string {
  const current = value.trim()
  const wrapped = current.match(/^var\(\s*--[A-Za-z0-9-]+\s*,\s*([\s\S]*)\)$/)
  const fallback = wrapped?.[1]?.trim()

  return fallback ? concreteColor(fallback) : current
}

function blocksMatching(css: string, marker: string): string[] {
  const blocks: string[] = []
  let from = 0

  while (from < css.length) {
    const at = css.indexOf(marker, from)

    if (at < 0) break

    const open = css.indexOf("{", at)

    if (open < 0) break

    if (css.slice(at, open).includes(";")) {
      from = at + marker.length
      continue
    }

    const body = blockBody(css, open)

    if (body) blocks.push(body)

    from = open + 1
  }

  return blocks
}

function blockBody(css: string, open: number): string | undefined {
  let depth = 0

  for (let index = open; index < css.length; index++) {
    const char = css[index]

    if (char === "{") depth += 1

    if (char === "}") {
      depth -= 1

      if (depth === 0) return css.slice(open + 1, index)
    }
  }

  return undefined
}

function readDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>()
  let index = 0

  while (index < block.length) {
    const start = block.indexOf("--", index)

    if (start < 0) break

    const colon = block.indexOf(":", start)

    if (colon < 0 || colon - start > 80) {
      index = start + 2
      continue
    }

    const name = block.slice(start, colon).trim()

    if (!/^--[a-z0-9-]+$/i.test(name)) {
      index = start + 2
      continue
    }

    let depth = 0
    let end = colon + 1

    for (; end < block.length; end++) {
      const char = block[end]

      if (char === "(") depth += 1
      else if (char === ")") depth -= 1
      else if (char === ";" && depth === 0) break
    }

    const value = block
      .slice(colon + 1, end)
      .replace(/\s+/g, " ")
      .trim()

    if (value) declarations.set(name, value)

    index = end + 1
  }

  return declarations
}
