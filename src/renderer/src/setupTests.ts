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
  workspaces: {
    list: () => Promise.resolve([]),
    create: (name: string) =>
      Promise.resolve({ id: 1, name, createdAt: Math.floor(Date.now() / 1000) }),
    rename: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  },
  documents: {
    list: () => Promise.resolve([]),
    import: (workspaceId: number, sourcePath: string) =>
      Promise.resolve({
        id: 1,
        workspaceId,
        title: sourcePath,
        sourcePath,
        mimeType: null,
        byteSize: null,
        status: 'pending' as const,
        chunkCount: 0,
        tokenCount: 0,
        addedAt: Math.floor(Date.now() / 1000),
      }),
    delete: () => Promise.resolve(),
    reindex: (id: number) =>
      Promise.resolve({
        id,
        workspaceId: 1,
        title: 'stub',
        sourcePath: '/stub',
        mimeType: null,
        byteSize: null,
        status: 'pending' as const,
        chunkCount: 0,
        tokenCount: 0,
        addedAt: Math.floor(Date.now() / 1000),
      }),
    onIndexProgress: () => () => undefined,
  },
  embedder: {
    status: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
      }),
    info: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    reload: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    setPlacement: () => Promise.resolve(),
    backfillStatus: (workspaceId: number) =>
      Promise.resolve({
        workspaceId,
        state: 'idle' as const,
        done: 0,
        total: 0,
        message: null,
      }),
    runBackfill: () => Promise.resolve(),
    onStatus: () => () => undefined,
    onBackfillStatus: () => () => undefined,
  },
}

window.api = stub
