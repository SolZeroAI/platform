interface ImportMetaEnv {
  readonly VITE_STAGE?: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_COMMIT_SHA?: string
  readonly VITE_S0_BRAND_NAME?: string
  readonly VITE_S0_BRAND_LOGO_PATH?: string
  readonly VITE_S0_BRAND_LOGO_LIGHT_PATH?: string
  readonly VITE_S0_BRAND_LOGO_DARK_PATH?: string
  readonly VITE_S0_BRAND_FAVICON_PATH?: string
  readonly VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
