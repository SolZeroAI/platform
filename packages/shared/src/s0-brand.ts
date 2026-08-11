export interface S0BrandEnvironment {
  readonly VITE_S0_BRAND_NAME?: string
  readonly VITE_S0_BRAND_LOGO_PATH?: string
  readonly VITE_S0_BRAND_LOGO_LIGHT_PATH?: string
  readonly VITE_S0_BRAND_LOGO_DARK_PATH?: string
  readonly VITE_S0_BRAND_FAVICON_PATH?: string
  readonly VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH?: string
}

export interface S0BrandConfig {
  readonly name: string
  readonly logoLightPath: string
  readonly logoDarkPath: string
  readonly faviconPath: string
  readonly appleTouchIconPath: string
}

const DEFAULT_SOLZERO_BRAND: S0BrandConfig = {
  name: "SolZero",
  logoLightPath: "/images/solzero-logo-light.png",
  logoDarkPath: "/images/solzero-logo-dark.png",
  faviconPath: "/favicon.svg",
  appleTouchIconPath: "/apple-touch-icon.png",
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function resolveS0Brand(env: S0BrandEnvironment): S0BrandConfig {
  const sharedLogoPath = nonEmpty(env.VITE_S0_BRAND_LOGO_PATH)
  return {
    name: nonEmpty(env.VITE_S0_BRAND_NAME) ?? DEFAULT_SOLZERO_BRAND.name,
    logoLightPath:
      sharedLogoPath ??
      nonEmpty(env.VITE_S0_BRAND_LOGO_LIGHT_PATH) ??
      DEFAULT_SOLZERO_BRAND.logoLightPath,
    logoDarkPath:
      sharedLogoPath ??
      nonEmpty(env.VITE_S0_BRAND_LOGO_DARK_PATH) ??
      DEFAULT_SOLZERO_BRAND.logoDarkPath,
    faviconPath: nonEmpty(env.VITE_S0_BRAND_FAVICON_PATH) ?? DEFAULT_SOLZERO_BRAND.faviconPath,
    appleTouchIconPath:
      nonEmpty(env.VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH) ?? DEFAULT_SOLZERO_BRAND.appleTouchIconPath,
  }
}
