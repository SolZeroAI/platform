import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PublicAuthProviderRegistry } from "@solzero/shared"
import { SignInPage } from "./_authenticated"

vi.mock("@/lib/authenticated-shell.functions", () => ({
  loadAuthenticatedShellForRoute: vi.fn(),
}))

vi.mock("@/components/s0-animated-icon", () => ({
  S0AnimatedIcon: () => null,
}))

const authProviderConfig: PublicAuthProviderRegistry = {
  defaultSignInProviderId: "credential",
  configurationFile: "config/dev.config.jsonc",
  providers: [
    {
      id: "credential",
      kind: "credential",
      displayName: "Administrator",
      capabilities: {
        signIn: true,
        link: false,
      },
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("SignInPage", () => {
  it("renders on the server without browser globals", () => {
    const page = createElement(SignInPage, { authProviderConfig })

    expect(() => renderToString(page)).not.toThrow()
  })

  it("gives each credential input an accessible name", () => {
    const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const page = createElement(SignInPage, { authProviderConfig })

    renderToString(page)

    expect(consoleWarning).not.toHaveBeenCalledWith(
      expect.stringContaining("[Kumo Input]: Input must have an accessible name"),
    )
  })
})
