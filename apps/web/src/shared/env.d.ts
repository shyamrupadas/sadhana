/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_ID: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
