import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { S0Loader } from "./s0-loader"

describe("S0Loader", () => {
  it("renders a visible mark before the animation loads", () => {
    const markup = renderToStaticMarkup(createElement(S0Loader))

    expect(markup.match(/data-s0-loader-piece=/g)).toHaveLength(4)
    expect(markup).not.toContain('opacity="0"')
  })
})
