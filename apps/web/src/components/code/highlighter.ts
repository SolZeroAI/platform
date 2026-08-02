import type { HighlighterCore } from "shiki/core"
import { createHighlighterCore } from "shiki/core"
import { createOnigurumaEngine } from "shiki/engine/oniguruma"

let highlighterPromise: Promise<HighlighterCore> | null = null

export const CODE_THEME = {
  light: "github-light",
  dark: "github-dark",
} as const

export function getCodeHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    langs: [import("@shikijs/langs/javascript"), import("@shikijs/langs/json")],
    themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  })

  return highlighterPromise
}
