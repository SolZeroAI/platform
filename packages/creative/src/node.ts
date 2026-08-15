import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { fromJsx } from "takumi-js/helpers/jsx"
import { Renderer } from "takumi-js/node"
import {
  RELEASE_CARD_HEIGHT,
  RELEASE_CARD_WIDTH,
  ReleaseNotesCard,
  type ReleaseCardInput,
} from "./release-card"

const MANROPE_REGULAR_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/manrope/files/manrope-latin-400-normal.woff2"),
)
const MANROPE_BOLD_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/manrope/files/manrope-latin-700-normal.woff2"),
)

export const DEFAULT_RELEASE_CARD_PATH = "docs/solzero-release-notes.png"

export async function renderReleaseNotesCard(options: {
  readonly input: ReleaseCardInput
  readonly repoRoot: string
}): Promise<Uint8Array> {
  const renderer = new Renderer()
  const [regular, bold, logoSvg] = await Promise.all([
    readFile(MANROPE_REGULAR_PATH),
    readFile(MANROPE_BOLD_PATH),
    readFile(join(options.repoRoot, "apps/web/public/images/solzero-logo.svg"), "utf8"),
  ])
  const logoColor = options.input.layout === "dark-columns" ? "#fff" : "#000"

  await Promise.all([
    renderer.registerFont({ name: "Manrope", data: regular, weight: 400 }),
    renderer.registerFont({ name: "Manrope", data: bold, weight: 700 }),
  ])

  const element = createElement(ReleaseNotesCard, { input: options.input })
  const { node, stylesheets } = await fromJsx(element)
  return renderer.render(node, {
    width: RELEASE_CARD_WIDTH,
    height: RELEASE_CARD_HEIGHT,
    format: "png",
    fontFamilies: ["Manrope"],
    stylesheets,
    images: [
      {
        src: "solzero-logo",
        data: new TextEncoder().encode(logoSvg.replaceAll("#000", logoColor)),
      },
    ],
  })
}

export async function renderReleaseNotesCardToFile(options: {
  readonly input: ReleaseCardInput
  readonly repoRoot: string
  readonly outputPath?: string
}): Promise<string> {
  const outputPath = resolve(options.repoRoot, options.outputPath ?? DEFAULT_RELEASE_CARD_PATH)
  const image = await renderReleaseNotesCard(options)
  await writeFile(outputPath, image)
  return outputPath
}
