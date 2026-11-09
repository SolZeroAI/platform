import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Writable } from "node:stream"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import { createElement } from "react"
import { resolveS0Brand } from "@solzero/shared"
import { fromJsx } from "takumi-js/helpers/jsx"
import { Renderer } from "takumi-js/node"
import { createOgCopy, productTagline } from "./copy"
import { frameCount, frameTimeMs, OG_FPS, OG_HEIGHT, OG_LOOP_MS, OG_WIDTH } from "./frame"
import { markMotionCss, markOffsets } from "./mark"
import { ogConcepts, type OgConceptId, type OgSceneProps } from "./scenes"
import { OgContactSheet, sheetSize } from "./sheet"
import { readOgTheme } from "./theme"

const MANROPE_REGULAR_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/manrope/files/manrope-latin-400-normal.woff2"),
)

const MANROPE_BOLD_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/manrope/files/manrope-latin-700-normal.woff2"),
)

export class OgRenderError extends Schema.TaggedError<OgRenderError>()("OgRenderError", {
  operation: Schema.Literals([
    "read-assets",
    "register-fonts",
    "compile-template",
    "render-frame",
    "encode-gif",
    "encode-video",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export interface RenderOgOptions {
  readonly conceptId?: OgConceptId
  readonly outputDir: string
  readonly repoRoot: string
}

function rendererEffect<A>(operation: OgRenderError["operation"], evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      new OgRenderError({
        operation,
        message: `Open Graph ${operation} failed.`,
        cause,
      }),
  })
}

export const renderOgConcepts = Effect.fn("og.render")(function* (options: RenderOgOptions) {
  const fs = yield* FileSystem.FileSystem
  const kumoStyles = fileURLToPath(import.meta.resolve("@cloudflare/kumo/styles"))

  const assets = yield* Effect.all({
    regular: fs.readFile(MANROPE_REGULAR_PATH),
    bold: fs.readFile(MANROPE_BOLD_PATH),
    logoSvg: fs.readFileString(join(options.repoRoot, "apps/web/public/images/solzero-logo.svg")),
    appCss: fs.readFileString(join(options.repoRoot, "apps/web/src/styles/app.css")),
    kumoTheme: fs.readFileString(join(dirname(kumoStyles), "theme-kumo.css")),
    readme: fs.readFileString(join(options.repoRoot, "README.md")),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new OgRenderError({
          operation: "read-assets",
          message: "Open Graph assets could not be read.",
          cause,
        }),
    ),
  )

  const theme = yield* Effect.try({
    try: () => readOgTheme(assets.kumoTheme, assets.appCss),
    catch: (cause) =>
      new OgRenderError({
        operation: "read-assets",
        message: cause instanceof Error ? cause.message : "Kumo tokens could not be read.",
        cause,
      }),
  })

  const copy = yield* Effect.try({
    try: () =>
      createOgCopy({
        brandName: resolveS0Brand({}).name,
        tagline: productTagline(assets.readme),
      }),
    catch: (cause) =>
      new OgRenderError({
        operation: "read-assets",
        message: cause instanceof Error ? cause.message : "Open Graph copy could not be read.",
        cause,
      }),
  })

  const offsets = yield* Effect.try({
    try: () => markOffsets(assets.logoSvg),
    catch: (cause) =>
      new OgRenderError({
        operation: "read-assets",
        message: cause instanceof Error ? cause.message : "The SolZero mark could not be measured.",
        cause,
      }),
  })

  const renderer = new Renderer()

  yield* rendererEffect("register-fonts", () =>
    Promise.all([
      renderer.registerFont({ name: "Manrope", data: assets.regular, weight: 400 }),
      renderer.registerFont({ name: "Manrope", data: assets.bold, weight: 700 }),
    ]).then(() => undefined),
  )

  const images = logoImages(assets.logoSvg, theme.logoFill)

  const sceneProps: OgSceneProps = {
    copy,
    markCss: markMotionCss(offsets),
    offsets,
    themeCss: theme.css,
  }

  yield* fs.makeDirectory(options.outputDir, { recursive: true })

  const selected = options.conceptId
    ? ogConcepts.filter((concept) => concept.id === options.conceptId)
    : [...ogConcepts]

  const written: string[] = []

  for (const concept of selected) {
    const compiled = yield* rendererEffect("compile-template", () =>
      fromJsx(createElement(concept.Scene, sceneProps)),
    )

    const still = yield* renderFrame(renderer, compiled.node, compiled.css, images, 0, "png")
    const stillPath = join(options.outputDir, `${concept.id}.png`)

    yield* fs.writeFile(stillPath, still)
    written.push(stillPath)

    const videoPath = join(options.outputDir, `${concept.id}.mp4`)

    yield* encodeVideo(renderer, compiled.node, compiled.css, images, videoPath)
    written.push(videoPath)

    const gif = yield* rendererEffect("encode-gif", () =>
      renderer.renderAnimation({
        width: OG_WIDTH,
        height: OG_HEIGHT,
        fps: OG_FPS,
        format: "gif",
        fontFamilies: ["Manrope"],
        css: compiled.css,
        images,
        scenes: [{ durationMs: OG_LOOP_MS, node: compiled.node }],
      }),
    )

    const gifPath = join(options.outputDir, `${concept.id}.gif`)

    yield* fs.writeFile(gifPath, gif)
    written.push(gifPath)
  }

  if (!options.conceptId) {
    const sheet = yield* renderContactSheet(
      renderer,
      fs,
      options.outputDir,
      theme.css,
      selected.map((concept) => concept.name),
    )

    written.push(sheet)
  }

  return written
})

function logoImages(logoSvg: string, fill: string) {
  const encode = (svg: string) => new TextEncoder().encode(svg)

  return [
    { src: "solzero-logo", data: encode(logoSvg.replaceAll("#000", fill)) },
    { src: "solzero-logo-mask", data: encode(logoSvg) },
  ]
}

function renderFrame(
  renderer: Renderer,
  node: Awaited<ReturnType<typeof fromJsx>>["node"],
  css: Awaited<ReturnType<typeof fromJsx>>["css"],
  images: ReturnType<typeof logoImages>,
  timeMs: number,
  format: "png" | "raw",
) {
  return rendererEffect("render-frame", () =>
    renderer.render(node, {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      format,
      timeMs,
      fontFamilies: ["Manrope"],
      css,
      images,
      dithering: "ordered-bayer",
    }),
  )
}

const encodeVideo = Effect.fn("og.encodeVideo")(function* (
  renderer: Renderer,
  node: Awaited<ReturnType<typeof fromJsx>>["node"],
  css: Awaited<ReturnType<typeof fromJsx>>["css"],
  images: ReturnType<typeof logoImages>,
  outputPath: string,
) {
  const count = frameCount()

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${OG_WIDTH}x${OG_HEIGHT}`,
      "-framerate",
      String(OG_FPS),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  )

  const stderr: Buffer[] = []

  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk)
  })

  const closed = new Promise<void>((resolvePromise, reject) => {
    ffmpeg.on("error", reject)
    ffmpeg.on("close", (code) => {
      if (code === 0) resolvePromise()
      else {
        reject(
          new Error(
            `ffmpeg exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(-1600)}`,
          ),
        )
      }
    })
  })

  const stdin = ffmpeg.stdin

  if (!stdin) {
    return yield* Effect.fail(
      new OgRenderError({
        operation: "encode-video",
        message: "ffmpeg did not open a frame pipe.",
        cause: outputPath,
      }),
    )
  }

  for (let index = 0; index < count; index++) {
    const frame = yield* renderFrame(renderer, node, css, images, frameTimeMs(index), "raw")

    yield* Effect.tryPromise({
      try: () => writeFrame(stdin, frame),
      catch: (cause) =>
        new OgRenderError({
          operation: "encode-video",
          message: "ffmpeg did not accept a frame.",
          cause,
        }),
    })
  }

  stdin.end()

  yield* Effect.tryPromise({
    try: () => closed,
    catch: (cause) =>
      new OgRenderError({
        operation: "encode-video",
        message: "ffmpeg could not encode the Open Graph video.",
        cause,
      }),
  })
})

function writeFrame(stdin: Writable, frame: Uint8Array): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    stdin.write(frame, (error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

const renderContactSheet = Effect.fn("og.contactSheet")(function* (
  renderer: Renderer,
  fs: FileSystem.FileSystem,
  outputDir: string,
  themeCss: string,
  names: readonly string[],
) {
  const stills = yield* Effect.all(
    names.map((_, index) => {
      const concept = ogConcepts[index]

      if (!concept) {
        return Effect.fail(
          new OgRenderError({
            operation: "render-frame",
            message: "Contact sheet is missing a concept still.",
            cause: index,
          }),
        )
      }

      return fs.readFile(join(outputDir, `${concept.id}.png`))
    }),
  )

  const size = sheetSize(names.length)

  const compiled = yield* rendererEffect("compile-template", () =>
    fromJsx(createElement(OgContactSheet, { names, themeCss })),
  )

  const sheet = yield* rendererEffect("render-frame", () =>
    renderer.render(compiled.node, {
      width: size.width,
      height: size.height,
      format: "png",
      fontFamilies: ["Manrope"],
      css: compiled.css,
      images: stills.map((data, index) => ({ src: `still-${index}`, data })),
    }),
  )

  const outputPath = join(outputDir, "contact-sheet.png")

  yield* fs.writeFile(outputPath, sheet)

  return outputPath
})
