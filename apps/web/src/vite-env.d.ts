interface ImportMetaEnv {
  readonly VITE_STAGE?: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_COMMIT_SHA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
