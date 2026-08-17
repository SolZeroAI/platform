import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { S0FormSpinLoader } from "./s0-form-spin-loader"

describe("S0FormSpinLoader", () => {
  it("inherits a theme-aware foreground color", () => {
    const markup = renderToStaticMarkup(createElement(S0FormSpinLoader))

    expect(markup).toContain('fill="currentColor"')
  })
})
