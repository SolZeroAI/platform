import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
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

export class ReleaseCardRenderError extends Schema.TaggedErrorClass<ReleaseCardRenderError>()(
  "ReleaseCardRenderError",
  {
    operation: Schema.Literals(["register-fonts", "compile-template", "render-image"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

function rendererEffect<A>(
  operation: ReleaseCardRenderError["operation"],
  evaluate: () => Promise<A>,
) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      new ReleaseCardRenderError({
        operation,
        message: `Release card ${operation} failed.`,
        cause,
      }),
  })
}

export const renderReleaseNotesCard = Effect.fn("releaseCard.render")(function* (options: {
  readonly input: ReleaseCardInput
  readonly repoRoot: string
}) {
  const fs = yield* FileSystem.FileSystem
  const renderer = new Renderer()
  const [regular, bold, logoSvg] = yield* Effect.all([
    fs.readFile(MANROPE_REGULAR_PATH),
    fs.readFile(MANROPE_BOLD_PATH),
    fs.readFileString(join(options.repoRoot, "apps/web/public/images/solzero-logo.svg")),
  ])
  const logoColor = options.input.layout === "dark-columns" ? "#fff" : "#000"

  yield* rendererEffect("register-fonts", () =>
    Promise.all([
      renderer.registerFont({ name: "Manrope", data: regular, weight: 400 }),
      renderer.registerFont({ name: "Manrope", data: bold, weight: 700 }),
    ]).then(() => undefined),
  )

  const element = createElement(ReleaseNotesCard, { input: options.input })
  const { node, stylesheets } = yield* rendererEffect("compile-template", () => fromJsx(element))
  return yield* rendererEffect("render-image", () =>
    renderer.render(node, {
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
    }),
  )
})

export const renderReleaseNotesCardToFile = Effect.fn("releaseCard.renderToFile")(
  function* (options: {
    readonly input: ReleaseCardInput
    readonly repoRoot: string
    readonly outputPath?: string
  }) {
    const fs = yield* FileSystem.FileSystem
    const outputPath = resolve(options.repoRoot, options.outputPath ?? DEFAULT_RELEASE_CARD_PATH)
    const image = yield* renderReleaseNotesCard(options)
    yield* fs.writeFile(outputPath, image)
    return outputPath
  },
)
