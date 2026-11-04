/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_PUBLIC_DOMAIN?: string
  readonly VITE_WEB_URL?: string
}

declare const __TV_VERSION__: string
