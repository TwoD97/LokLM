import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { Api } from '@preload/index'

afterEach(() => {
  cleanup()
})

const stub: Api = {
  auth: {
    status: () =>
      Promise.resolve({
        registered: false,
        locked: true,
        displayName: null,
        remainingRecoveryCodes: 0,
        recoveryLang: null,
      }),
    register: () => Promise.resolve({ passphrase: Array(18).fill('test') as string[] }),
    login: () => Promise.resolve({ ok: true as const }),
    logout: () => Promise.resolve(),
    lock: () => Promise.resolve(),
    reset: () =>
      Promise.resolve({ ok: true as const, passphrase: Array(18).fill('test') as string[] }),
    onState: () => () => undefined,
  },
  window: {
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    onMaximizedChange: () => () => undefined,
  },
}

window.api = stub
