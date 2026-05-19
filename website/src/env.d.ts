/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_INSTALLER_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
