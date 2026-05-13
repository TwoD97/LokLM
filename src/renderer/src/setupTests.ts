import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { Api } from '@preload/index'

afterEach(() => {
  cleanup()
})

const stub = {
  auth: {
    status: () =>
      Promise.resolve({
        registered: false,
        locked: true,
        displayName: null,
        remainingRecoveryCodes: 0,
        recoveryLang: null,
      }),
    register: () => Promise.resolve(undefined),
    login: () => Promise.resolve(undefined),
    logout: () => Promise.resolve(undefined),
    lock: () => Promise.resolve(undefined),
    reset: () => Promise.resolve(undefined),
    onState: () => () => undefined,
  },
} satisfies Api

window.api = stub
