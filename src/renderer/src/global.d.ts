import type { Api } from '@preload/index'

declare global {
  interface Window {
    api: Api
  }
  const __APP_VERSION__: string
}

export {}
