import { describe, expect, it } from "vitest"
import { resolveS0Brand } from "../../packages/shared/src/s0-brand"

describe("resolveS0Brand", () => {
  it("uses the SolZero defaults", () => {
    expect(resolveS0Brand({})).toEqual({
      name: "SolZero",
      logoLightPath: "/images/solzero-logo-light.png",
      logoDarkPath: "/images/solzero-logo-dark.png",
      faviconPath: "/favicon.svg",
      appleTouchIconPath: "/apple-touch-icon.png",
    })
  })

  it("supports a shared logo override", () => {
    expect(
      resolveS0Brand({
        VITE_S0_BRAND_NAME: "Acme",
        VITE_S0_BRAND_LOGO_PATH: "/images/acme.svg",
        VITE_S0_BRAND_LOGO_LIGHT_PATH: "/images/acme-light.svg",
        VITE_S0_BRAND_LOGO_DARK_PATH: "/images/acme-dark.svg",
      }),
    ).toMatchObject({
      name: "Acme",
      logoLightPath: "/images/acme.svg",
      logoDarkPath: "/images/acme.svg",
    })
  })

  it("supports independent theme and browser icon overrides", () => {
    expect(
      resolveS0Brand({
        VITE_S0_BRAND_LOGO_LIGHT_PATH: "/images/light.svg",
        VITE_S0_BRAND_LOGO_DARK_PATH: "/images/dark.svg",
        VITE_S0_BRAND_FAVICON_PATH: "/icons/favicon.png",
        VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH: "/icons/apple.png",
      }),
    ).toEqual({
      name: "SolZero",
      logoLightPath: "/images/light.svg",
      logoDarkPath: "/images/dark.svg",
      faviconPath: "/icons/favicon.png",
      appleTouchIconPath: "/icons/apple.png",
    })
  })
})
